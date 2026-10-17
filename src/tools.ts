/**
 * 工具集：review_diff / review_run / review_report / review_check /
 * review_respond / review_status / review_gate / review_learn / review_issue / review_eval。
 *
 * 设计原则（对应文章）：
 * - 先验证再给人看：没有可执行证据的结论不发
 * - 风格类直接丢；同一条只发一次（指纹）
 * - 三轮收敛，第 2 轮起只看增量
 * - 噪音按处置统计，按镜头归因
 * - 插件能做的自己做；需要判断的部分生成"作业书"给调用方 AI
 *
 * @module dsh-review/tools
 */

import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { git } from './exec.js'
import { parseDiff, type FileDiff } from './diff.js'
import { isSkipped, loadRules, type ReviewRules } from './rules.js'
import { fingerprintOf } from './fingerprint.js'
import { classifyRisk, modeForRisk, planForMode, requiredApprovals, type Mode } from './modes.js'
import { Ledger } from './ledger.js'
import { runCheck } from './check.js'
import { gateFindings, type CandidateFinding, type GateResult } from './gate.js'
import { buildIssueTriagePrompt, buildEvalPrompt, type LensTask } from './lenses.js'
import { createDispatcher, externalDispatcher, type Dispatcher } from './dispatch.js'
import { runLenses } from './run.js'
import type { ReviewConfig } from './config.js'
import { severityRank } from './config.js'

export interface ContentBlock { type: 'text'; text: string }

export interface ReviewToolDefinition {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
  output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): ContentBlock[] }
  execute(args: unknown, exec?: unknown): Promise<unknown>
  timeoutMs?: number
}

export interface BuildOptions {
  /** 由宿主注入：能起子智能体时用它，否则退回"作业书"。 */
  dispatcher?: () => Dispatcher
}

const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function compileParameters(spec: Record<string, any>): { type: 'object'; properties: Record<string, unknown>; required?: string[] } {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, prop] of Object.entries(spec)) {
    if (prop?.required === true) required.push(key)
    const node: Record<string, unknown> = {}
    if (typeof prop?.type === 'string') node.type = prop.type
    if (typeof prop?.description === 'string') node.description = prop.description
    if (prop?.enum !== undefined) node.enum = prop.enum
    if (prop?.items !== undefined) node.items = prop.items
    properties[key] = node
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

function sessionRoot(exec?: unknown): string {
  const candidate = (exec as { agent?: { session?: { header?: { cwd?: string } } } } | undefined)?.agent?.session?.header?.cwd
  const root = typeof candidate === 'string' && candidate !== '' ? candidate : process.cwd()
  try { return realpathSync(root) } catch { return root }
}

function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(label + ' 必须是非空字符串')
  return value.trim()
}

async function changedFiles(root: string, args: string[]): Promise<string[]> {
  const result = await git(root, args, 20000)
  return result.ok ? result.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : []
}

function toFindings(raw: unknown, defaultLens: string): CandidateFinding[] {
  if (!Array.isArray(raw)) throw new Error('findings 必须是数组')
  return raw.map((item, index) => {
    const f = (item ?? {}) as Record<string, unknown>
    const file = str(f.file, 'findings[' + index + '].file')
    const anchor = str(f.anchor, 'findings[' + index + '].anchor')
    const message = str(f.message, 'findings[' + index + '].message')
    return {
      file,
      line: typeof f.line === 'number' ? f.line : 0,
      kind: typeof f.kind === 'string' ? f.kind : 'correctness',
      severity: f.severity === 'blocker' || f.severity === 'nit' ? f.severity : 'important',
      message,
      anchor,
      evidence: typeof f.evidence === 'string' ? f.evidence : '',
      lens: typeof f.lens === 'string' ? f.lens : defaultLens,
      classOfBug: typeof f.classOfBug === 'string' ? f.classOfBug : undefined,
    } as CandidateFinding
  })
}

interface DiffPlan {
  head: string
  base: string
  mode: Mode
  risk: 'low' | 'medium' | 'high'
  riskReasons: string[]
  approvals: number
  files: FileDiff[]
  skipped: string[]
  added: number
  removed: number
  rules: ReviewRules
  plan: ReturnType<typeof planForMode>
  round: number
  alreadyPosted: number
  diffOnly: boolean
  budget: number
  advice: string
}

