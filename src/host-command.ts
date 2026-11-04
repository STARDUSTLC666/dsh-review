import { randomUUID } from 'node:crypto'

export interface ControlledTools {
  execute(input: Record<string, unknown>): Promise<any>
  selectExecutor?(agent: unknown): { describe(definitions: unknown[]): { schemas: Array<{ name: string }> } }
  definitions?(agent: unknown): unknown[]
}

/** Dispatch through the caller's selected executor; never spawn a fallback. */
export async function executeHostCommand(tools: ControlledTools, input: { name: string; arguments: Record<string, unknown>; agent: any; signal: AbortSignal }): Promise<any> {
  input.signal.throwIfAborted()
  if (!['bash', 'pwsh'].includes(input.name)) throw new Error('Unsupported controlled shell tool')
  const id = 'review-check-' + randomUUID()
  if (typeof tools.selectExecutor !== 'function') { const result = await tools.execute({ ...input, callId: id }); input.signal.throwIfAborted(); return result }
  if (typeof tools.definitions !== 'function') throw new Error('The selected executor cannot describe its admitted tools')
  const names = tools.selectExecutor(input.agent).describe(tools.definitions(input.agent)).schemas.map(tool => tool.name)
  let name = input.name, args = input.arguments, marker = ''
  if (!names.includes(name)) {
    if (!names.includes('run_code')) throw new Error('The selected executor does not expose controlled shell execution')
    const runtime = input.agent.ctx?.get?.('ptcRuntime')
    marker = 'DSH_REVIEW_' + randomUUID() + ':'
    const payload = JSON.stringify(input.arguments)
    let code: string
    if (runtime?.language === 'typescript') {
      code = `const value = await tools.${name}(${payload}); console.log(${JSON.stringify(marker)} + JSON.stringify(value));`
    } else if (runtime?.language === 'python') {
      code = `import json\nvalue = await tools.${name}(**json.loads(${JSON.stringify(payload)}))\nprint(${JSON.stringify(marker)} + json.dumps(value, ensure_ascii=False))`
    } else throw new Error('Review checks require a supported TypeScript or Python PTC runtime')
    name = 'run_code'; args = { code, description: 'Run review evidence through the selected PTC executor' }
  }
  const batch = await tools.execute({ calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }], agent: input.agent, signal: input.signal })
  input.signal.throwIfAborted()
  if (!Array.isArray(batch?.results) || batch.results.length !== 1 || batch.results[0].callId !== id) throw new Error('The host returned an incomplete or mismatched evidence result')
  const result = batch.results[0].result
  if (!result || typeof result !== 'object') throw new Error('The host returned no controlled evidence result')
  if (!marker || result?.isError) return result
  if (result?.value?.sandbox?.denied) throw new Error('The PTC sandbox denied review evidence execution')
  const lines = result?.value?.logs?.filter((line: unknown) => typeof line === 'string' && line.startsWith(marker))
  if (!Array.isArray(lines) || lines.length !== 1 || lines[0].length > 1024 * 1024) throw new Error('The PTC evidence result was missing, duplicated or truncated')
  const value = JSON.parse(lines[0].slice(marker.length))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid controlled shell evidence result')
  return { ...result, value }
}
