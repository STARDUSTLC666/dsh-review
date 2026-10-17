import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmdirSync, unlinkSync, copyFileSync, constants, realpathSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import type { Mode } from './modes.js'
import type { ReviewTarget } from './target.js'
import type { LensTask } from './lenses.js'
import type { CandidateFinding } from './gate.js'
import type { ReviewScope } from './scope.js'
export type Disposition = 'fixed' | 'wrong' | 'intentional' | 'wontfix'
export type RunStatus = 'pending' | 'running' | 'complete' | 'incomplete' | 'failed' | 'cancelled' | 'stale'
export interface LedgerFinding {
 fingerprint: string; file: string; line: number; kind: string; lens?: string;
 severity: 'blocker' | 'important' | 'nit' | 'pre-existing'; message: string; evidence: string;
 at: string; disposition?: Disposition; note?: string; repeats: number; targetId?: string;
 anchor?: string; classOfBug?: string; verification?: unknown;
}
export interface HeadRecord {
 head: string; base?: string; targetId?: string; series?: string; latestRunId?: string;
 round: number; mode: Mode; posted: Record<string, LedgerFinding>; reviewedFiles: string[];
 dropped: number; suppressed: number; unverified: number; updatedAt: string;
}
export interface StoredRun {
 id: string; targetId: string; series: string; head: string; target: ReviewTarget;
 mode: Mode; status: RunStatus; stage: 'find' | 'verify' | 'arbiter' | 'done';
 tasks: LensTask[]; results: Record<string, unknown>; candidates: CandidateFinding[];
 round: number; calls: number; errors: string[]; createdAt: string; completedAt?: string;
 postable: unknown[]; rejected: unknown[]; unverified: number; accepted?: LedgerFinding[];
 independent: boolean;
 scope?: ReviewScope; lease?: string; leasePid?: number; summary?: string;
 risk?: { tier: 'low' | 'medium' | 'high'; extraHuman: boolean; reasons: string[] };
}
export interface Receipt {
 id: string; runId: string; targetId: string; command: string; cwd: string; exitCode: number | null;
 timedOut: boolean; aborted: boolean; truncated: boolean; output: string; at: string;
}
export interface LedgerState { version: 2; revision: number; heads: Record<string, HeadRecord>; runs: Record<string, StoredRun>; receipts: Record<string, Receipt>; legacy?: unknown; evaluations?: { cases: Record<string, unknown>; results: Record<string, unknown> } }
export function stateDirectory(root: string, stateDir: string): string {
 const configuredHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
 let profileBase = configuredHome
 if (stateDir === '@profile') {
  let ancestor = path.resolve(configuredHome)
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor)
  profileBase = path.join(realpathSync(ancestor), path.relative(ancestor, path.resolve(configuredHome)))
 }
 const dir = stateDir === '@profile'
  ? path.join(profileBase, 'plugins', 'dsh-review', createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 24))
  : path.resolve(root, stateDir)
 if (stateDir !== '@profile') {
  const relative = path.relative(root, dir)
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') throw new Error('stateDir must be a child directory of the workspace, or @profile')
 }
 let current = dir
 while (!existsSync(current)) current = path.dirname(current)
 if (path.resolve(realpathSync(current)).toLowerCase() !== path.resolve(current).toLowerCase()) throw new Error('Review state path may not traverse a symlink')
 return dir
}
export class Ledger {
 readonly directory: string
 private readonly file: string
 private state: LedgerState
 constructor(private readonly root: string, stateDir: string) {
  this.directory = stateDirectory(root, stateDir); this.file = path.join(this.directory, 'state.json'); this.state = this.read()
 }
 private read(): LedgerState {
  if (!existsSync(this.file)) return { version: 2, revision: 0, heads: {}, runs: {}, receipts: {} }
  let parsed: any
  try { parsed = JSON.parse(readFileSync(this.file, 'utf8')) } catch { throw new Error('Review ledger is corrupt; original file preserved. Gate remains blocked.') }
  if (parsed?.version === 1 && parsed.heads && typeof parsed.heads === 'object' && !Array.isArray(parsed.heads)) return { version: 2, revision: 0, heads: {}, runs: {}, receipts: {}, legacy: parsed }
  if (parsed?.version !== 2 || !Number.isInteger(parsed.revision) || !parsed.heads || !parsed.runs || !parsed.receipts || [parsed.heads, parsed.runs, parsed.receipts].some(value => typeof value !== 'object' || Array.isArray(value))) throw new Error('Unsupported or invalid review ledger; gate remains blocked')
  return parsed
 }
 private locked<T>(work: () => T): T {
  mkdirSync(this.directory, { recursive: true })
  const lock = path.join(this.directory, 'write.lock')
  try { mkdirSync(lock) } catch { throw new Error('Review ledger is busy; retry after the current update finishes') }
  try { return work() } finally { rmdirSync(lock) }
 }
 private write(): void {
  if (this.state.legacy && !existsSync(this.file + '.v1.backup') && existsSync(this.file)) copyFileSync(this.file, this.file + '.v1.backup', constants.COPYFILE_EXCL)
  const tmp = this.file + '.tmp-' + process.pid + '-' + randomUUID()
  const text = JSON.stringify({ ...this.state, revision: this.state.revision + 1 }, null, 2) + '\n'
  try { writeFileSync(tmp, text, { flag: 'wx' }); renameSync(tmp, this.file); this.state.revision++ } finally { if (existsSync(tmp)) unlinkSync(tmp) }
 }
 transaction<T>(work: (state: LedgerState) => T): T {
  return this.locked(() => { this.state = this.read(); const value = work(this.state); this.write(); return value })
 }
 save(): void { this.locked(() => { const current = this.read(); if (current.revision !== this.state.revision) throw new Error('Review ledger changed; refusing a stale write'); this.write() }) }
 event(type: string, payload: Record<string, unknown>): void {
  mkdirSync(this.directory, { recursive: true }); appendFileSync(path.join(this.directory, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), type, ...payload }) + '\n')
 }
 snapshot(): LedgerState { return this.read() }
 head(head: string): HeadRecord | undefined { return this.state.heads[head] }
 ensureHead(head: string, mode: Mode): HeadRecord { return this.state.heads[head] ??= { head, round: 0, mode, posted: {}, reviewedFiles: [], dropped: 0, suppressed: 0, unverified: 0, updatedAt: new Date().toISOString() } }
 beginRound(head: string, mode: Mode): HeadRecord { const record = this.ensureHead(head, mode); record.round++; return record }
 remember(record: HeadRecord, finding: LedgerFinding): void { record.posted[finding.fingerprint] = finding; record.updatedAt = new Date().toISOString() }
 respond(head: string, fingerprint: string, disposition: Disposition, note?: string): LedgerFinding | undefined {
  const finding = this.state.heads[head]?.posted[fingerprint]; if (!finding) return undefined
  finding.disposition = disposition; if (note) finding.note = note; return finding
 }
 status(head?: string) {
  const state = this.read(), records = Object.entries(state.heads).filter(([key, value]) => !head || key === head || value.head === head).map(([, value]) => value)
  const findings = records.flatMap(record => Object.values(record.posted)), byDisposition: Record<string, number> = { fixed: 0, wrong: 0, intentional: 0, wontfix: 0, unanswered: 0 }
  for (const finding of findings) byDisposition[finding.disposition ?? 'unanswered']++
  const answered = findings.filter(f => f.disposition).length, kinds = new Map<string, number>()
  for (const f of findings) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1)
  return { heads: records.length, round: Math.max(0, ...records.map(r => r.round)), posted: findings.length, byDisposition,
   noiseRate: answered ? ((byDisposition.wrong + byDisposition.intentional) / answered) : null,
   repeatRate: findings.length ? findings.reduce((n, f) => n + f.repeats, 0) / findings.length : null,
   unverified: records.reduce((n, r) => n + r.unverified, 0), dropped: records.reduce((n, r) => n + r.dropped, 0),
   topKinds: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count).slice(0, 8),
   runs: Object.values(state.runs).filter(r => !head || r.head === head || r.targetId === head).map(r => ({ id: r.id, targetId: r.targetId, status: r.status, stage: r.stage, calls: r.calls, errors: r.errors })), legacyPresent: !!state.legacy }
 }
}
