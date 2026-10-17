/**
 * 编排：生成作业书 → 并行派发 → 收结果 → 过把关层。
 *
 * @module dsh-review/run
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildLensPrompt, type LensTask } from './lenses.js'
import type { Dispatcher } from './dispatch.js'
import type { CandidateFinding } from './gate.js'
import { planForMode, type Mode } from './modes.js'
import type { ReviewRules } from './rules.js'

export interface RunResult {
  tasks: LensTask[]
  dispatched: number
  failed: Array<{ id: string; reason: string }>
  findings: CandidateFinding[]
  declined: Array<{ lens: string; file: string; line: number; why: string }>
  missingOutputs: string[]
  dispatcher: Dispatcher['kind']
  reason?: string
}

function parseOutput(text: string, lens: string): { findings: CandidateFinding[]; declined: Array<{ lens: string; file: string; line: number; why: string }> } {
  const findings: CandidateFinding[] = []
  const declined: Array<{ lens: string; file: string; line: number; why: string }> = []
  let raw: any
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '').trim()) } catch { return { findings, declined } }
  for (const item of Array.isArray(raw?.findings) ? raw.findings : []) {
    if (typeof item?.file !== 'string' || typeof item?.anchor !== 'string' || typeof item?.message !== 'string') continue
    findings.push({
      file: item.file,
      line: typeof item.line === 'number' ? item.line : 0,
      kind: typeof item.kind === 'string' ? item.kind : 'correctness',
      severity: item.severity === 'blocker' || item.severity === 'nit' ? item.severity : 'important',
      message: item.message,
      anchor: item.anchor,
      evidence: typeof item.evidence === 'string' ? item.evidence : '',
      lens,
    })
  }
  for (const item of Array.isArray(raw?.declined) ? raw.declined : []) {
    if (typeof item?.file !== 'string') continue
    declined.push({ lens, file: item.file, line: typeof item.line === 'number' ? item.line : 0, why: typeof item.why === 'string' ? item.why : '' })
  }
  return { findings, declined }
}

export async function runLenses(input: {
  root: string
  head: string
  base: string
  mode: Mode
  rules: ReviewRules
  config: { stateDir: string; maxFindings: number }
  dispatcher: Dispatcher
}): Promise<RunResult> {
  const plan = planForMode(input.mode)
  const outDir = path.join(path.resolve(input.root, input.config.stateDir), 'raw', input.head.slice(0, 12))
  mkdirSync(outDir, { recursive: true })
  const tasks: LensTask[] = plan.finders.map(lens => {
    const outFile = path.join(outDir, lens.id + '.json')
    return { id: lens.id, title: lens.title, outFile, prompt: buildLensPrompt({ lens, root: input.root, base: input.base, mode: input.mode, rules: input.rules, outFile, maxFindings: input.config.maxFindings }) }
  })
  const failed: Array<{ id: string; reason: string }> = []
  const results = await Promise.all(tasks.map(async task => {
    const r = await input.dispatcher.dispatch(task)
    if (!r.ok) failed.push({ id: task.id, reason: r.reason ?? 'unknown' })
    return r
  }))
  await input.dispatcher.settle()
  const findings: CandidateFinding[] = []
  const declined: RunResult['declined'] = []
  const missingOutputs: string[] = []
  for (const task of tasks) {
    if (!existsSync(task.outFile)) { missingOutputs.push(task.id); continue }
    const parsed = parseOutput(readFileSync(task.outFile, 'utf8'), task.id)
    findings.push(...parsed.findings)
    declined.push(...parsed.declined)
  }
  return {
    tasks,
    dispatched: results.filter(r => r.ok).length,
    failed,
    findings,
    declined,
    missingOutputs,
    dispatcher: input.dispatcher.kind,
    reason: input.dispatcher.reason,
  }
}
