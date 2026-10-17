/**
 * dsh-review 配置：审阅轮次、证据门槛、噪音上限。
 *
 * @module dsh-review/config
 */

export type Severity = 'blocker' | 'important' | 'nit' | 'pre-existing'

export interface ReviewConfig {
  /** 账本目录（相对仓库根）。 */
  stateDir: string
  /** 同一个 head 最多审几轮，超过后只审增量。 */
  roundCap: number
  /** 从第几轮起只看新文件（增量审阅）。 */
  diffOnlyAfterRound: number
  /** 单轮最多发多少条 finding。 */
  maxFindings: number
  /** 单轮最多发多少条 nit（0 表示不发 nit）。 */
  maxNits: number
  /** 低于该严重度的 finding 不发。 */
  severityFloor: Exclude<Severity, 'pre-existing'>
  /** 没有可执行证据的 finding 是否降级（true=降级为 unverified，不发）。 */
  evidenceRequired: boolean
  /** 证据命令超时。 */
  commandTimeoutMs: number
  /** 单次 diff 读取上限，超过则只取统计。 */
  maxDiffBytes: number
}

export const DEFAULT_CONFIG: ReviewConfig = {
  stateDir: '.dsh-review',
  roundCap: 3,
  diffOnlyAfterRound: 2,
  maxFindings: 20,
  maxNits: 2,
  severityFloor: 'important',
  evidenceRequired: true,
  commandTimeoutMs: 120000,
  maxDiffBytes: 4 * 1024 * 1024,
}

const SEVERITY_RANK: Record<Severity, number> = { blocker: 3, important: 2, nit: 1, 'pre-existing': 0 }

export function severityRank(value: Severity): number {
  return SEVERITY_RANK[value] ?? 0
}

function intIn(value: unknown, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(label + ' 必须是数字')
  const n = Math.trunc(value)
  if (n < min || n > max) throw new Error(label + ' 必须在 ' + min + ' 到 ' + max + ' 之间')
  return n
}

export function resolveConfig(raw?: Partial<ReviewConfig> | null): ReviewConfig {
  const input = (raw ?? {}) as Record<string, unknown>
  const config: ReviewConfig = { ...DEFAULT_CONFIG }
  if (input.stateDir !== undefined) {
    if (typeof input.stateDir !== 'string' || input.stateDir.trim() === '') throw new Error('stateDir 必须是非空字符串')
    config.stateDir = input.stateDir.trim()
  }
  config.roundCap = intIn(input.roundCap, config.roundCap, 1, 20, 'roundCap')
  config.diffOnlyAfterRound = intIn(input.diffOnlyAfterRound, config.diffOnlyAfterRound, 1, 20, 'diffOnlyAfterRound')
  config.maxFindings = intIn(input.maxFindings, config.maxFindings, 1, 200, 'maxFindings')
  config.maxNits = intIn(input.maxNits, config.maxNits, 0, 100, 'maxNits')
  config.commandTimeoutMs = intIn(input.commandTimeoutMs, config.commandTimeoutMs, 1000, 600000, 'commandTimeoutMs')
  config.maxDiffBytes = intIn(input.maxDiffBytes, config.maxDiffBytes, 1024, 64 * 1024 * 1024, 'maxDiffBytes')
  if (input.severityFloor !== undefined) {
    const floor = String(input.severityFloor)
    if (!['blocker', 'important', 'nit'].includes(floor)) throw new Error('severityFloor 只能是 blocker | important | nit')
    config.severityFloor = floor as ReviewConfig['severityFloor']
  }
  if (input.evidenceRequired !== undefined) {
    if (typeof input.evidenceRequired !== 'boolean') throw new Error('evidenceRequired 必须是布尔值')
    config.evidenceRequired = input.evidenceRequired
  }
  return config
}
