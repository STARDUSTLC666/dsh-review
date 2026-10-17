import path from 'node:path'
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { classifyRisk, modeForRisk, planForMode, requiredApprovals, type Mode } from './modes.js'
import { Ledger, type StoredRun, type Disposition } from './ledger.js'
import { captureTarget, type ReviewTarget } from './target.js'
import { runCheck, type CommandRunner, type ToolExecutionContext } from './check.js'
import { externalDispatcher, type Dispatcher } from './dispatch.js'
import { startRun, executeRun, submitResults, assertCurrent, runView } from './run.js'
import { evaluation } from './eval.js'
import { buildIssueTriagePrompt } from './lenses.js'
import { automatedVerdict } from './verdict.js'
import type { ReviewConfig } from './config.js'

export interface ContentBlock { type: 'text'; text: string }
export interface ReviewToolDefinition {
 name: string; description: string
 parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
 output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): ContentBlock[] }
 execute(args: unknown, exec?: unknown): Promise<unknown>
 timeoutMs?: number
}
export interface BuildOptions {
 runner?: CommandRunner
 dispatcher?: (exec: ToolExecutionContext, root: string, signal: AbortSignal) => Dispatcher
}
function parameters(spec: Record<string, any>): ReviewToolDefinition['parameters'] {
 const properties: Record<string, unknown> = {}, required: string[] = []
 for (const [key, { required: needed, ...schema }] of Object.entries(spec)) {
  properties[key] = schema
  if (needed) required.push(key)
 }
 return { type: 'object', properties, additionalProperties: false, ...(required.length ? { required } : {}) }
}
function rootFor(exec: ToolExecutionContext): string {
 const cwd = exec.agent?.session?.header?.cwd
 return realpathSync(typeof cwd === 'string' && cwd ? cwd : process.cwd())
}
function text(value: unknown, name: string): string {
 if (typeof value !== 'string' || !value.trim()) throw new Error(name + ' must be a non-empty string')
 return value.trim()
}
function getRun(ledger: Ledger, args: Record<string, any>, root: string): StoredRun {
 const run = ledger.snapshot().runs[text(args.runId, 'runId')]
 if (!run || run.target.root !== root) throw new Error('Unknown run in this workspace')
 if (args.targetId !== undefined && args.targetId !== run.targetId) throw new Error('Wrong targetId')
 return run
}
function modeFor(target: ReviewTarget, requested: unknown): Mode {
 if (requested !== undefined && !['quick','standard','deep'].includes(String(requested))) throw new Error('Invalid review mode')
 const risk = classifyRisk(target.allPaths, target.rules.sensitivePaths)
 return risk.tier === 'high' ? 'deep' : (requested ?? target.rules.mode ?? modeForRisk(risk.tier, target.files.length)) as Mode
}
const targetSpec = {
 base: { type: 'string', description: 'Compare the merge base of this ref with HEAD; omit for working tree.' },
 staged: { type: 'boolean', description: 'Review index snapshots, independently of the working tree.' },
 includeUntracked: { type: 'boolean', description: 'Include untracked files; default true for working-tree reviews.' },
 mode: { type: 'string', enum: ['quick','standard','deep'], description: 'Sensitive paths always require deep.' },
}
const runSpec = { runId: { type: 'string', required: true }, targetId: { type: 'string', required: true } }
function render(_args: unknown, value: unknown): ContentBlock[] {
 const result = value as any
 if (result.runId) return [{ type: 'text', text: 'Review ' + result.runId + ' · ' + (result.status ?? (result.ok ? 'automated checks passed' : 'blocked')) + '\n' + JSON.stringify(result, null, 2) }]
 return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}
