/**
 * 账本：按 head_sha 记账（轮次、已发 finding、已审文件、处置结果）。
 * 它是"不复报 / 三轮收敛 / 噪音率"三个机制的唯一事实来源。
 *
 * @module dsh-review/ledger
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Mode } from './modes.js'

export type Disposition = 'fixed' | 'wrong' | 'intentional' | 'wontfix'

export interface LedgerFinding {
  fingerprint: string
  file: string
  line: number
  kind: string
  lens?: string
  severity: 'blocker' | 'important' | 'nit' | 'pre-existing'
  message: string
  evidence: string
  at: string
  disposition?: Disposition
  note?: string
  /** 本轮被压制（重复）的次数。 */
  repeats: number
}

export interface HeadRecord {
  head: string
  base?: string
  round: number
  mode: Mode
  posted: Record<string, LedgerFinding>
  reviewedFiles: string[]
  dropped: number
  suppressed: number
  unverified: number
  updatedAt: string
}

interface LedgerState {
  version: 1
  heads: Record<string, HeadRecord>
}

const EMPTY: LedgerState = { version: 1, heads: {} }

export class Ledger {
  private readonly file: string
  private readonly events: string
  private state: LedgerState

  constructor(private readonly root: string, stateDir: string) {
    const dir = path.resolve(root, stateDir)
    this.file = path.join(dir, 'state.json')
    this.events = path.join(dir, 'ledger.jsonl')
    this.state = this.read()
  }

  private read(): LedgerState {
    if (!existsSync(this.file)) return { ...EMPTY, heads: {} }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as LedgerState
      if (parsed?.version !== 1 || typeof parsed.heads !== 'object' || parsed.heads === null) return { ...EMPTY, heads: {} }
      return parsed
    } catch {
      return { ...EMPTY, heads: {} }
    }
  }

  save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.file)
  }

  event(type: string, payload: Record<string, unknown>): void {
    mkdirSync(path.dirname(this.events), { recursive: true })
    appendFileSync(this.events, JSON.stringify({ at: new Date().toISOString(), type, ...payload }) + '\n', 'utf8')
  }

  head(head: string): HeadRecord | undefined {
    return this.state.heads[head]
  }

  ensureHead(head: string, mode: Mode): HeadRecord {
    const existing = this.state.heads[head]
    if (existing !== undefined) {
      if (existing.mode !== mode) existing.mode = mode
      return existing
    }
    const record: HeadRecord = { head, round: 0, mode, posted: {}, reviewedFiles: [], dropped: 0, suppressed: 0, unverified: 0, updatedAt: new Date().toISOString() }
    this.state.heads[head] = record
    return record
  }

  beginRound(head: string, mode: Mode): HeadRecord {
    const record = this.ensureHead(head, mode)
    record.round += 1
    record.updatedAt = new Date().toISOString()
    return record
  }

  remember(record: HeadRecord, finding: LedgerFinding): void {
    record.posted[finding.fingerprint] = finding
    if (!record.reviewedFiles.includes(finding.file)) record.reviewedFiles.push(finding.file)
    record.updatedAt = new Date().toISOString()
  }

  respond(head: string, fingerprint: string, disposition: Disposition, note?: string): LedgerFinding | undefined {
    const record = this.state.heads[head]
    if (record === undefined) return undefined
    const finding = record.posted[fingerprint]
    if (finding === undefined) return undefined
    finding.disposition = disposition
    if (note !== undefined) finding.note = note
    record.updatedAt = new Date().toISOString()
    return finding
  }

  status(head?: string): {
    heads: number
    round: number
    posted: number
    byDisposition: Record<string, number>
    noiseRate: number | null
    repeatRate: number | null
    unverified: number
    dropped: number
    topKinds: Array<{ kind: string; count: number }>
  } {
    const records = head !== undefined ? [this.state.heads[head]].filter(Boolean) as HeadRecord[] : Object.values(this.state.heads)
    const all = records.flatMap(r => Object.values(r.posted))
    const byDisposition: Record<string, number> = { fixed: 0, wrong: 0, intentional: 0, wontfix: 0, unanswered: 0 }
    for (const f of all) byDisposition[f.disposition ?? 'unanswered'] = (byDisposition[f.disposition ?? 'unanswered'] ?? 0) + 1
    const answered = all.filter(f => f.disposition !== undefined).length
    const noise = (byDisposition.wrong ?? 0) + (byDisposition.intentional ?? 0)
    const repeats = all.reduce((n, f) => n + (f.repeats ?? 0), 0)
    const kinds = new Map<string, number>()
    for (const f of all) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1)
    return {
      heads: records.length,
      round: records.reduce((n, r) => Math.max(n, r.round), 0),
      posted: all.length,
      byDisposition,
      noiseRate: answered === 0 ? null : Number((noise / answered).toFixed(3)),
      repeatRate: all.length === 0 ? null : Number((repeats / all.length).toFixed(3)),
      unverified: records.reduce((n, r) => n + r.unverified, 0),
      dropped: records.reduce((n, r) => n + r.dropped, 0),
      topKinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    }
  }
}
