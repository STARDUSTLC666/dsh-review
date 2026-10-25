import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { finderTask, verifierTask, arbiterTask, riskTask, type LensTask, type TaskInput } from './lenses.js'
import { planForMode, classifyRisk, type Mode } from './modes.js'
import { parseCandidate, parseVote, voteDecision, gateFindings, type CandidateFinding, type Vote } from './gate.js'
import { Ledger, type StoredRun, type HeadRecord } from './ledger.js'
import { captureTarget, targetArgs, type ReviewTarget } from './target.js'
import type { ReviewConfig } from './config.js'
import type { Dispatcher } from './dispatch.js'
import { prepareScope, inScope } from './scope.js'
function inputFor(run: StoredRun, ledger: Ledger, config: ReviewConfig): TaskInput {
 return { runId: run.id, target: run.target, mode: run.mode, outDir: path.join(ledger.directory, 'runs', run.id), snapshotFile: path.join(ledger.directory, 'runs', run.id, 'snapshot.json'), maxFindings: config.maxFindings }
}
export function startRun(target: ReviewTarget, mode: Mode, config: ReviewConfig, ledger: Ledger, independent: boolean): StoredRun {
 const id = randomUUID(), now = new Date().toISOString()
 const run = ledger.transaction(state => {
  const prior = state.heads[target.series], pending = prior?.latestRunId ? state.runs[prior.latestRunId] : undefined
  if (pending?.lease) throw new Error('A review is still executing; cancel it and wait for its workers to stop first')
  if (pending && ['running','pending','incomplete'].includes(pending.status) && pending.targetId === target.id && pending.stage !== 'done') throw new Error('Resume or explicitly abandon the existing review run ' + pending.id + ' instead of overlapping work')
  if (pending && pending.targetId !== target.id && ['running','pending','incomplete'].includes(pending.status)) { pending.status = 'stale'; pending.errors.push('Superseded by a changed target') }
  const round = prior?.round ?? 0
  if (round >= config.roundCap) throw new Error('Review round cap reached. Stop and reconsider the approach.')
  const record: HeadRecord = prior ?? { head: target.head, round: 0, mode, posted: {}, reviewedFiles: [], dropped: 0, suppressed: 0, unverified: 0, updatedAt: now }
  Object.assign(record, { round, head: target.head, base: target.base, targetId: target.id, series: target.series, latestRunId: id, mode })
  state.heads[target.series] = record
  const created: StoredRun = { id, targetId: target.id, series: target.series, head: target.head, target, mode, status: 'pending', stage: 'find', tasks: [], results: {}, candidates: [], round: round + 1, calls: 0, errors: [], createdAt: now, postable: [], rejected: [], unverified: 0, independent }
  const input = inputFor(created, ledger, config)
  created.tasks = [...planForMode(mode).finders.map(lens => finderTask(input, lens)), riskTask(input, false), riskTask(input, true)]; state.runs[id] = created
  return created
 })
 const input = inputFor(run, ledger, config)
 mkdirSync(input.outDir, { recursive: true })
 ledger.event('run-start', { runId: id, targetId: target.id, mode, independent })
 return run
}
export function parseTaskResult(task: LensTask, text: string, target: ReviewTarget, maxFindings: number, candidate?: CandidateFinding): Record<string, any> {
 if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Worker output exceeds 1 MiB')
 const value = JSON.parse(text.trim().replace(/^\x60{3}(?:json)?\s*\n([\s\S]*?)\n\x60{3}$/, '$1'))
 if (!value || value.runId !== task.runId || value.targetId !== task.targetId || value.taskId !== task.id) throw new Error('Wrong run, target or task identity')
 if (task.role === 'find') {
  if (!Array.isArray(value.findings) || !Array.isArray(value.declined) || value.findings.length > maxFindings) throw new Error('Invalid or excessive finder output')
  const parsed = value.findings.map((finding: unknown) => parseCandidate(finding, task.id, target))
  return { runId: task.runId, targetId: task.targetId, taskId: task.id, findings: parsed.filter(Boolean), ignoredStyleCount: parsed.filter((finding: unknown) => finding === null).length, declined: value.declined }
 }
 if (task.role === 'verify') return { runId: task.runId, targetId: task.targetId, ...parseVote(value, task.id, task.candidateId!, target, candidate) }
 if (task.role === 'risk') {
  if (!['low','medium','high'].includes(value.tier) || typeof value.extraHuman !== 'boolean' || !Array.isArray(value.reasons) || !value.reasons.length || value.reasons.some((r: unknown) => typeof r !== 'string' || !r.trim())) throw new Error('Invalid risk classification')
  return { runId: task.runId, targetId: task.targetId, taskId: task.id, tier: value.tier, extraHuman: value.extraHuman, reasons: value.reasons }
 }
 if (!Array.isArray(value.orderedIds) || value.orderedIds.some((id: unknown) => typeof id !== 'string') || typeof value.summary !== 'string' || !value.summary.trim() || typeof value.needsHuman !== 'boolean') throw new Error('Invalid arbiter output')
 return { runId: task.runId, targetId: task.targetId, taskId: task.id, orderedIds: value.orderedIds, summary: value.summary, needsHuman: value.needsHuman }
}
export function submitResults(ledger: Ledger, runId: string, targetId: string, values: unknown[], config: ReviewConfig): void {
 ledger.transaction(state => {
  const run = state.runs[runId]
  if (!run || run.targetId !== targetId || run.stage === 'done' || ['failed','cancelled','stale'].includes(run.status)) throw new Error('Unknown, terminal or mismatched review run')
  const pending = run.tasks.filter(task => !Object.hasOwn(run.results, task.id))
  const parsed = values.map(value => {
   const task = pending.find(task => task.id === (value as { taskId?: string })?.taskId)
   if (!task) throw new Error('Result duplicated or not a task in this stage')
   return [task.id, parseTaskResult(task, JSON.stringify(value), run.target, config.maxFindings, run.candidates.find(candidate => candidate.id === task.candidateId))] as const
  })
  if (new Set(parsed.map(([id]) => id)).size !== parsed.length) throw new Error('Duplicate task result')
  for (const [id, value] of parsed) run.results[id] = value
  run.status = 'pending'
 })
}
function votesFor(run: StoredRun): Record<string, Vote[]> {
 const votes: Record<string, Vote[]> = {}
 for (const task of run.tasks.filter(task => task.role === 'verify')) {
  const value = run.results[task.id] as Vote | undefined
  if (value) {
   try {
    const checked = parseVote(value, task.id, task.candidateId!, run.target, run.candidates.find(candidate => candidate.id === task.candidateId))
    ;(votes[task.candidateId!] ??= []).push(checked)
   } catch { /* Old or invalid persisted votes leave the finding unverified. */ }
  }
 }
 return votes
}
export function advance(ledger: Ledger, runId: string, config: ReviewConfig): void {
 ledger.transaction(state => {
  const run = state.runs[runId]
  if (!run || run.stage === 'done' || ['failed','cancelled','stale'].includes(run.status) || run.tasks.some(task => !Object.hasOwn(run.results, task.id))) return
  const input = inputFor(run, ledger, config), plan = planForMode(run.mode), record = state.heads[run.series]
  if (run.stage === 'find') {
   const floor = classifyRisk(run.target.allPaths, run.target.rules.sensitivePaths)
   const classifiers = ['risk-classifier','risk-second'].map(id => run.results[id] as { tier: 'low' | 'medium' | 'high'; reasons: string[]; extraHuman: boolean })
   const levels = ['low','medium','high'] as const
   const tier = levels[Math.max(levels.indexOf(floor.tier), ...classifiers.map(c => levels.indexOf(c.tier)))]
   run.risk = { tier, reasons: [...floor.reasons, ...classifiers.flatMap(c => c.reasons)], extraHuman: classifiers.some(c => c.extraHuman) }
   if (tier === 'high' && run.mode !== 'deep') {
    run.mode = 'deep'
    const missing = planForMode('deep').finders.filter(lens => !run.tasks.some(task => task.id === 'find-' + lens.id))
    run.tasks.push(...missing.map(lens => finderTask({ ...input, mode: 'deep' }, lens))); return
   }
   const candidates = new Map<string, CandidateFinding>()
   record.dropped += Object.values(run.results).reduce((n: number, value) => n + ((value as { ignoredStyleCount?: number }).ignoredStyleCount ?? 0), 0)
   for (const value of Object.values(run.results) as Array<{ findings?: CandidateFinding[] }>) for (const finding of value.findings ?? []) {
    if (!inScope(finding, run.scope, run.target)) continue
    const existing = candidates.get(finding.id!), rank = { blocker: 3, important: 2, nit: 1 }
    if (!existing || rank[finding.severity] > rank[existing.severity]) candidates.set(finding.id!, finding)
   }
   for (const [id, former] of Object.entries(record.posted)) if (!former.disposition && former.severity !== 'pre-existing' && former.anchor && !candidates.has(id)) candidates.set(id, { id, file: former.file, line: former.line, kind: former.kind, severity: former.severity, message: former.message, anchor: former.anchor, evidence: former.evidence, carried: true, ...(former.classOfBug ? { classOfBug: former.classOfBug } : {}), ...(former.lens ? { lens: former.lens } : {}) })
   run.candidates = [...candidates.values()]
   if (run.candidates.length > config.maxFindings) { run.status = 'incomplete'; run.errors.push('Candidate budget exceeded; split the target'); return }
   run.stage = 'verify'; run.tasks.push(...run.candidates.flatMap(finding => Array.from({ length: plan.verifiersPerFinding }, (_, i) => verifierTask(input, finding, i))))
   if (run.tasks.some(task => !Object.hasOwn(run.results, task.id))) return
  }
  const votes = votesFor(run)
  if (run.stage === 'verify' && plan.arbiter) {
   const confirmed = run.candidates.filter(f => ['confirm','pre-existing'].includes(voteDecision(votes[f.id!] ?? [], plan.verifiersPerFinding)))
   run.stage = 'arbiter'; run.tasks.push(arbiterTask(input, confirmed, votes)); return
  }
  const confirmedIds = run.candidates.filter(f => ['confirm','pre-existing'].includes(voteDecision(votes[f.id!] ?? [], plan.verifiersPerFinding))).map(f => f.id!)
  if (run.stage === 'arbiter') {
   const result = run.results.arbiter as { orderedIds: string[]; needsHuman: boolean }
   if (result.needsHuman || new Set(result.orderedIds).size !== confirmedIds.length || result.orderedIds.length !== confirmedIds.length || confirmedIds.some(id => !result.orderedIds.includes(id))) { run.status = 'incomplete'; run.errors.push('Arbiter requires human attention or changed the accepted finding set'); return }
  }
  const gated = gateFindings({ root: run.target.root, head: run.head, base: run.target.base, mode: run.mode, findings: run.candidates, config, rules: run.target.rules, record, ledger, target: run.target, votes, requiredVotes: plan.verifiersPerFinding })
  run.postable = gated.postable; run.rejected = gated.rejected; run.unverified = gated.unverified
  run.accepted = Object.values(record.posted).filter(f => f.targetId === run.targetId && !f.disposition).map(f => structuredClone(f))
  run.summary = run.accepted.length + ' verified finding(s), ' + gated.unverified + ' unverified. ' + (run.accepted.length ? 'Resolve every finding with a fix or a specific reason.' : 'No verified defect to fix in the reviewed scope.')
  run.stage = 'done'; run.status = gated.unverified ? 'incomplete' : 'complete'; run.completedAt = new Date().toISOString()
  if (run.status === 'complete') record.round = run.round
  record.updatedAt = new Date().toISOString()
 })
}
export async function assertCurrent(run: StoredRun, ledger: Ledger, config: ReviewConfig, signal?: AbortSignal): Promise<void> {
 let current: ReviewTarget
 try { current = await captureTarget(run.target.root, targetArgs(run.target), config.maxDiffBytes, config.stateDir, signal) }
 catch (error) { ledger.transaction(state => { const r = state.runs[run.id]; r.status = signal?.aborted ? 'cancelled' : 'incomplete'; r.errors.push(error instanceof Error ? error.message : String(error)) }); throw error }
 if (current.id !== run.targetId) { ledger.transaction(state => { state.runs[run.id].status = 'stale'; state.runs[run.id].errors.push('Target changed; prior findings cannot approve this version') }); throw new Error('Review target changed; prior approval is invalid') }
}
async function executeStages(ledger: Ledger, runId: string, config: ReviewConfig, dispatcher: Dispatcher, signal: AbortSignal): Promise<StoredRun> {
 for (;;) {
  const run = ledger.snapshot().runs[runId]
  if (!run) throw new Error('Unknown run')
  if (['failed','cancelled','stale'].includes(run.status)) return run
  await assertCurrent(run, ledger, config, signal)
  if (run.stage === 'done') return run
  if (!run.scope) { await prepareScope(run, ledger, config, signal); continue }
  const pending = run.tasks.filter(task => !Object.hasOwn(run.results, task.id))
  if (!pending.length) {
   advance(ledger, runId, config)
   const updated = ledger.snapshot().runs[runId]
   if (updated.status === 'incomplete' && updated.tasks.length === run.tasks.length) return updated
   continue
  }
  if (dispatcher.kind === 'external') return run
  if (run.calls + pending.length > config.maxCalls) { ledger.transaction(state => { state.runs[runId].status = 'incomplete'; state.runs[runId].errors.push('Actual model call budget exhausted') }); return ledger.snapshot().runs[runId] }
  ledger.transaction(state => { state.runs[runId].status = 'running' })
  let next = 0, failed = false
  await Promise.all(Array.from({ length: Math.min(config.maxParallel, pending.length) }, async () => {
   for (;;) {
    const task = pending[next++]; if (!task) return
    try {
     signal.throwIfAborted()
     ledger.transaction(state => { state.runs[runId].calls++ })
     const result = await dispatcher.dispatch(task)
     if (!result.ok) throw new Error(result.reason ?? 'Worker failed')
     const text = result.output ?? ''
     const parsed = parseTaskResult(task, text, run.target, config.maxFindings, run.candidates.find(candidate => candidate.id === task.candidateId))
     ledger.transaction(state => { state.runs[runId].results[task.id] = parsed })
    } catch (error) { failed = true; ledger.transaction(state => { const r = state.runs[runId]; r.errors.push(task.id + ': ' + (error instanceof Error ? error.message : String(error))); r.status = signal.aborted ? 'cancelled' : 'incomplete' }) }
   }
  }))
  await dispatcher.settle()
  if (failed) return ledger.snapshot().runs[runId]
  signal.throwIfAborted()
  ledger.transaction(state => { state.runs[runId].status = 'pending' })
 }
}
export async function executeRun(ledger: Ledger, runId: string, config: ReviewConfig, dispatcher: Dispatcher, signal: AbortSignal): Promise<StoredRun> {
 const lease = randomUUID()
 ledger.transaction(state => {
  const run = state.runs[runId]
  if (!run) throw new Error('Unknown review run')
  if (run.lease && run.leasePid) {
   let alive = true
   try { process.kill(run.leasePid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false }
   if (!alive) { delete run.lease; delete run.leasePid; run.status = 'incomplete'; run.errors.push('Recovered interrupted worker owner; no approval was preserved') }
  }
  if (run.lease) throw new Error('This review run is already executing')
  run.lease = lease; run.leasePid = process.pid
 })
 try { return await executeStages(ledger, runId, config, dispatcher, signal) }
 finally { ledger.transaction(state => { const run = state.runs[runId]; if (run?.lease === lease) { delete run.lease; delete run.leasePid } }) }
}
export function runView(run: StoredRun) {
 return { runId: run.id, targetId: run.targetId, head: run.head, mode: run.mode, status: run.status, stage: run.stage, independent: run.independent,
  round: run.round, calls: run.calls, errors: run.errors, risk: run.risk ?? null, postable: run.postable, rejected: run.rejected, unverified: run.unverified, incremental: run.scope?.incremental ?? false, summary: run.summary ?? 'Review has not completed; no clean conclusion is available.',
  missingOutputs: run.tasks.filter(task => !Object.hasOwn(run.results, task.id)).map(task => task.id), tasks: run.tasks.filter(task => !Object.hasOwn(run.results, task.id)) }
}