async function planDiff(root: string, args: Record<string, unknown>, config: ReviewConfig, ledger: Ledger): Promise<DiffPlan> {
  const rules = loadRules(root)
  const headResult = await git(root, ['rev-parse', 'HEAD'], 20000)
  if (!headResult.ok) throw new Error('当前目录不是 Git 仓库（rev-parse HEAD 失败）：' + root)
  const head = headResult.stdout.trim()
  const staged = args.staged === true
  const base = typeof args.base === 'string' && args.base.trim() !== '' ? args.base.trim() : null
  if (base !== null && (base.startsWith('-') || /[\s;|&]/.test(base))) throw new Error('base 必须是合法的 Git ref')
  const diffArgs = staged ? ['diff', '--cached', '--unified=3'] : base !== null ? ['diff', base + '...HEAD', '--unified=3'] : ['diff', 'HEAD', '--unified=3']
  const diffResult = await git(root, diffArgs, 60000)
  if (!diffResult.ok) throw new Error('git diff 失败：' + diffResult.stderr.trim().slice(0, 300))
  const parsed = parseDiff(diffResult.stdout)
  let files: FileDiff[] = parsed.files
  if (args.includeUntracked === true) {
    const untracked = await changedFiles(root, ['ls-files', '--others', '--exclude-standard'])
    const existing = new Set(files.map(f => f.path))
    for (const file of untracked.filter(f => !existing.has(f))) files.push({ path: file, oldPath: null, status: 'added', binary: false, hunks: [], added: 0, removed: 0 })
  }
  const skipped = files.filter(f => isSkipped(f.path, rules.skip)).map(f => f.path)
  files = files.filter(f => !isSkipped(f.path, rules.skip))
  if (files.length === 0) {
    return { head, base: base ?? (staged ? 'index' : 'HEAD'), mode: 'quick', risk: 'low', riskReasons: [], approvals: 0, files: [], skipped, added: 0, removed: 0, rules, plan: planForMode('quick'), round: 0, alreadyPosted: 0, diffOnly: false, budget: 0, advice: '没有可审的改动。' }
  }
  const risk = classifyRisk(files.map(f => f.path), rules.sensitivePaths)
  const mode: Mode = (typeof args.mode === 'string' ? args.mode : rules.mode ?? modeForRisk(risk.tier, files.length)) as Mode
  if (!['quick', 'standard', 'deep'].includes(mode)) throw new Error('mode 只能是 quick | standard | deep')
  const record = ledger.head(head)
  ledger.ensureHead(head, mode).base = base ?? 'HEAD'
  ledger.save()
  const round = record?.round ?? 0
  let advice = ''
  if (round >= config.roundCap) advice = '该 head 已审 ' + round + ' 轮，达到上限：只审新 diff，或停下来重新考虑方案。'
  else if (round + 1 > config.diffOnlyAfterRound) advice = '第 ' + (round + 1) + ' 轮起只看增量：重复或旧代码里的问题不再发。'
  return {
    head, base: base ?? 'HEAD', mode, risk: risk.tier, riskReasons: risk.reasons, approvals: requiredApprovals(risk.tier),
    files, skipped, added: parsed.added, removed: parsed.removed, rules, plan: planForMode(mode),
    round, alreadyPosted: record === undefined ? 0 : Object.keys(record.posted).length,
    diffOnly: round + 1 > config.diffOnlyAfterRound, budget: planForMode(mode).estimatedCalls, advice,
  }
}