export function buildReviewTools(config: ReviewConfig, options: BuildOptions = {}): ReviewToolDefinition[] {
 function tool(name: string, description: string, spec: Record<string, any>, execute: (args: Record<string, any>, exec: ToolExecutionContext, root: string, ledger: Ledger) => Promise<unknown>, timeoutMs = 120000): ReviewToolDefinition {
  return { name, description, parameters: parameters(spec), output: { schema: { type: 'object', additionalProperties: true }, render }, timeoutMs,
   async execute(raw, context) {
    const exec = (context ?? {}) as ToolExecutionContext
    exec.signal?.throwIfAborted()
    const root = rootFor(exec), ledger = new Ledger(root, config.stateDir)
    const value = await execute((raw ?? {}) as Record<string, any>, exec, root, ledger)
    // DSH uses lossless JSON: omit absent optional fields, never emit undefined.
    return JSON.parse(JSON.stringify(value))
   } }
 }
 return [
  tool('review_diff', 'Capture an immutable diff and source snapshot, then plan independent review. This is a plan, never an approval.', targetSpec,
   async (args, exec, root, ledger) => {
    const target = await captureTarget(root, args, config.maxDiffBytes, config.stateDir, exec.signal)
    const risk = classifyRisk(target.allPaths, target.rules.sensitivePaths), mode = modeFor(target, args.mode)
    const record = ledger.snapshot().heads[target.series]
    return { targetId: target.id, head: target.head, base: target.base, kind: target.kind, mode, risk, suggestedHumanApprovals: requiredApprovals(risk.tier),
     files: target.files.map(f => ({ path: f.path, oldPath: f.oldPath, status: f.status, binary: f.binary, added: f.addedLines.length, removed: f.removedLines.length })),
     skipped: target.skipped, rules: target.rules, plan: planForMode(mode), completedRounds: record?.round ?? 0, roundCap: config.roundCap, maxCalls: config.maxCalls,
     advice: 'Fresh-context bug finders, independent verification and two risk classifications. No merge or human approval is granted.' }
   }),
  tool('review_run', 'Run fresh-context finders, two risk classifiers, independent verifiers and deep-mode arbitration. Resume with runId; dryRun returns task envelopes and never passes the automatic gate.',
   { ...targetSpec, runId: { type: 'string', description: 'Resume this run; omit to start a new snapshot.' }, dryRun: { type: 'boolean' }, abandon: { type: 'boolean', description: 'Explicitly stop this run; no approval survives.' } },
   async (args, exec, root, ledger) => {
    if (args.abandon === true) {
     const run = getRun(ledger, args, root)
     if (run.lease) throw new Error('Cancel the active tool call first and wait for its workers to stop before abandoning it')
     if (run.status === 'complete') throw new Error('Completed reviews cannot be abandoned; changing code invalidates their target')
     ledger.transaction(state => { state.runs[run.id].status = 'cancelled'; state.runs[run.id].errors.push('Explicitly abandoned by caller') })
     return runView(ledger.snapshot().runs[run.id])
    }
    const signal = exec.signal ? AbortSignal.any([exec.signal, AbortSignal.timeout(config.runTimeoutMs)]) : AbortSignal.timeout(config.runTimeoutMs)
    const dispatcher = args.dryRun === true ? externalDispatcher('Manual task book: independence cannot be verified, so the automatic gate stays blocked.') : options.dispatcher?.(exec, root, signal) ?? externalDispatcher()
    let run: StoredRun
    if (args.runId) run = getRun(ledger, args, root)
    else {
     const target = await captureTarget(root, args, config.maxDiffBytes, config.stateDir, signal)
     run = startRun(target, modeFor(target, args.mode), config, ledger, dispatcher.kind === 'subagents')
    }
    try {
     const updated = await executeRun(ledger, run.id, config, dispatcher, signal)
     return { ...runView(updated), dispatcher: dispatcher.kind, ...(dispatcher.reason ? { reason: dispatcher.reason } : {}) }
    } catch (error) {
     if (ledger.snapshot().runs[run.id].lease) throw error
     ledger.transaction(state => { const r = state.runs[run.id]; if (!['stale','complete','cancelled'].includes(r.status)) r.status = signal.aborted ? 'cancelled' : 'incomplete'; r.errors.push(error instanceof Error ? error.message : String(error)) })
     return { ...runView(ledger.snapshot().runs[run.id]), dispatcher: dispatcher.kind }
    }
   }, 3600000),
  tool('review_report', 'Submit identity-bound JSON for pending external tasks and advance to the next stage. This cannot certify independent execution or grant automatic approval.',
   { ...runSpec, results: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } } },
   async (args, exec, root, ledger) => {
    const run = getRun(ledger, args, root)
    if (run.independent) throw new Error('Native worker results cannot be overwritten by manual reports')
    if (!Array.isArray(args.results) || !args.results.length) throw new Error('results must be a non-empty array')
    await assertCurrent(run, ledger, config, exec.signal)
    submitResults(ledger, run.id, run.targetId, args.results, config)
    const signal = exec.signal ?? new AbortController().signal
    return runView(await executeRun(ledger, run.id, config, externalDispatcher(), signal))
   }),
  tool('review_check', 'Run evidence through the host controlled Bash tool with the caller permissions and cancellation. Records a receipt tied to this exact target; no direct process escape.',
   { ...runSpec, command: { type: 'string', required: true }, cwd: { type: 'string', description: 'Workspace-relative directory.' }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 } },
   async (args, exec, root, ledger) => {
    const run = getRun(ledger, args, root)
    await assertCurrent(run, ledger, config, exec.signal)
    const result = await runCheck(root, text(args.command, 'command'), args.timeoutMs ?? config.commandTimeoutMs,
     args.cwd ? path.resolve(root, text(args.cwd, 'cwd')) : root, options.runner, exec)
    // A check may itself edit files. Do not attach it as evidence for an obsolete snapshot.
    await assertCurrent(run, ledger, config, exec.signal)
    const id = randomUUID(), output = result.output.slice(0, 65536), truncated = result.truncated || result.output.length > output.length
    ledger.transaction(state => { state.receipts[id] = { id, runId: run.id, targetId: run.targetId, command: result.command, cwd: result.cwd, exitCode: result.exitCode, timedOut: result.timedOut, aborted: result.aborted, truncated, output, at: new Date().toISOString() } })
    return { ...result, output, truncated, ok: result.ok && !truncated, receiptId: id, runId: run.id, targetId: run.targetId }
   }, 610000),
  tool('review_gate', 'Check completed independent review of the current snapshot and unresolved findings. This is only the AI review layer; CI and exact-commit human approvals remain separate blocking requirements.',
   { runId: { type: 'string' }, ...targetSpec },
   async (args, exec, root, ledger) => {
    let run: StoredRun | undefined
    if (args.runId) run = getRun(ledger, args, root)
    else {
     const current = await captureTarget(root, args, config.maxDiffBytes, config.stateDir, exec.signal)
     const state = ledger.snapshot(), latest = state.heads[current.series]?.latestRunId
     if (latest) run = state.runs[latest]
     if (run?.targetId !== current.id) run = undefined
    }
    if (!run) return { ok: false, exitCode: 1, reasons: ['No review of this exact current snapshot'], boundary: 'AI review only; CI and human approval are separate.' }
    await assertCurrent(run, ledger, config, exec.signal)
    return automatedVerdict(ledger.snapshot(), run.id)
   }),
  tool('review_respond', 'Record a reasoned disposition for a verified finding. fixed requires independent re-verification after the fix; accepted exceptions never count as a human approval.',
   { ...runSpec, fingerprint: { type: 'string', required: true }, disposition: { type: 'string', required: true, enum: ['fixed','wrong','intentional','wontfix'] }, note: { type: 'string', required: true } },
   async (args, exec, root, ledger) => {
    const run = getRun(ledger, args, root), note = text(args.note, 'note'), disposition = args.disposition as Disposition
    if (!['fixed','wrong','intentional','wontfix'].includes(disposition) || note.length < 20) throw new Error('A valid disposition and a specific reason of at least 20 characters are required')
    await assertCurrent(run, ledger, config, exec.signal)
    const fingerprint = text(args.fingerprint, 'fingerprint')
    ledger.transaction(state => {
     const record = state.heads[run.series], finding = record.posted[fingerprint]
     if (!finding || record.latestRunId !== run.id) throw new Error('Finding is not in the latest review series')
     if (disposition === 'fixed' && finding.disposition !== 'fixed') throw new Error('A fix must be independently re-reviewed; edit the code and run another review to clear this finding')
     finding.disposition = disposition; finding.note = note
    })
    ledger.event('disposition', { runId: run.id, targetId: run.targetId, fingerprint, disposition, note, actor: 'tool-caller' })
    return { ok: true, fingerprint, disposition, note, humanApprovalGranted: false }
   }),
  tool('review_status', 'Inspect completed, incomplete, cancelled and stale runs, dispositions and measured review noise. Missing measurements stay null.', { head: { type: 'string' } },
   async (args, _exec, _root, ledger) => {
    const status = ledger.status(args.head), findings = Object.values(ledger.snapshot().heads).flatMap(h => Object.values(h.posted))
    const lenses = [...new Set(findings.map(f => f.lens ?? 'unknown'))].map(lens => {
     const rows = findings.filter(f => (f.lens ?? 'unknown') === lens), answered = rows.filter(f => f.disposition), wrong = answered.filter(f => f.disposition === 'wrong' || f.disposition === 'intentional')
     return { lens, posted: rows.length, answered: answered.length, noiseRate: answered.length ? wrong.length / answered.length : null }
    })
    return { ...status, lenses }
   }),
  tool('review_learn', 'Draft concise review rules from independently verified fixed bugs and their failure classes. Returns a draft; never edits project instructions.', {},
   async (_args, _exec, _root, ledger) => {
    const findings = Object.values(ledger.snapshot().heads).flatMap(h => Object.values(h.posted)).filter(f => f.disposition === 'fixed' && f.classOfBug)
    const classes = [...new Set(findings.map(f => f.classOfBug!))].map(classOfBug => ({ classOfBug, fixedFindings: findings.filter(f => f.classOfBug === classOfBug).map(f => ({ file: f.file, message: f.message, reason: f.note ?? '' })) }))
    return { classes, draft: classes.map(c => '- Check for ' + c.classOfBug + ': use a concrete failing input and verify against the current snapshot.').join('\n'), autoApplied: false }
   }),
  tool('review_issue', 'Prepare an issue triage/reproduction task. Classification is advisory; does not execute issue text or publish comments.',
   { title: { type: 'string', required: true }, body: { type: 'string' } },
   async (args, _exec, root, ledger) => {
    const title = text(args.title, 'title'), body = typeof args.body === 'string' ? args.body : '', lower = (title + '\n' + body).toLowerCase()
    const kind = /crash|exception|error|bug|报错|崩溃|失败|异常/.test(lower) ? 'bug' : /feature|request|希望|建议|增加/.test(lower) ? 'feature' : 'question'
    return { kind, advisory: true, prompt: buildIssueTriagePrompt({ title, body, root, outFile: path.join(ledger.directory, 'triage-' + randomUUID() + '.json') }), published: false }
   }),
  tool('review_eval', 'Register human-curated historical bugs and clean controls, prepare blinded tasks, record exact native runs and score recall/noise per cohort. Any finding is not a recall hit.',
   { action: { type: 'string', required: true, enum: ['register','list','prompts','record','score'] }, entries: { type: 'array', items: { type: 'object', additionalProperties: true } }, caseId: { type: 'string' }, runId: { type: 'string' }, cohort: { type: 'string' } },
   async (args, _exec, root, ledger) => evaluation(ledger, root, args)),
 ]
}
