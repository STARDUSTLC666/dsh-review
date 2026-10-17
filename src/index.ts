import { resolveConfig, type ReviewConfig } from './config.js'
import { buildReviewTools, type ReviewToolDefinition } from './tools.js'
import { createDispatcher, type SubagentService } from './dispatch.js'
import type { CommandRunner, ToolExecutionContext } from './check.js'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const name = 'review'
export const inject = ['tools', 'subagents', 'permissionPresets', 'jobs']
interface HostResult { isError?: boolean; value?: any; error?: { message?: string } }
export interface ReviewPluginContext {
 effect?(effect: () => () => void): unknown
 tools: { register(definition: ReviewToolDefinition): () => void; execute(call: Record<string, unknown>): Promise<HostResult>; get?(name: string, agent: unknown): unknown }
 subagents: SubagentService
 permissionPresets: { current(session: unknown): string; resolve(name: string): { sandbox: string } }
 jobs: { kill(id: string, caller?: string, reason?: string): unknown; wait(id: string, timeoutMs: number, caller?: string): Promise<{ status: string }> }
}
export function apply(ctx: ReviewPluginContext, config?: Partial<ReviewConfig> | null): void {
 const resolved = resolveConfig(config)
 const runner: CommandRunner = async input => {
  const agent = input.exec.agent
  if (!agent) throw new Error('Evidence execution requires the live calling agent')
  const preset = ctx.permissionPresets.current(agent.session)
  if (ctx.permissionPresets.resolve(preset).sandbox === 'read-only') throw new Error('Evidence command denied in a read-only session; use static source evidence or request the normal workspace permission')
  const tools = agent.ctx?.get?.('tools') ?? ctx.tools
  let toolName = 'bash', command = input.command
  if (process.platform === 'win32' && !tools.get?.('bash', agent) && tools.get?.('pwsh', agent)) {
   const bash = [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe')].find(file => existsSync(file))
   if (!bash) throw new Error('This Windows preset exposes pwsh only. Install Git Bash or enable the controlled Bash tool; no direct process fallback is allowed.')
   // The official Windows preset exposes pwsh. It remains the policy/cancellation
   // boundary; use Git Bash underneath, preserving the original visible command.
   const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'"
   command = "if ($PSVersionTable.PSVersion -lt [version]'7.3') { throw 'Git Bash bridging requires PowerShell 7.3+' }; $PSNativeCommandArgumentPassing = 'Standard'; & " + quote(bash) + ' -lc ' + quote(input.command) + '; exit $LASTEXITCODE'
   toolName = 'pwsh'
  }
  const result = await tools.execute({ callId: 'review-check-' + randomUUID(), name: toolName, arguments: { command, description: 'Run review evidence in Git Bash', workdir: input.cwd, timeoutMs: 600000 }, agent, signal: input.signal })
  if (result.isError || !result.value) throw new Error(result.error?.message ?? 'Controlled Bash execution failed')
  const value = result.value
  if (value.kind === 'promoted' || value.kind === 'background') {
   ctx.jobs.kill(value.jobId, agent.id, 'Review checks cannot continue in the background')
   for (;;) { const view = await ctx.jobs.wait(value.jobId, 5000, agent.id); if (!['running','stopping'].includes(view.status)) break }
   throw new Error('Evidence command exceeded the foreground budget and was stopped')
  }
  const truncated = value.stdout?.truncated === true || value.stderr?.truncated === true
  return { ok: value.exitCode === 0 && !value.timedOut && !value.aborted && !value.sandbox?.denied && !truncated,
   exitCode: value.exitCode ?? null, timedOut: !!value.timedOut, aborted: !!value.aborted, truncated,
   output: String(value.stdout?.text ?? '') + (value.stderr?.text ? '\n' + value.stderr.text : '') }
 }
 const dispatcher = (exec: ToolExecutionContext, root: string, signal: AbortSignal) => createDispatcher({ subagents: ctx.subagents, parent: exec.agent, provider: resolved.subagentProvider, signal, cwd: root })
 for (const definition of buildReviewTools(resolved, { runner, dispatcher })) {
  if (ctx.effect) ctx.effect(() => ctx.tools.register(definition))
  else ctx.tools.register(definition)
 }
}
export { resolveConfig, DEFAULT_CONFIG } from './config.js'
export type { ReviewConfig } from './config.js'