export function buildReviewTools(config: ReviewConfig, options: BuildOptions = {}): ReviewToolDefinition[] {
  const dispatcherFactory = options.dispatcher ?? (() => externalDispatcher())

  return [
    {
      name: 'review_diff',
      description: '出审阅计划：读 diff、按风险自动选模式（quick/standard/deep）、加载 REVIEW.md、给出并行镜头与预算。只出计划不出结论。',
      parameters: compileParameters({
        base: { type: 'string', description: '对比基准 Git ref（默认 HEAD）' },
        staged: { type: 'boolean', description: '审已暂存改动' },
        includeUntracked: { type: 'boolean', description: '把未跟踪文件按新增处理' },
        mode: { type: 'string', enum: ['quick', 'standard', 'deep'], description: '强制模式' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        const lines = ['审阅计划 ' + String(r.mode) + ' · 风险 ' + String(r.risk) + ' · 建议 ' + String(r.approvals) + ' 人 · head ' + String(r.head).slice(0, 8)]
        lines.push('改动 ' + String(r.files?.length ?? 0) + ' 文件 +' + String(r.added) + '/-' + String(r.removed) + '，跳过 ' + String(r.skipped?.length ?? 0))
        for (const lens of (r.plan?.finders ?? [])) lines.push('- ' + String(lens.title))
        if (r.advice) lines.push('注意：' + String(r.advice))
        return [{ type: 'text', text: lines.join('\n') }]
      } },
      timeoutMs: 120000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const root = sessionRoot(exec)
        const ledger = new Ledger(root, config.stateDir)
        const p = await planDiff(root, (rawArgs ?? {}) as Record<string, unknown>, config, ledger)
        return {
          head: p.head, base: p.base, mode: p.mode, risk: p.risk, riskReasons: p.riskReasons, approvals: p.approvals,
          files: p.files.map(f => ({ path: f.path, status: f.status, added: f.added, removed: f.removed, hunks: f.hunks.length, binary: f.binary })),
          skipped: p.skipped, added: p.added, removed: p.removed,
          rules: { found: p.rules.found, path: p.rules.path, skip: p.rules.skip, maxNits: p.rules.maxNits, severityFloor: p.rules.severityFloor, mode: p.rules.mode, failureSignals: p.rules.failureSignals },
          plan: p.plan, round: p.round, alreadyPosted: p.alreadyPosted, diffOnly: p.diffOnly, budget: p.budget, advice: p.advice,
        }
      },
    },
    {
      name: 'review_run',
      description: '一键审阅：生成各镜头的完整作业书 → 派给子智能体并行审 → 收结果 → 过证据/去重/轮次/严重度把关。宿主没有子智能体能力时，返回可直接执行的作业书（prompt + outFile），由调用方 AI 自己跑完再调 review_report。',
      parameters: compileParameters({
        base: { type: 'string', description: '对比基准 Git ref（默认 HEAD）' },
        staged: { type: 'boolean', description: '审已暂存改动' },
        mode: { type: 'string', enum: ['quick', 'standard', 'deep'], description: '强制模式' },
        dryRun: { type: 'boolean', description: '只生成作业书，不派发' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        const lines = ['审阅执行 · 派发方式 ' + String(r.dispatcher) + ' · 镜头 ' + String(r.tasks?.length ?? 0)]
        if (r.dispatcher === 'external') lines.push('宿主无子智能体：作业书已写到磁盘，交给调用方 AI 执行。')
        else lines.push('派发 ' + String(r.dispatched) + ' 个，失败 ' + String(r.failed?.length ?? 0))
        lines.push('可发 ' + String(r.postable?.length ?? 0) + ' · 压制 ' + String(r.suppressed ?? 0) + ' · 丢弃 ' + String(r.dropped ?? 0) + ' · 未验证 ' + String(r.unverified ?? 0))
        for (const f of (r.postable ?? [])) lines.push('- [' + String(f.severity) + '] ' + String(f.file) + ':' + String(f.line) + ' ' + String(f.message).slice(0, 100))
        return [{ type: 'text', text: lines.join('\n') }]
      } },
      timeoutMs: 600000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const ledger = new Ledger(root, config.stateDir)
        const p = await planDiff(root, args, config, ledger)
        if (p.files.length === 0) return { head: p.head, mode: p.mode, dispatcher: 'none', tasks: [], postable: [], advice: p.advice }
        const dispatcher: Dispatcher = args.dryRun === true ? externalDispatcher() : dispatcherFactory()
        const run = await runLenses({ root, head: p.head, base: p.base, mode: p.mode, rules: p.rules, config: { stateDir: config.stateDir, maxFindings: config.maxFindings }, dispatcher })
        const record = ledger.beginRound(p.head, p.mode)
        const gated: GateResult = await gateFindings({ root, head: p.head, base: p.base, mode: p.mode, findings: run.findings, declined: run.declined, config, rules: p.rules, record, ledger })
        ledger.save()
        ledger.event('run', { head: p.head, mode: p.mode, dispatcher: run.dispatcher, dispatched: run.dispatched, findings: run.findings.length, postable: gated.postable.length })
        return {
          head: p.head, base: p.base, mode: p.mode, risk: p.risk, dispatcher: run.dispatcher, reason: run.reason,
          tasks: run.tasks.map(t => ({ id: t.id, title: t.title, outFile: t.outFile, prompt: run.dispatcher === 'external' ? t.prompt : undefined })),
          dispatched: run.dispatched, failed: run.failed, missingOutputs: run.missingOutputs,
          round: record.round, postable: gated.postable, suppressed: gated.suppressed, dropped: gated.dropped,
          droppedDetail: gated.droppedDetail.slice(0, 20), unverified: gated.unverified, declined: gated.declined,
        }
      },
    },
    {
      name: 'review_report',
      description: '手工提交本轮结论（已由外部审阅者产出时用）。插件负责丢风格类、指纹去重并合并取最严、标 pre-existing、卡证据与 nit/轮次上限，只返回可发条目。',
      parameters: compileParameters({
        head: { type: 'string', required: true, description: 'review_diff / review_run 返回的 head' },
        findings: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        mode: { type: 'string', enum: ['quick', 'standard', 'deep'] },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        const lines = ['第 ' + String(r.round) + ' 轮：可发 ' + String(r.postable?.length ?? 0) + '，压制 ' + String(r.suppressed) + '，丢弃 ' + String(r.dropped) + '，未验证 ' + String(r.unverified)]
        for (const f of (r.postable ?? [])) lines.push('- [' + String(f.severity) + '] ' + String(f.file) + ':' + String(f.line) + ' ' + String(f.message).slice(0, 100))
        return [{ type: 'text', text: lines.join('\n') }]
      } },
      timeoutMs: 180000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const head = str(args.head, 'head')
        const rules = loadRules(root)
        const ledger = new Ledger(root, config.stateDir)
        const existing = ledger.head(head)
        const mode: Mode = (typeof args.mode === 'string' ? args.mode : existing?.mode ?? 'standard') as Mode
        const record = ledger.beginRound(head, mode)
        const gated = await gateFindings({ root, head, base: existing?.base ?? 'HEAD', mode, findings: toFindings(args.findings, 'report'), config, rules, record, ledger })
        ledger.save()
        ledger.event('round', { head, round: record.round, mode, postable: gated.postable.length, suppressed: gated.suppressed, dropped: gated.dropped, unverified: gated.unverified })
        let advice = ''
        if (record.round >= config.roundCap) advice = '已达 ' + config.roundCap + ' 轮上限：请作者停下来重新考虑方案，而不是继续逐条修。'
        return { head, round: record.round, mode, postable: gated.postable, suppressed: gated.suppressed, suppressedFingerprints: gated.suppressedFingerprints, dropped: gated.dropped, droppedDetail: gated.droppedDetail.slice(0, 20), unverified: gated.unverified, totals: { posted: Object.keys(record.posted).length, reviewedFiles: record.reviewedFiles.length }, advice }
      },
    },
    {
      name: 'review_check',
      description: '为一条结论跑证据：执行命令/测试并返回退出码与输出摘要。review_report 的 evidence 字段应引用这里的结果。',
      parameters: compileParameters({
        command: { type: 'string', required: true, description: '要执行的命令' },
        cwd: { type: 'string', description: '相对仓库根的工作目录' },
        timeoutMs: { type: 'number', description: '超时毫秒' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        return [{ type: 'text', text: (r.ok ? '证据通过' : '证据失败') + ' · exit=' + String(r.exitCode) + ' · ' + String(r.durationMs) + 'ms\n' + String(r.output ?? '').slice(0, 1000) }]
      } },
      timeoutMs: 300000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const command = str(args.command, 'command')
        const timeoutMs = typeof args.timeoutMs === 'number' ? Math.trunc(args.timeoutMs) : config.commandTimeoutMs
        const cwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? path.resolve(root, args.cwd.trim()) : undefined
        return await runCheck(root, command, timeoutMs, cwd)
      },
    },
    {
      name: 'review_respond',
      description: '记录一条结论的处置（fixed / wrong / intentional / wontfix）。这是噪音率的唯一来源；wrong 越多说明审阅越吵。',
      parameters: compileParameters({
        head: { type: 'string', required: true },
        fingerprint: { type: 'string' },
        file: { type: 'string' },
        line: { type: 'number' },
        disposition: { type: 'string', required: true, enum: ['fixed', 'wrong', 'intentional', 'wontfix'] },
        note: { type: 'string' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        return [{ type: 'text', text: r.ok === true ? '已记录 ' + String(r.fingerprint) + ' → ' + String(r.disposition) : '未找到：' + String(r.reason ?? '') }]
      } },
      timeoutMs: 60000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const head = str(args.head, 'head')
        const disposition = str(args.disposition, 'disposition')
        if (!['fixed', 'wrong', 'intentional', 'wontfix'].includes(disposition)) throw new Error('disposition 只能是 fixed | wrong | intentional | wontfix')
        const ledger = new Ledger(root, config.stateDir)
        let fingerprint = typeof args.fingerprint === 'string' ? args.fingerprint.trim() : ''
        if (fingerprint === '') {
          const file = str(args.file, 'file')
          const line = typeof args.line === 'number' ? args.line : -1
          const record = ledger.head(head)
          const hit = record === undefined ? undefined : Object.values(record.posted).find(f => f.file === file && (line < 0 || f.line === line))
          if (hit === undefined) return { ok: false, reason: '没有匹配 file/line 的已发结论' }
          fingerprint = hit.fingerprint
        }
        const updated = ledger.respond(head, fingerprint, disposition as 'fixed' | 'wrong' | 'intentional' | 'wontfix', typeof args.note === 'string' ? args.note : undefined)
        if (updated === undefined) return { ok: false, reason: '该 head 下没有这个 fingerprint' }
        ledger.save()
        ledger.event('respond', { head, fingerprint, disposition, note: args.note })
        return { ok: true, fingerprint, disposition, status: ledger.status(head) }
      },
    },
    {
      name: 'review_status',
      description: '看噪音与收敛：轮次、处置分布、噪音率、复报率、未验证数、按镜头归因。改 prompt 前后对比这个数。',
      parameters: compileParameters({ head: { type: 'string' } }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        const d = r.byDisposition ?? {}
        return [{ type: 'text', text: ['审阅状态 v' + PACKAGE_VERSION, 'head ' + String(r.heads) + ' · 轮 ' + String(r.round) + ' · 已发 ' + String(r.posted),
          '处置 fixed ' + String(d.fixed ?? 0) + ' / wrong ' + String(d.wrong ?? 0) + ' / intentional ' + String(d.intentional ?? 0) + ' / wontfix ' + String(d.wontfix ?? 0) + ' / 未答复 ' + String(d.unanswered ?? 0),
          '噪音率 ' + (r.noiseRate === null ? '—' : Math.round(Number(r.noiseRate) * 100) + '%') + ' · 复报率 ' + (r.repeatRate === null ? '—' : Math.round(Number(r.repeatRate) * 100) + '%') + ' · 未验证 ' + String(r.unverified)].join('\n') }]
      } },
      timeoutMs: 60000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const ledger = new Ledger(root, config.stateDir)
        const head = typeof args.head === 'string' && args.head.trim() !== '' ? args.head.trim() : undefined
        return { version: PACKAGE_VERSION, ...ledger.status(head), byLens: lensStats(ledger) }
      },
    },
    {
      name: 'review_gate',
      description: 'CI 门禁：有未处置的 blocker/important 时返回 ok=false 与 exitCode=1，供流水线据此拒绝合并。对应文章里"未关闭不能合"。',
      parameters: compileParameters({ head: { type: 'string', description: '缺省用当前 HEAD' } }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        return [{ type: 'text', text: (r.ok ? '门禁通过' : '门禁失败') + ' · 未关闭 ' + String(r.open?.length ?? 0) + ' 条 · exit=' + String(r.exitCode) }]
      } },
      timeoutMs: 60000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        let head = typeof args.head === 'string' && args.head.trim() !== '' ? args.head.trim() : ''
        if (head === '') { const r = await git(root, ['rev-parse', 'HEAD'], 20000); head = r.ok ? r.stdout.trim() : '' }
        const ledger = new Ledger(root, config.stateDir)
        const record = ledger.head(head)
        const open = record === undefined ? [] : Object.values(record.posted).filter(f =>
          (f.severity === 'blocker' || f.severity === 'important') && (f.disposition === undefined || f.disposition === 'wrong' ? f.disposition === undefined : false))
        return { head, ok: open.length === 0, exitCode: open.length === 0 ? 0 : 1, open, note: open.length === 0 ? '没有未关闭的高优先级结论。' : '请修复或 review_respond 关闭这些结论后再合并。' }
      },
    },
    {
      name: 'review_learn',
      description: '把账本里的重复模式沉淀成 REVIEW.md 规则（文章里"修在源头"）。返回可直接粘贴的规则片段。',
      parameters: compileParameters({ minRepeat: { type: 'number', description: '触发阈值，默认 2' } }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        return [{ type: 'text', text: '建议 ' + String(r.suggestions?.length ?? 0) + ' 条规则\n' + String(r.markdown ?? '') }]
      } },
      timeoutMs: 60000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const minRepeat = typeof args.minRepeat === 'number' ? Math.max(2, Math.trunc(args.minRepeat)) : 2
        const ledger = new Ledger(root, config.stateDir)
        const all = allFindings(ledger)
        const byFile = new Map<string, number>()
        const byKind = new Map<string, number>()
        for (const f of all) { byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1); byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1) }
        const suggestions: string[] = []
        for (const [file, count] of [...byFile].filter(([, c]) => c >= minRepeat).sort((a, b) => b[1] - a[1]).slice(0, 5)) suggestions.push('文件反复出问题：' + file + '（' + count + ' 次）→ 建议在 REVIEW.md 里写明该文件的判据或指定 owner')
        for (const [kind, count] of [...byKind].filter(([, c]) => c >= minRepeat).sort((a, b) => b[1] - a[1]).slice(0, 5)) suggestions.push('问题类型反复出现：' + kind + '（' + count + ' 次）→ 建议加一条"坏掉长什么样"')
        const markdown = ['## 坏掉长什么样（自动沉淀，请人工确认）', ...suggestions.map(s => '- ' + s)].join('\n')
        return { suggestions, markdown, samples: all.length }
      },
    },
    {
      name: 'review_issue',
      description: 'issue 分诊：判定类型、给出复现要求，并生成一份交给调用方 AI 的完整作业书（含输出 JSON 路径）。',
      parameters: compileParameters({
        title: { type: 'string', required: true },
        body: { type: 'string' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        return [{ type: 'text', text: '分类 ' + String(r.kind) + '（' + String(r.confidence) + '）\n作业书：' + String(r.promptFile) + '\n产出：' + String(r.outFile) }]
      } },
      timeoutMs: 60000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const title = str(args.title, 'title')
        const text = typeof args.body === 'string' ? args.body : ''
        const guessed = classifyIssue(title + ' ' + text)
        const base = path.resolve(root, config.stateDir, 'triage')
        mkdirSync(base, { recursive: true })
        const id = fingerprintOf({ kind: 'issue', file: '', anchor: title })
        const promptFile = path.join(base, id + '.prompt.md')
        const outFile = path.join(base, id + '.json')
        writeFileSync(promptFile, buildIssueTriagePrompt({ title, body: text, root, outFile }), 'utf8')
        return { kind: guessed.kind, confidence: guessed.confidence, promptFile, outFile, prompt: readFileSync(promptFile, 'utf8') }
      },
    },
    {
      name: 'review_eval',
      description: '评测集（文章里"事故变评测集"）：register 登记历史 bug commit，score 用账本算召回，prompts 生成每个 commit 的审阅作业书交给 AI 执行。',
      parameters: compileParameters({
        action: { type: 'string', required: true, enum: ['register', 'list', 'score', 'prompts'] },
        entries: { type: 'array', items: { type: 'object', additionalProperties: true } },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        if (r.action === 'score') return [{ type: 'text', text: '召回 ' + String(r.found) + '/' + String(r.total) + '（' + String(Math.round((r.recall ?? 0) * 100)) + '%）' }]
        return [{ type: 'text', text: '评测集 ' + String(r.count ?? 0) + ' 条' + (r.files ? '\n作业书：' + r.files.join('\n') : '') }]
      } },
      timeoutMs: 60000,
      async execute(rawArgs: unknown, exec?: unknown) {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const action = str(args.action, 'action')
        const file = path.resolve(root, config.stateDir, 'eval.json')
        const state: { entries: Array<{ sha: string; note: string; addedAt: string }> } = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { entries: [] }
        if (action === 'register') {
          if (!Array.isArray(args.entries)) throw new Error('register 需要 entries 数组')
          for (const item of args.entries as Array<Record<string, unknown>>) {
            const sha = str(item.sha, 'entries[].sha')
            if (state.entries.some(e => e.sha === sha)) continue
            state.entries.push({ sha, note: typeof item.note === 'string' ? item.note : '', addedAt: new Date().toISOString() })
          }
          mkdirSync(path.dirname(file), { recursive: true })
          writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
          return { action, count: state.entries.length }
        }
        if (action === 'list') return { action, count: state.entries.length, entries: state.entries }
        if (action === 'prompts') {
          const dir = path.resolve(root, config.stateDir, 'eval')
          mkdirSync(dir, { recursive: true })
          const files: string[] = []
          for (const entry of state.entries) {
            const outFile = path.join(dir, entry.sha.slice(0, 12) + '.json')
            const promptFile = path.join(dir, entry.sha.slice(0, 12) + '.prompt.md')
            writeFileSync(promptFile, buildEvalPrompt({ root, sha: entry.sha, note: entry.note, outFile }), 'utf8')
            files.push(promptFile)
          }
          return { action, count: files.length, files }
        }
        // score
        const ledger = new Ledger(root, config.stateDir)
        let found = 0
        const detail: Array<{ sha: string; found: boolean; reason: string }> = []
        for (const entry of state.entries) {
          const record = ledger.head(entry.sha)
          const hit = record !== undefined && Object.keys(record.posted).length > 0
          if (hit) found++
          detail.push({ sha: entry.sha, found: hit, reason: record === undefined ? '未审阅过该 commit' : '已产出结论' })
        }
        return { action, total: state.entries.length, found, recall: state.entries.length === 0 ? 0 : found / state.entries.length, detail }
      },
    },
  ]
}

