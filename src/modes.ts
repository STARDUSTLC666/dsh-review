/**
 * 三档审阅深度与风险分级：模式决定"看多深"，风险决定"要几个人看"，两者独立。
 *
 * @module dsh-review/modes
 */

export type Mode = 'quick' | 'standard' | 'deep'
export type RiskTier = 'low' | 'medium' | 'high'

export interface Lens {
  id: string
  title: string
  focus: string
}

export interface ModePlan {
  mode: Mode
  finders: Lens[]
  /** 每条 finding 需要几个独立 verifier。 */
  verifiersPerFinding: number
  /** 是否启用 arbiter 汇总与去重。 */
  arbiter: boolean
  estimatedCalls: number
}

export const LENSES: Record<string, Lens> = {
  correctness: { id: 'correctness', title: '正确性与边界', focus: '空值、越界、off-by-one、错误分支、异步竞态、异常吞掉' },
  state: { id: 'state', title: '数据与状态', focus: '迁移、幂等、事务边界、缓存失效、并发写、回滚' },
  breaking: { id: 'breaking', title: '破坏性变更', focus: '公开 API/配置/协议兼容、默认值改变、序列化格式' },
  security: { id: 'security', title: '安全与秘密', focus: '注入、路径穿越、权限判断、密钥泄漏、日志敏感信息' },
}

export function planForMode(mode: Mode): ModePlan {
  if (mode === 'quick') {
    return { mode, finders: [LENSES.correctness], verifiersPerFinding: 1, arbiter: false, estimatedCalls: 2 }
  }
  if (mode === 'deep') {
    return { mode, finders: [LENSES.correctness, LENSES.state, LENSES.breaking, LENSES.security], verifiersPerFinding: 3, arbiter: true, estimatedCalls: 25 }
  }
  return { mode, finders: [LENSES.correctness, LENSES.state, LENSES.breaking, LENSES.security], verifiersPerFinding: 1, arbiter: false, estimatedCalls: 10 }
}

const SENSITIVE = [
  /(^|\/)(payments?|billing|invoices?)(\/|$)/i,
  /(^|\/)(migrations?|schema)(\/|$)/i,
  /\.github\/workflows\//i,
  /(^|\/)(auth|permissions?|acl|rbac)(\/|$)/i,
  /(^|\/)(install|installer|updater|auto-?update)(\.[a-z]+)?$/i,
  /(^|\/)package\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
]

const DOCS = [/\.(md|mdx|txt|rst)$/i, /(^|\/)docs?\//i, /(^|\/)(README|CHANGELOG)/i]
const TESTS = [/(^|\/)(test|tests|__tests__|spec)(\/|$)/i, /\.(test|spec)\.[a-z]+$/i]

export function classifyRisk(files: string[], extraSensitive: string[] = []): { tier: RiskTier; reasons: string[] } {
  const reasons: string[] = []
  let tier: RiskTier = 'low'
  for (const file of files) {
    if (SENSITIVE.some(re => re.test(file)) || extraSensitive.some(re => new RegExp(re.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')).test(file))) {
      reasons.push('敏感路径：' + file)
      tier = 'high'
    } else if (!DOCS.some(re => re.test(file)) && !TESTS.some(re => re.test(file))) {
      if (tier === 'low') { tier = 'medium'; reasons.push('普通代码改动：' + file) }
    }
  }
  if (tier === 'low') reasons.push('仅文档/测试/文案')
  return { tier, reasons }
}

export function modeForRisk(tier: RiskTier, fileCount: number): Mode {
  if (tier === 'high') return 'deep'
  if (tier === 'low' && fileCount <= 3) return 'quick'
  return 'standard'
}

/** 风险等级对应的建议人工审阅人数（只是建议，插件不替人批准）。 */
export function requiredApprovals(tier: RiskTier): number {
  return tier === 'low' ? 0 : tier === 'medium' ? 1 : 2
}
