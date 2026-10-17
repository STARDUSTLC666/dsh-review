import type { LensTask } from './lenses.js'
export interface TaskResult { ok: boolean; reason?: string; output?: string; childId?: string }
export interface Dispatcher { kind: 'subagents' | 'external'; reason?: string; dispatch(task: LensTask): Promise<TaskResult>; settle(): Promise<void> }
export interface Activation { childId: string; result: Promise<{ output?: Array<{ type: string; text?: string }>; stopReason?: unknown }>; dispose(): Promise<void> }
export interface SubagentService {
 startActivation(input: { provider: string; label: string; delivery: 'caller'; request: { prompt: Array<{ type: 'text'; text: string }>; parent: unknown; cwd: string; maxDepth: number }; signal: AbortSignal }): Promise<Activation>
 getProvider?(name: string): { inheritsParentContext?: boolean; capabilities?: { depthLimit?: boolean } } | undefined
 resolveMaxDepth?(configured?: number): number | undefined
}
export interface DispatcherOptions { subagents?: SubagentService; parent?: unknown; provider?: string; signal?: AbortSignal; cwd?: string; maxDepth?: number }
export function externalDispatcher(reason = 'Subagent service or live parent unavailable. Execute the returned tasks and submit their identity-bound JSON with review_report.'): Dispatcher {
 return { kind: 'external', reason, async dispatch() { return { ok: false, reason: 'external' } }, async settle() {} }
}
export function createDispatcher(options: DispatcherOptions): Dispatcher {
 const svc = options.subagents
 if (!svc || !options.parent || !options.signal || !options.cwd) return externalDispatcher()
 const provider = options.provider ?? 'spawn', signal = options.signal
 return {
  kind: 'subagents',
  async dispatch(task) {
   let activation: Activation | undefined
   try {
    signal.throwIfAborted()
    if (svc.getProvider?.(provider)?.inheritsParentContext !== false) throw new Error('Review workers require a provider that explicitly guarantees fresh context, not a fork or unknown backend')
    const maxDepth = svc.resolveMaxDepth?.(options.maxDepth) ?? options.maxDepth ?? 1
    activation = await svc.startActivation({ provider, label: task.id, delivery: 'caller', signal,
     request: { prompt: [{ type: 'text', text: task.prompt }], parent: options.parent!, cwd: options.cwd!, maxDepth } })
    const onAbort = () => { void activation?.dispose().catch(() => {}) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
     if (signal.aborted) { await activation.dispose(); signal.throwIfAborted() }
     const result = await activation.result
     signal.throwIfAborted()
     if (result.stopReason !== 'completed') return { ok: false, reason: 'Child did not complete: ' + String(result.stopReason), childId: activation.childId }
     const output = result.output?.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n') ?? ''
     if (!output.trim()) return { ok: false, reason: 'Child finished without JSON output', childId: activation.childId }
     return { ok: true, output, childId: activation.childId }
    } finally { signal.removeEventListener('abort', onAbort) }
   } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
   finally { if (activation) await activation.dispose() }
  },
  async settle() {},
 }
}
