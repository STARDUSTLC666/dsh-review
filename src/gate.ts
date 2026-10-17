import { severityRank, type ReviewConfig } from './config.js'
import { fingerprintOf } from './fingerprint.js'
import type { HeadRecord, Ledger } from './ledger.js'
import { sourceMatches, type ReviewTarget } from './target.js'
export const DROP_KINDS = ['style', 'formatting', 'format', 'diagnostics', 'diagnostic', 'cleanup', 'nitpick', 'naming', 'whitespace']
export interface Witness { file: string; line: number; anchor: string; side?: 'before' | 'after' }
export interface CandidateFinding {
 id?: string; file: string; line: number; kind: string; severity: 'blocker' | 'important' | 'nit';
 message: string; anchor: string; evidence: string; lens?: string; classOfBug?: string;
 side?: 'before' | 'after'; introducedBy?: Witness; carried?: boolean;
}
export interface Vote { candidateId: string; decision: 'confirm' | 'reject' | 'pre-existing' | 'unverifiable'; reason: string; witnesses: Witness[]; taskId: string }
export interface GatedFinding {
 fingerprint: string; file: string; line: number; kind: string; lens: string;
 severity: 'blocker' | 'important' | 'nit' | 'pre-existing'; message: string; evidence: string;
 preexisting: boolean; anchor: string; targetId: string; verification: Vote[]; classOfBug?: string;
}
export interface GateResult { postable: GatedFinding[]; suppressed: number; suppressedFingerprints: string[]; dropped: number; droppedDetail: Array<{ file: string; reason: string }>; unverified: number; declined: unknown[]; rejected: Array<{ id: string; reason: string }> }
export function candidateId(f: CandidateFinding, target: ReviewTarget): string {
 const file = target.files.find(item => (f.side === 'before' ? item.oldPath : item.path) === f.file)
 const lines = ((f.side === 'before' ? file?.before : file?.after) ?? '').split(/\r?\n/)
 const occurrence = lines.slice(0, f.line).filter(line => line === f.anchor).length
 return fingerprintOf({ kind: f.kind + ':' + (f.classOfBug ?? '') + ':' + occurrence, file: f.file, anchor: f.anchor })
}
export function parseCandidate(raw: unknown, lens: string, target: ReviewTarget): CandidateFinding | null {
 const item = raw as Partial<CandidateFinding>
 if (!item || typeof item !== 'object' || typeof item.kind !== 'string') throw new Error('Invalid finding shape')
 if (DROP_KINDS.includes(item.kind.toLowerCase())) return null
 if (!['correctness','state','breaking','security'].includes(item.kind)) throw new Error('Unknown finding kind')
 for (const key of ['file','anchor','message'] as const) if (typeof item[key] !== 'string' || !item[key]!.trim()) throw new Error('Finding requires ' + key)
 if (!['blocker','important','nit'].includes(item.severity!)) throw new Error('Invalid finding severity')
 if (item.side !== undefined && !['before','after'].includes(item.side)) throw new Error('Invalid finding side')
 const side = item.side === 'before' ? 'before' : 'after'
 if (!sourceMatches(target, item.file!, item.line!, item.anchor!, side)) throw new Error('Finding does not quote exact snapshot source')
 const introducedBy = item.introducedBy ?? { file: item.file!, line: item.line!, anchor: item.anchor!, side }
 if (introducedBy.side !== undefined && !['before','after'].includes(introducedBy.side)) throw new Error('Invalid introducing side')
 if (!sourceMatches(target, introducedBy.file, introducedBy.line, introducedBy.anchor, introducedBy.side ?? 'after')) throw new Error('Invalid introducing evidence')
 const changed = target.files.find(file => (introducedBy.side === 'before' ? file.oldPath : file.path) === introducedBy.file)
 if (!(introducedBy.side === 'before' ? changed?.removedLines : changed?.addedLines)?.includes(introducedBy.line)) throw new Error('Finding is not linked to a changed introducing line')
 const finding: CandidateFinding = { file: item.file!, line: item.line!, kind: item.kind, severity: item.severity!, message: item.message!, anchor: item.anchor!, evidence: typeof item.evidence === 'string' ? item.evidence : '', lens, side, introducedBy,
  ...(typeof item.classOfBug === 'string' && item.classOfBug.trim() ? { classOfBug: item.classOfBug.trim() } : {}) }
 finding.id = candidateId(finding, target)
 return finding
}
export function parseVote(raw: unknown, taskId: string, expected: string, target: ReviewTarget): Vote {
 const item = raw as Partial<Vote>
 if (!item || item.candidateId !== expected || !['confirm','reject','pre-existing','unverifiable'].includes(item.decision!) || typeof item.reason !== 'string' || item.reason.trim().length < 12 || !Array.isArray(item.witnesses)) throw new Error('Invalid independent verification')
 for (const witness of item.witnesses) if (!witness || (witness.side !== undefined && !['before','after'].includes(witness.side)) || !sourceMatches(target, witness.file, witness.line, witness.anchor, witness.side ?? 'after')) throw new Error('Verifier cited source outside the immutable snapshot')
 if (item.decision !== 'unverifiable' && item.witnesses.length === 0) throw new Error('Verifier supplied no checkable source witness')
 if (item.decision === 'pre-existing' && !item.witnesses.some(witness => witness.side === 'before')) throw new Error('Pre-existing verdict requires base evidence')
 return { candidateId: expected, decision: item.decision!, reason: item.reason.trim(), witnesses: item.witnesses, taskId }
}
export function voteDecision(votes: Vote[], required: number): Vote['decision'] {
 if (votes.length !== required) return 'unverifiable'
 const majority = Math.floor(required / 2) + 1
 for (const decision of ['confirm','reject','pre-existing'] as const) if (votes.filter(vote => vote.decision === decision).length >= majority) return decision
 return 'unverifiable'
}
export function gateFindings(options: {
 root: string; head: string; base: string; mode: string; findings: CandidateFinding[]; config: ReviewConfig;
 rules: ReviewTarget['rules']; record: HeadRecord; ledger: Ledger; target: ReviewTarget;
 votes: Record<string, Vote[]>; requiredVotes: number;
}): GateResult {
 const { record, target, config, rules } = options
 const result: GateResult = { postable: [], suppressed: 0, suppressedFingerprints: [], dropped: 0, droppedDetail: [], unverified: 0, declined: [], rejected: [] }
 let nits = 0
 const unique = new Map<string, CandidateFinding>()
 for (const finding of options.findings) {
  if (DROP_KINDS.includes(finding.kind.toLowerCase())) { result.dropped++; continue }
  const id = finding.id ?? candidateId(finding, target), prior = unique.get(id)
  if (!prior || severityRank(finding.severity) > severityRank(prior.severity)) unique.set(id, { ...finding, id })
 }
 for (const finding of [...unique.values()].sort((a,b) => severityRank(b.severity) - severityRank(a.severity))) {
  const id = finding.id!, votes = options.votes[id] ?? [], decision = voteDecision(votes, options.requiredVotes)
  if (decision === 'unverifiable') { result.unverified++; continue }
  if (decision === 'reject') {
   result.rejected.push({ id, reason: votes.map(v => v.reason).join('\n') })
   const prior = record.posted[id]
   if (prior && !prior.disposition) { prior.disposition = prior.targetId === target.id ? 'wrong' : 'fixed'; prior.note = 'Independent re-verification rejects the former finding on target ' + target.id; prior.verification = votes; prior.targetId = target.id }
   continue
  }
  if (decision !== 'pre-existing' && severityRank(finding.severity) < severityRank(rules.severityFloor ?? config.severityFloor)) { result.dropped++; continue }
  if (finding.severity === 'nit' && nits++ >= (rules.maxNits ?? config.maxNits)) { result.dropped++; continue }
  if (result.postable.length >= config.maxFindings) { result.unverified++; continue }
  const entry: GatedFinding = { fingerprint: id, file: finding.file, line: finding.line, kind: finding.kind, lens: finding.lens ?? 'unknown', severity: decision === 'pre-existing' ? 'pre-existing' : finding.severity,
   message: finding.message, evidence: votes.map(v => v.reason).join('\n'), preexisting: decision === 'pre-existing', anchor: finding.anchor, targetId: target.id, verification: votes,
   ...(finding.classOfBug ? { classOfBug: finding.classOfBug } : {}) }
  const prior = record.posted[id]
  if (prior && prior.targetId === target.id) {
   prior.repeats++; result.suppressed++; result.suppressedFingerprints.push(id); prior.verification = votes; prior.evidence = entry.evidence
   if (severityRank(entry.severity) > severityRank(prior.severity)) { prior.severity = entry.severity; prior.message = entry.message }
   continue
  }
  if (prior && !prior.disposition) { result.suppressed++; result.suppressedFingerprints.push(id) }
  else result.postable.push(entry)
  options.ledger.remember(record, { ...entry, at: new Date().toISOString(), repeats: prior?.repeats ?? 0 })
 }
 record.unverified = result.unverified; record.dropped += result.dropped; record.reviewedFiles = target.files.map(file => file.path)
 return result
}
