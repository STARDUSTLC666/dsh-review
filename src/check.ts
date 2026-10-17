import path from 'node:path'
import { realpathSync } from 'node:fs'
export interface CheckResult { ok: boolean; command: string; cwd: string; exitCode: number | null; timedOut: boolean; aborted: boolean; truncated: boolean; durationMs: number; output: string }
export interface ToolExecutionContext { agent?: any; signal?: AbortSignal }
export type CommandRunner = (input: { command: string; cwd: string; timeoutMs: number; signal: AbortSignal; exec: ToolExecutionContext }) => Promise<Omit<CheckResult, 'command' | 'cwd' | 'durationMs'>>
export async function runCheck(root: string, command: string, timeoutMs: number, cwd?: string, runner?: CommandRunner, exec: ToolExecutionContext = {}): Promise<CheckResult> {
 if (!runner || !exec.agent) throw new Error('review_check requires the DSH controlled Bash runner and a live calling agent; direct process execution is disabled')
 if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('timeoutMs must be an integer between 1000 and 600000')
 const workdir = realpathSync(cwd ?? root), relative = path.relative(realpathSync(root), workdir)
 if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Evidence command cwd must stay inside the workspace')
 const started = Date.now(), deadline = AbortSignal.timeout(timeoutMs)
 const signal = exec.signal ? AbortSignal.any([exec.signal, deadline]) : deadline
 signal.throwIfAborted()
 const result = await runner({ command, cwd: workdir, timeoutMs, signal, exec })
 signal.throwIfAborted()
 return { ...result, command, cwd: workdir, durationMs: Date.now() - started }
}
