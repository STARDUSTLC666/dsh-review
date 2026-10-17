/**
 * 把关层：所有结论（无论来自 review_report 还是 review_run）都必须过这一关。
 *
 * 顺序：风格类丢弃 → 指纹去重（合并取最严）→ 增量过滤 → pre-existing 标记 →
 * 严重度下限 → 证据门槛 → nit 上限 → 单轮上限。
 *
 * @module dsh-review/gate
 */

import { severityRank, type ReviewConfig } from './config.js'
import { fingerprintOf } from './fingerprint.js'
import { isPreexisting } from './preexisting.js'
import type { HeadRecord, Ledger } from './ledger.js'
import type { Mode } from './modes.js'
import type { ReviewRules } from './rules.js'

export const DROP_KINDS = ['style', 'formatting', 'format', 'diagnostics', 'diagnostic', 'cleanup', 'nitpick', 'naming', 'whitespace']

export interface CandidateFinding {
  file: string
  line: number
  kind: string
  severity: 'blocker' | 'important' | 'nit'
  message: string
  anchor: string
  evidence: string
  lens?: string
  classOfBug?: string
}

export interface GatedFinding {
  fingerprint: string
  file: string
  line: number
  kind: string
  lens: string
  severity: 'blocker' | 'important' | 'nit' | 'pre-existing'
  message: string
  evidence: string
  preexisting: boolean
  classOfBug?: string
}

export interface GateResult {
  postable: GatedFinding[]
  suppressed: number
  suppressedFingerprints: string[]
  dropped: number
  droppedDetail: Array<{ file: string; reason: string }>
  unverified: number
  declined: Array<{ lens: string; file: string; line: number; why: string }>
}

function severityOf(value: string): 'blocker' | 'important' | 'nit' {
  return value === 'blocker' || value === 'nit' ? value : 'important'
}

export interface GateOptions {
  root: string
  head: string
  base: string
  mode: Mode
  findings: CandidateFinding[]
  declined?: Array<{ lens?: string; file: string; line: number; why: string }>
  config: ReviewConfig
  rules: ReviewRules
  record: HeadRecord
  ledger: Ledger
}

export async function gateFindings(options: GateOptions): Promise<GateResult> {
  const { root, head, base, config, rules, record, ledger } = options
  const floor = rules.severityFloor ?? config.severityFloor
  const maxNits = rules.maxNits ?? config.maxNits
  const diffOnly = record.round > config.diffOnlyAfterRound
  const postable: GatedFinding[] = []
  const suppressedFingerprints: string[] = []
  const droppedDetail: Array<{ file: string; reason: string }> = []
  let suppressed = 0
  let dropped = 0
  let unverified = 0
  let nitCount = 0

  for (const finding of options.findings) {
    if (DROP_KINDS.includes(finding.kind.toLowerCase())) {
      dropped++
      droppedDetail.push({ file: finding.file, reason: '风格/诊断类不发：' + finding.kind })
      continue
    }
    const fingerprint = fingerprintOf({ kind: finding.kind, file: finding.file, anchor: finding.anchor })
    const previous = record.posted[fingerprint]
    if (previous !== undefined) {
      // 同一处问题被多个镜头重复发现：合并取最严，证据取并集，而不是先到先得。
      const merged = severityOf(finding.severity)
      if (severityRank(merged) > severityRank(previous.severity)) {
        ledger.event('severity-merge', { head, fingerprint, from: previous.severity, to: merged })
        previous.severity = merged
      }
      if (finding.evidence !== '' && !previous.evidence.includes(finding.evidence)) {
        previous.evidence = previous.evidence === '' ? finding.evidence : previous.evidence + ' | ' + finding.evidence
      }
      const visible = postable.find(item => item.fingerprint === fingerprint)
      if (visible !== undefined) {
        if (severityRank(merged) > severityRank(visible.severity)) visible.severity = merged
        if (finding.evidence !== '' && !visible.evidence.includes(finding.evidence)) {
          visible.evidence = visible.evidence === '' ? finding.evidence : visible.evidence + ' | ' + finding.evidence
        }
      }
      previous.repeats = (previous.repeats ?? 0) + 1
      record.suppressed += 1
      suppressed++
      suppressedFingerprints.push(fingerprint)
      continue
    }
    if (diffOnly && record.reviewedFiles.length > 0 && !record.reviewedFiles.includes(finding.file)) {
      dropped++
      droppedDetail.push({ file: finding.file, reason: '第 ' + record.round + ' 轮起只看增量，该文件本轮未变' })
      continue
    }
    const preexisting = await isPreexisting(root, base, finding.file, finding.anchor)
    if (severityRank(finding.severity) < severityRank(floor) && !preexisting) {
      dropped++
      droppedDetail.push({ file: finding.file, reason: '低于严重度下限 ' + floor })
      continue
    }
    if (finding.evidence === '' && config.evidenceRequired) {
      unverified++
      record.unverified += 1
      ledger.event('unverified', { head, file: finding.file, fingerprint, message: finding.message })
      continue
    }
    if (finding.severity === 'nit' && nitCount >= maxNits) {
      dropped++
      droppedDetail.push({ file: finding.file, reason: 'nit 已达上限 ' + maxNits })
      continue
    }
    if (postable.length >= config.maxFindings) {
      dropped++
      droppedDetail.push({ file: finding.file, reason: '单轮上限 ' + config.maxFindings })
      continue
    }
    if (finding.severity === 'nit') nitCount++
    const entry: GatedFinding = {
      fingerprint,
      file: finding.file,
      line: finding.line,
      kind: finding.kind,
      lens: finding.lens ?? '',
      severity: preexisting ? 'pre-existing' : finding.severity,
      message: finding.message,
      evidence: finding.evidence,
      preexisting,
      classOfBug: finding.classOfBug,
    }
    postable.push(entry)
    ledger.remember(record, { ...entry, at: new Date().toISOString(), repeats: 0 })
  }

  record.dropped += dropped
  return { postable, suppressed, suppressedFingerprints, dropped, droppedDetail, unverified, declined: (options.declined ?? []).map(d => ({ lens: d.lens ?? '', file: d.file, line: d.line, why: d.why })) }
}
