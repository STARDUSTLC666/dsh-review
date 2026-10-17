/**
 * dsh-review 配置：审阅轮次、证据门槛、噪音上限。
 *
 * @module dsh-review/config
 */

export type Severity = 'blocker' | 'important' | 'nit' | 'pre-existing'

export interface ReviewConfig {
  /** @profile 按仓库隔离，或显式指定仓库内子目录。 */
  stateDir: string
  /** 每个审阅系列的完成轮次上限，超过后停止。 */
  roundCap: number
  /** 超过这轮后，新问题限定到相对上轮的增量行。 */
  diffOnlyAfterRound: number
  /** 单轮最多发多少条 finding。 */
  maxFindings: number
  /** 单轮最多发多少条 nit（0 表示不发 nit）。 */
  maxNits: number
  /** 低于该严重度的 finding 不发。 */
  severityFloor: Exclude<Severity, 'pre-existing'>
  /** 旧配置兼容项；不能关闭独立验证或以文字断言替代证据。 */
  evidenceRequired: boolean
  /** 证据命令超时。 */
  commandTimeoutMs: number
  /** 补丁与源码快照上限；超出则保持未完成。 */
  maxDiffBytes: number
  maxCalls: number
  runTimeoutMs: number
  subagentProvider: string
  maxParallel: number
}

export const DEFAULT_CONFIG: ReviewConfig = {
  stateDir: '@profile',
  roundCap: 3,
  diffOnlyAfterRound: 2,
  maxFindings: 20,
  maxNits: 2,
  severityFloor: 'important',
  evidenceRequired: true,
  commandTimeoutMs: 120000,
  maxDiffBytes: 4 * 1024 * 1024,
  maxCalls: 80,
  runTimeoutMs: 600000,
  subagentProvider: 'spawn',
  maxParallel: 3,
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
  config.maxCalls = intIn(input.maxCalls, config.maxCalls, 1, 1000, 'maxCalls')
  config.maxParallel = intIn(input.maxParallel, config.maxParallel, 1, 8, 'maxParallel')
  config.runTimeoutMs = intIn(input.runTimeoutMs, config.runTimeoutMs, 1000, 3600000, 'runTimeoutMs')
  if (input.subagentProvider !== undefined) {
    if (typeof input.subagentProvider !== 'string' || !/^[\w-]+$/.test(input.subagentProvider)) throw new Error('Invalid subagentProvider')
    config.subagentProvider = input.subagentProvider
  }
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
