import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { git } from './exec.js'
import { parseDiff } from './diff.js'
import type { ReviewTarget } from './target.js'
import type { Ledger, StoredRun } from './ledger.js'
import type { ReviewConfig } from './config.js'
export interface ReviewScope { incremental: boolean; fromRunId?: string; files: Array<{ file: string; addedLines: number[]; removedLines: number[] }> }
export async function prepareScope(run: StoredRun, ledger: Ledger, config: ReviewConfig, signal: AbortSignal): Promise<void> {
 if (run.scope) return
 const directory = path.join(ledger.directory, 'runs', run.id), snapshot = path.join(directory, 'snapshot.json')
 const earlier = Object.values(ledger.snapshot().runs).filter(r => r.id !== run.id && r.series === run.series && r.status === 'complete' && r.completedAt).sort((a,b) => b.completedAt!.localeCompare(a.completedAt!))[0]
 const incremental = run.round > config.diffOnlyAfterRound && !!earlier
 const scope: ReviewScope = { incremental, ...(incremental ? { fromRunId: earlier.id } : {}), files: [] }
 mkdirSync(directory, { recursive: true })
 for (let i = 0; i < run.target.files.length; i++) {
  const file = run.target.files[i], previous = earlier?.target.files.find(f => f.path === file.path)
  if (!incremental || !previous) { scope.files.push({ file: file.path, addedLines: file.addedLines, removedLines: file.removedLines }); continue }
  if (previous.after === file.after && previous.before === file.before) continue
  const oldPath = path.join(directory, 'scope-' + i + '-old'), newPath = path.join(directory, 'scope-' + i + '-new')
  writeFileSync(oldPath, previous.after ?? ''); writeFileSync(newPath, file.after ?? '')
  const diff = await git(run.target.root, ['diff','--no-index','--no-ext-diff','--no-textconv','--unified=0','--',oldPath,newPath], 30000, config.maxDiffBytes, signal)
  if ((diff.code !== 0 && diff.code !== 1) || diff.truncated || diff.timedOut || signal.aborted) throw new Error('Incremental comparison did not complete')
  // Only hunk line numbers are used: temp-file paths are not project paths.
  const parsed = parseDiff(diff.stdout)
  if (!parsed.complete) throw new Error('Incremental comparison has an unsupported diff header')
  const addedLines = parsed.files.flatMap(f => f.hunks.flatMap(h => h.lines.filter(l => l.type === 'add').map(l => l.newNo!)))
  const removedLines = previous.before === file.before ? file.removedLines.filter(n => !previous.removedLines.includes(n)) : file.removedLines
  scope.files.push({ file: file.path, addedLines, removedLines })
 }
 const document = JSON.stringify({ ...run.target, reviewScope: scope }, null, 2)
 if (existsSync(snapshot)) { if (readFileSync(snapshot, 'utf8') !== document) throw new Error('Immutable run snapshot already exists with different content') }
 else writeFileSync(snapshot, document, { flag: 'wx' })
 ledger.transaction(state => { state.runs[run.id].scope = scope })
}
export function inScope(finding: { introducedBy?: { file: string; line: number; side?: string }; file: string; line: number; side?: string }, scope: ReviewScope | undefined, target: ReviewTarget): boolean {
 if (!scope?.incremental) return true
 const anchor = finding.introducedBy ?? finding, file = target.files.find(f => (anchor.side === 'before' ? f.oldPath : f.path) === anchor.file)
 const entry = scope.files.find(f => f.file === file?.path)
 return !!entry && (anchor.side === 'before' ? entry.removedLines : entry.addedLines).includes(anchor.line)
}
