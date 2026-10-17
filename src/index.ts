/**
 * dsh-review —— 以证据为准的代码审阅插件。
 *
 * 导出 apply(ctx, config)：注册 review_diff / review_report / review_check /
 * review_respond / review_status 五个工具。账本默认写到仓库内 .dsh-review/。
 *
 * @module dsh-review
 */

import { resolveConfig, type ReviewConfig } from './config.js'
import { buildReviewTools, type ReviewToolDefinition } from './tools.js'

export const name = 'review'
export const inject = ['tools']

export interface ReviewPluginContext {
  tools: { register(definition: ReviewToolDefinition): () => void }
}

export function apply(ctx: ReviewPluginContext, config?: Partial<ReviewConfig> | null): void {
  let resolved: ReviewConfig
  try {
    resolved = resolveConfig(config)
  } catch (error) {
    console.warn('[dsh-review] 配置无效，回退默认：' + (error instanceof Error ? error.message : String(error)))
    resolved = resolveConfig(null)
  }
  for (const definition of buildReviewTools(resolved)) ctx.tools.register(definition)
}

export { resolveConfig, DEFAULT_CONFIG } from './config.js'
export type { ReviewConfig } from './config.js'
