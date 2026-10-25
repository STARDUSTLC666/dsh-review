import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { git } from './exec.js'
import { parseDiff, type FileDiff } from './diff.js'
import { loadRules, parseRules, RULE_PATHS, isSkipped, type ReviewRules } from './rules.js'
import { stateDirectory } from './ledger.js'

export interface TargetFile { path: string; oldPath: string | null; status: string; binary: boolean; before: string | null; after: string | null; addedLines: number[]; removedLines: number[] }
export interface ReviewTarget {
  id: string; series: string; root: string; head: string; base: string; baseRef: string;
  kind: 'worktree' | 'staged' | 'commit'; includeUntracked: boolean; patch: string;
  files: TargetFile[]; allPaths: string[]; instructions: string; skipped: string[]; rules: ReviewRules; diff: FileDiff[];
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export async function captureTarget(root: string, args: { base?: unknown; staged?: unknown; includeUntracked?: unknown }, maxBytes: number, stateDir: string, signal?: AbortSignal): Promise<ReviewTarget> {
  root = realpathSync(root)
  const query = async (argv: string[]) => {
    const r = await git(root, argv, 30000, maxBytes, signal)
    if (!r.ok) throw new Error(r.truncated ? 'Review incomplete: diff or source exceeds maxDiffBytes' : 'Git read failed: ' + r.stderr.slice(0, 300))
    return r.stdout
  }
  const head = (await query(['rev-parse', '--verify', 'HEAD'])).trim()
  const baseRef = typeof args.base === 'string' && args.base.trim() ? args.base.trim() : 'HEAD'
  if (baseRef.startsWith('-') || /[\s\x00-\x1f]/.test(baseRef)) throw new Error('Invalid base ref')
  const kind = args.staged === true ? 'staged' : baseRef !== 'HEAD' ? 'commit' : 'worktree'
  if (args.staged === true && baseRef !== 'HEAD') throw new Error('staged and base are mutually exclusive')
  const requestedBase = (await query(['rev-parse', '--verify', '--end-of-options', baseRef + '^{commit}'])).trim()
  const base = kind === 'commit' ? (await query(['merge-base', requestedBase, head])).trim() : head
  const selector = kind === 'staged' ? ['--cached', head] : kind === 'commit' ? [base, head] : [head]
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--no-color']
  const names = await query([...common, '--name-status', '-z', ...selector, '--'])
  const patch = await query([...common, '--unified=3', ...selector, '--'])
  const parsed = parseDiff(patch)
  if (!parsed.complete) throw new Error('Review incomplete: unsupported Git diff header')
  const fields = names.split('\0'); if (fields.at(-1) === '') fields.pop()
  const entries: Array<{ path: string; oldPath: string | null; code: string }> = []
  for (let i = 0; i < fields.length;) {
    const code = fields[i++], first = fields[i++]
    if (!first || !/^[AMDTRC][0-9]*$/.test(code)) throw new Error('Review incomplete: unsupported name-status entry')
    const renamed = /^[RC]/.test(code), next = renamed ? fields[i++] : first
    if (!next) throw new Error('Review incomplete: truncated file inventory')
    entries.push({ path: next, oldPath: code[0] === 'A' ? null : first, code })
  }
  const includeUntracked = kind === 'worktree' && args.includeUntracked !== false
  if (includeUntracked) {
    const extra = (await query(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
    for (const file of extra) if (!entries.some(e => e.path === file)) entries.push({ path: file, oldPath: null, code: 'A' })
  }
  let rules: ReviewRules
  if (kind === 'commit') {
    const entries = (await query(['ls-tree','-z',base,'--',...RULE_PATHS])).split('\0').filter(Boolean)
    const source = RULE_PATHS.find(file => entries.some(e => e.split('\t')[1] === file))
    if (source) {
      if (!entries.find(e => e.split('\t')[1] === source)?.startsWith('100')) throw new Error('Committed review guidance must be a regular file')
      rules = parseRules(await query(['show','--no-ext-diff','--no-textconv',base + ':' + source]), source)
    } else rules = parseRules('', null)
  } else rules = loadRules(root)
  const skipped: string[] = [], files: TargetFile[] = []
  const relativeState = path.relative(root, stateDirectory(root, stateDir)).replaceAll('\\', '/')
  const internal = relativeState && relativeState !== '..' && !relativeState.startsWith('../') && !path.isAbsolute(relativeState) ? relativeState : undefined
  const inState = (file: string) => internal !== undefined && (file === internal || file.startsWith(internal + '/'))
  let total = Buffer.byteLength(patch)
  const blob = async (spec: string) => query(['show', '--no-ext-diff', '--no-textconv', spec])
  for (const entry of entries) {
    if (inState(entry.path) || isSkipped(entry.path, rules.skip)) { skipped.push(entry.path); continue }
    const diff = parsed.files.find(f => f.path === entry.path)
    if (!diff && entry.oldPath !== null) throw new Error('Review incomplete: file missing from patch: ' + entry.path)
    const before = entry.oldPath === null ? null : await blob(base + ':' + entry.oldPath)
    let after: string | null = null
    if (entry.code[0] !== 'D') {
      if (kind === 'worktree') {
        const file = path.resolve(root, entry.path), relative = path.relative(root, realpathSync(file))
        if (relative.startsWith('..') || path.isAbsolute(relative) || lstatSync(file).isSymbolicLink()) throw new Error('Review incomplete: symlink or out-of-root path')
        after = readFileSync(file, 'utf8')
      } else after = await blob((kind === 'staged' ? '' : head) + ':' + entry.path)
    }
    total += Buffer.byteLength(before ?? '') + Buffer.byteLength(after ?? '')
    if (total > maxBytes) throw new Error('Review incomplete: snapshot exceeds maxDiffBytes')
    files.push({ path: entry.path, oldPath: entry.oldPath, status: diff?.status ?? 'added', binary: diff?.binary ?? (after?.includes('\0') ?? false), before, after,
      addedLines: diff ? diff.hunks.flatMap(h => h.lines.filter(l => l.type === 'add').map(l => l.newNo!)) : (after ?? '').split('\n').map((_, n) => n + 1),
      removedLines: diff?.hunks.flatMap(h => h.lines.filter(l => l.type === 'del').map(l => l.oldNo!)) ?? [] })
  }
  if ((await query(['rev-parse', 'HEAD'])).trim() !== head || await query([...common, '--name-status', '-z', ...selector, '--']) !== names || await query([...common, '--unified=3', ...selector, '--']) !== patch) throw new Error('Review target changed while reading; retry')
  const branchResult = await git(root, ['symbolic-ref', '--short', 'HEAD'])
  const series = hash(JSON.stringify([root, branchResult.ok ? branchResult.stdout.trim() : head, kind, base, kind === 'commit' ? null : head]))
  const instructions = ['AGENTS.md', 'CLAUDE.md'].map(file => {
    try {
      const absolute = path.join(root, file), relative = path.relative(root, realpathSync(absolute))
      if (lstatSync(absolute).isSymbolicLink() || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Project guidance must be a regular workspace file')
      const content = readFileSync(absolute, 'utf8'); if (Buffer.byteLength(content) > 16384) throw new Error('Project instruction file exceeds 16 KiB'); return file + '\n' + content
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
  }).filter(Boolean).join('\n')
  const allPaths = entries.filter(entry => !inState(entry.path)).map(entry => entry.path)
  if (includeUntracked) {
    const now = (await query(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(file => file && !inState(file) && !isSkipped(file, rules.skip))
    const then = entries.filter(e => e.oldPath === null && !parsed.files.some(f => f.path === e.path) && !inState(e.path) && !isSkipped(e.path, rules.skip)).map(e => e.path)
    if (JSON.stringify(now.sort()) !== JSON.stringify(then.sort())) throw new Error('Untracked file inventory changed while reading; retry')
    for (const file of files.filter(f => f.oldPath === null && !parsed.files.some(d => d.path === f.path))) if (readFileSync(path.resolve(root, file.path), 'utf8') !== file.after) throw new Error('Untracked source changed while reading; retry')
  }
  return { id: hash(JSON.stringify([root, kind, head, base, patch, files, rules, instructions, allPaths])), series, root, head, base, baseRef, kind, includeUntracked, patch, files, allPaths, instructions, skipped, rules, diff: parsed.files.filter(f => files.some(item => item.path === f.path)) }
}

export function targetArgs(target: ReviewTarget) { return { base: target.baseRef, staged: target.kind === 'staged', includeUntracked: target.includeUntracked } }
export function sourceMatches(target: ReviewTarget, file: string, line: number, anchor: string, side: 'before' | 'after' = 'after'): boolean {
  const item = target.files.find(f => (side === 'before' ? f.oldPath : f.path) === file)
  return !!item && Number.isInteger(line) && line > 0 && item[side]?.split(/\r?\n/)[line - 1] === anchor
}