function allFindings(ledger: Ledger): Array<{ file: string; kind: string; severity: string; lens: string }> {
  const status = ledger.status()
  void status
  const out: Array<{ file: string; kind: string; severity: string; lens: string }> = []
  for (const head of ledgerHeads(ledger)) for (const f of Object.values(ledger.head(head)?.posted ?? {})) out.push({ file: f.file, kind: f.kind, severity: f.severity, lens: f.lens ?? '' })
  return out
}

function ledgerHeads(ledger: Ledger): string[] {
  return Object.keys((ledger as unknown as { state?: { heads?: Record<string, unknown> } }).state?.heads ?? {})
}

function lensStats(ledger: Ledger): Array<{ lens: string; posted: number; wrong: number; noise: number | null }> {
  const byLens = new Map<string, { posted: number; wrong: number; answered: number }>()
  for (const head of ledgerHeads(ledger)) {
    for (const f of Object.values(ledger.head(head)?.posted ?? {})) {
      const key = (f.lens ?? '') === '' ? 'unknown' : (f.lens as string)
      const row = byLens.get(key) ?? { posted: 0, wrong: 0, answered: 0 }
      row.posted++
      if (f.disposition !== undefined) row.answered++
      if (f.disposition === 'wrong' || f.disposition === 'intentional') row.wrong++
      byLens.set(key, row)
    }
  }
  return [...byLens.entries()].map(([lens, row]) => ({ lens, posted: row.posted, wrong: row.wrong, noise: row.answered === 0 ? null : Number((row.wrong / row.answered).toFixed(3)) })).sort((a, b) => b.posted - a.posted)
}

function classifyIssue(text: string): { kind: string; confidence: number } {
  const t = text.toLowerCase()
  if (/(crash|exception|error|报错|崩溃|失败|bug|异常|不能|无法)/.test(t)) return { kind: 'bug', confidence: 0.7 }
  if (/(feature|request|希望|建议|支持|enhancement|增加)/.test(t)) return { kind: 'feature', confidence: 0.65 }
  if (/(how|怎么|如何|usage|用法|文档)/.test(t)) return { kind: 'question', confidence: 0.55 }
  if (/(typo|错别字|文档错误|docs)/.test(t)) return { kind: 'docs', confidence: 0.5 }
  return { kind: 'question', confidence: 0.4 }
}
