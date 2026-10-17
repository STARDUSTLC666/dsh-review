/**
 * 五个工具：review_diff（出计划）/ review_report（交结论）/ review_check（跑证据）
 * / review_respond（记处置）/ review_status（看噪音）。
 *
 * 设计原则照搬 Claude Code 团队的做法：
 * - 先验证再给人看：没有可执行证据的结论不发
 * - 风格类直接丢：style / diagnostics / cleanup 不进投票
 * - 只发一次：同 fingerprint 不复报，重复次数只记账
 * - 三轮收敛：超过轮次上限只审增量，并建议停下来重想方案
 *
 * @module dsh-review/tools
 */

import path from 'node:path'
import { realpathSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { git } from './exec.js'
import { parseDiff, type FileDiff } from './diff.js'
import { isSkipped, loadRules } from './rules.js'
import { fingerprintOf, normalizeLine } from './fingerprint.js'
import { classifyRisk, modeForRisk, planForMode, requiredApprovals, type Mode } from './modes.js'
import { isPreexisting } from './preexisting.js'
import { Ledger, type Disposition } from './ledger.js'
import { runCheck } from './check.js'
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

const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const DROP_KINDS = ['style', 'formatting', 'format', 'diagnostics', 'diagnostic', 'cleanup', 'nitpick', 'naming', 'whitespace']

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

interface FindingInput {
  file: string
  line: number
  kind: string
  severity: 'blocker' | 'important' | 'nit'
  message: string
  anchor: string
  evidence: string
  classOfBug?: string
}

export function buildReviewTools(config: ReviewConfig): ReviewToolDefinition[] {
  return [
    {
      name: 'review_diff',
      description: '生成审阅计划：读 diff、按风险分级选模式（quick/standard/deep）、加载仓库 REVIEW.md 规则、给出并行 finder 的镜头与预算。不产出结论，只产出"该怎么审"。',
      parameters: compileParameters({
        base: { type: 'string', description: '对比基准 Git ref（默认 HEAD，即审未提交改动）' },
        staged: { type: 'boolean', description: '审已暂存改动（git diff --cached）' },
        includeUntracked: { type: 'boolean', description: '把未跟踪的新文件按新增处理' },
        mode: { type: 'string', enum: ['quick', 'standard', 'deep'], description: '强制指定模式，缺省按风险自动分级' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        const lines = ['审阅计划 ' + String(r.mode ?? '') + ' · 风险 ' + String(r.risk ?? '') + ' · head ' + String(r.head ?? '').slice(0, 8)]
        lines.push('改动：' + String(r.files?.length ?? 0) + ' 文件  +' + String(r.added ?? 0) + ' / -' + String(r.removed ?? 0) + '；跳过 ' + String(r.skipped?.length ?? 0))
        for (const lens of (r.plan?.finders ?? [])) lines.push('- 镜头 ' + String(lens.title) + '：' + String(lens.focus))
        if (r.rules?.found) lines.push('规则：' + String(r.rules.path) + '（skip ' + String(r.rules.skip?.length ?? 0) + ' 条，nit 上限 ' + String(r.rules.maxNits ?? '-') + '）')
        if (r.advice) lines.push('注意：' + String(r.advice))
        return [{ type: 'text', text: lines.join('\n') }]
      } },
      timeoutMs: 120000,
      async execute(rawArgs: unknown, exec?: unknown): Promise<unknown> {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
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
          for (const file of untracked.filter(f => !existing.has(f))) {
            files.push({ path: file, oldPath: null, status: 'added', binary: false, hunks: [], added: 0, removed: 0 })
          }
        }
        const skipped = files.filter(f => isSkipped(f.path, rules.skip)).map(f => f.path)
        files = files.filter(f => !isSkipped(f.path, rules.skip))
        if (files.length === 0) {
          return { head, base: base ?? (staged ? 'index' : 'HEAD'), mode: 'quick', risk: 'low', approvals: 0, files: [], skipped, added: 0, removed: 0, plan: planForMode('quick'), rules, advice: '没有可审的改动。' }
        }
        const risk = classifyRisk(files.map(f => f.path), rules.sensitivePaths)
        const mode: Mode = (typeof args.mode === 'string' ? args.mode : rules.mode ?? modeForRisk(risk.tier, files.length)) as Mode
        if (!['quick', 'standard', 'deep'].includes(mode)) throw new Error('mode 只能是 quick | standard | deep')
        const plan = planForMode(mode)
        const ledger = new Ledger(root, config.stateDir)
        const record = ledger.head(head)
        ledger.ensureHead(head, mode).base = base ?? 'HEAD'
        ledger.save()
        const alreadyPosted = record === undefined ? 0 : Object.keys(record.posted).length
        const round = record?.round ?? 0
        let advice = ''
        if (round >= config.roundCap) advice = '该 head 已审 ' + round + ' 轮，达到上限：只审新 diff，或停下来重新考虑方案。'
        else if (round + 1 > config.diffOnlyAfterRound) advice = '第 ' + (round + 1) + ' 轮起只看增量：重复或旧代码里的问题不再发。'
        return {
          head, base: base ?? (staged ? 'index' : 'HEAD'), mode, risk: risk.tier, riskReasons: risk.reasons, approvals: requiredApprovals(risk.tier),
          files: files.map(f => ({ path: f.path, status: f.status, added: f.added, removed: f.removed, hunks: f.hunks.length, binary: f.binary })),
          skipped, added: parsed.added, removed: parsed.removed,
          rules: { found: rules.found, path: rules.path, skip: rules.skip, maxNits: rules.maxNits, severityFloor: rules.severityFloor, mode: rules.mode, failureSignals: rules.failureSignals },
          plan, round, alreadyPosted, diffOnly: round + 1 > config.diffOnlyAfterRound, budget: plan.estimatedCalls, advice,
        }
      },
    },
    {
      name: 'review_report',
      description: '提交本轮审阅结论。插件负责：丢弃风格类、按 fingerprint 去重、标记 pre-existing、检查证据、执行轮次上限与 nit 上限，只返回"可以发"的条目。',
      parameters: compileParameters({
        head: { type: 'string', required: true, description: 'review_diff 返回的 head' },
        findings: { type: 'array', required: true, description: '候选结论数组：{file,line,kind,severity,message,anchor,evidence,classOfBug?}', items: { type: 'object', additionalProperties: true } },
        mode: { type: 'string', enum: ['quick', 'standard', 'deep'], description: '本轮模式（缺省沿用该 head 上次）' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        const lines = ['第 ' + String(r.round) + ' 轮：可发 ' + String(r.postable?.length ?? 0) + ' 条，压制 ' + String(r.suppressed ?? 0) + '，丢弃 ' + String(r.dropped ?? 0) + '，未验证 ' + String(r.unverified ?? 0)]
        for (const f of (r.postable ?? [])) lines.push('- [' + String(f.severity) + '] ' + String(f.file) + ':' + String(f.line) + ' ' + String(f.message).slice(0, 110) + (f.preexisting ? '（预存在）' : ''))
        if (r.advice) lines.push('建议：' + String(r.advice))
        return [{ type: 'text', text: lines.join('\n') }]
      } },
      timeoutMs: 180000,
      async execute(rawArgs: unknown, exec?: unknown): Promise<unknown> {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const head = str(args.head, 'head')
        const rules = loadRules(root)
        if (!Array.isArray(args.findings)) throw new Error('findings 必须是数组')
        const input = args.findings.map((item, index) => {
          const f = (item ?? {}) as Record<string, unknown>
          const file = str(f.file, 'findings[' + index + '].file')
          const anchor = str(f.anchor, 'findings[' + index + '].anchor')
          const message = str(f.message, 'findings[' + index + '].message')
          const kind = typeof f.kind === 'string' ? f.kind : 'correctness'
          const severity = f.severity === 'blocker' || f.severity === 'nit' ? f.severity : 'important'
          return { file, line: typeof f.line === 'number' ? f.line : 0, kind, severity, message, anchor, evidence: typeof f.evidence === 'string' ? f.evidence : '', classOfBug: typeof f.classOfBug === 'string' ? f.classOfBug : undefined } as FindingInput
        })
        const ledger = new Ledger(root, config.stateDir)
        const existing = ledger.head(head)
        const mode: Mode = (typeof args.mode === 'string' ? args.mode : existing?.mode ?? 'standard') as Mode
        const record = ledger.beginRound(head, mode)
        const diffOnly = record.round > config.diffOnlyAfterRound
        const floor = rules.severityFloor ?? config.severityFloor
        const maxNits = rules.maxNits ?? config.maxNits
        const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
        const recordedBase = ledger.head(head)?.base
        const base = recordedBase !== undefined && recordedBase !== null ? recordedBase : (await git(root, ['rev-parse', 'HEAD~1'], 20000)).ok ? 'HEAD~1' : EMPTY_TREE
        const postable: any[] = []
        const suppressedList: string[] = []
        const droppedList: Array<{ file: string; reason: string }> = []
        let nitCount = 0
        let unverified = 0
        let dropped = 0
        for (const finding of input) {
          const lowered = finding.kind.toLowerCase()
          if (DROP_KINDS.includes(lowered)) { dropped++; droppedList.push({ file: finding.file, reason: '风格/诊断类不发：' + finding.kind }); continue }
          const fingerprint = fingerprintOf({ kind: finding.kind, file: finding.file, anchor: finding.anchor })
          const previous = record.posted[fingerprint]
          if (previous !== undefined) {
            previous.repeats = (previous.repeats ?? 0) + 1
            record.suppressed += 1
            suppressedList.push(fingerprint)
            continue
          }
          if (diffOnly && record.reviewedFiles.length > 0 && !record.reviewedFiles.includes(finding.file)) {
            dropped++; droppedList.push({ file: finding.file, reason: '第 ' + record.round + ' 轮起只看增量，该文件本轮未变' })
            continue
          }
          const preexisting = await isPreexisting(root, base, finding.file, finding.anchor)
          if (severityRank(finding.severity) < severityRank(floor) && !preexisting) { dropped++; droppedList.push({ file: finding.file, reason: '低于严重度下限 ' + floor }); continue }
          if (finding.evidence === '' && config.evidenceRequired) {
            unverified++
            record.unverified += 1
            ledger.event('unverified', { head, file: finding.file, fingerprint, message: finding.message })
            continue
          }
          if (finding.severity === 'nit' && nitCount >= maxNits) { dropped++; droppedList.push({ file: finding.file, reason: 'nit 已达上限 ' + maxNits }); continue }
          if (postable.length >= config.maxFindings) { dropped++; droppedList.push({ file: finding.file, reason: '单轮上限 ' + config.maxFindings }); continue }
          if (finding.severity === 'nit') nitCount++
          const entry = { fingerprint, file: finding.file, line: finding.line, kind: finding.kind, severity: preexisting ? 'pre-existing' as const : finding.severity, message: finding.message, evidence: finding.evidence, preexisting, classOfBug: finding.classOfBug }
          postable.push(entry)
          ledger.remember(record, { ...entry, at: new Date().toISOString(), repeats: 0 })
        }
        record.dropped += dropped
        ledger.save()
        ledger.event('round', { head, round: record.round, mode, postable: postable.length, suppressed: suppressedList.length, dropped, unverified })
        let advice = ''
        if (record.round >= config.roundCap) advice = '已达 ' + config.roundCap + ' 轮上限：请作者停下来重新考虑方案，而不是继续逐条修。'
        return { head, round: record.round, mode, postable, suppressed: suppressedList.length, suppressedFingerprints: suppressedList, dropped, droppedDetail: droppedList.slice(0, 20), unverified, totals: { posted: Object.keys(record.posted).length, reviewedFiles: record.reviewedFiles.length }, advice }
      },
    },
    {
      name: 'review_check',
      description: '为一条结论跑证据：执行命令/测试并返回退出码与输出摘要。review_report 的 evidence 字段应引用这里的结果。',
      parameters: compileParameters({
        command: { type: 'string', required: true, description: '要执行的命令（在仓库根或 cwd 下）' },
        cwd: { type: 'string', description: '相对仓库根的工作目录' },
        timeoutMs: { type: 'number', description: '超时毫秒，缺省用配置' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        return [{ type: 'text', text: (r.ok ? '证据通过' : '证据失败') + ' · exit=' + String(r.exitCode) + ' · ' + String(r.durationMs) + 'ms' + (r.timedOut ? '（超时）' : '') + '\n' + String(r.output ?? '').slice(0, 1200) }]
      } },
      timeoutMs: 300000,
      async execute(rawArgs: unknown, exec?: unknown): Promise<unknown> {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const command = str(args.command, 'command')
        const timeoutMs = typeof args.timeoutMs === 'number' ? Math.trunc(args.timeoutMs) : config.commandTimeoutMs
        const cwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? path.resolve(root, args.cwd.trim()) : undefined
        const result = await runCheck(root, command, timeoutMs, cwd)
        return result
      },
    },
    {
      name: 'review_respond',
      description: '记录一条结论的处置（fixed / wrong / intentional / wontfix）。这是噪音率的唯一数据来源：说"错了"的越多，说明审阅越吵。',
      parameters: compileParameters({
        head: { type: 'string', required: true, description: '结论所属 head' },
        fingerprint: { type: 'string', description: '结论指纹（review_report 返回）' },
        file: { type: 'string', description: '没有指纹时用 file + line 定位' },
        line: { type: 'number', description: '行号' },
        disposition: { type: 'string', required: true, enum: ['fixed', 'wrong', 'intentional', 'wontfix'], description: '处置结果' },
        note: { type: 'string', description: '一句话理由' },
      }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        if (r.ok !== true) return [{ type: 'text', text: '未找到该结论：' + String(r.reason ?? '') }]
        return [{ type: 'text', text: '已记录 ' + String(r.fingerprint) + ' → ' + String(r.disposition) + (r.note ? '（' + String(r.note) + '）' : '') }]
      } },
      timeoutMs: 60000,
      async execute(rawArgs: unknown, exec?: unknown): Promise<unknown> {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const head = str(args.head, 'head')
        const disposition = str(args.disposition, 'disposition') as Disposition
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
        const updated = ledger.respond(head, fingerprint, disposition, typeof args.note === 'string' ? args.note : undefined)
        if (updated === undefined) return { ok: false, reason: '该 head 下没有这个 fingerprint' }
        ledger.save()
        ledger.event('respond', { head, fingerprint, disposition, note: args.note })
        return { ok: true, fingerprint, disposition, note: args.note, status: ledger.status(head) }
      },
    },
    {
      name: 'review_status',
      description: '看噪音与收敛：轮次、按处置分布、噪音率、复报率、未验证数、被丢弃数。改 prompt 前后对比这个数。',
      parameters: compileParameters({ head: { type: 'string', description: '只看某个 head（缺省全部）' } }),
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a: unknown, v: unknown) => {
        const r = (v ?? {}) as Record<string, any>
        const d = r.byDisposition ?? {}
        const lines = ['审阅状态（v' + PACKAGE_VERSION + '）', 'head 数 ' + String(r.heads) + ' · 最高轮次 ' + String(r.round) + ' · 已发 ' + String(r.posted)]
        lines.push('处置：fixed ' + String(d.fixed ?? 0) + ' / wrong ' + String(d.wrong ?? 0) + ' / intentional ' + String(d.intentional ?? 0) + ' / wontfix ' + String(d.wontfix ?? 0) + ' / 未答复 ' + String(d.unanswered ?? 0))
        lines.push('噪音率 ' + (r.noiseRate === null ? '—' : String(Math.round(Number(r.noiseRate) * 100)) + '%') + ' · 复报率 ' + (r.repeatRate === null ? '—' : String(Math.round(Number(r.repeatRate) * 100)) + '%') + ' · 未验证 ' + String(r.unverified) + ' · 丢弃 ' + String(r.dropped))
        if ((r.topKinds ?? []).length) lines.push('类型分布：' + (r.topKinds as any[]).map(k => String(k.kind) + '×' + String(k.count)).join('，'))
        return [{ type: 'text', text: lines.join('\n') }]
      } },
      timeoutMs: 60000,
      async execute(rawArgs: unknown, exec?: unknown): Promise<unknown> {
        const args = (rawArgs ?? {}) as Record<string, unknown>
        const root = sessionRoot(exec)
        const ledger = new Ledger(root, config.stateDir)
        const head = typeof args.head === 'string' && args.head.trim() !== '' ? args.head.trim() : undefined
        return { version: PACKAGE_VERSION, ...ledger.status(head) }
      },
    },
  ]
}
