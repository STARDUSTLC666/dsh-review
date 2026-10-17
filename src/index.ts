/**
 * dsh-review —— 以证据为准的代码审阅插件。
 *
 * apply(ctx, config) 注册 review_diff / review_run / review_report / review_check /
 * review_respond / review_status / review_gate / review_learn / review_issue / review_eval。
 *
 * 有 subagents 服务时 review_run 会真的起子智能体并行审；没有则生成作业书交给调用方 AI。
 *
 * @module dsh-review
 */

import { resolveConfig, type ReviewConfig } from './config.js'
import { buildReviewTools, type ReviewToolDefinition } from './tools.js'
import { createDispatcher, externalDispatcher, type Dispatcher } from './dispatch.js'

export const name = 'review'
export const inject = ['tools']

export interface ReviewPluginContext {
  tools: { register(definition: ReviewToolDefinition): () => void }
  inject?(services: string[], callback: (host: any) => unknown): unknown
}

export function apply(ctx: ReviewPluginContext, config?: Partial<ReviewConfig> | null): void {
  let resolved: ReviewConfig
  try {
    resolved = resolveConfig(config)
  } catch (error) {
    console.warn('[dsh-review] 配置无效，回退默认：' + (error instanceof Error ? error.message : String(error)))
    resolved = resolveConfig(null)
  }
  let dispatcher: Dispatcher = externalDispatcher()
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['subagents'], (host: any) => {
        const service = host?.subagents
        if (service === undefined || typeof service?.startActivation !== 'function') return
        dispatcher = createDispatcher({ subagents: service, parent: host?.agent, provider: host?.provider })
      })
    } catch (error) {
      console.warn('[dsh-review] 未能接入 subagents，review_run 将只产出作业书：' + (error instanceof Error ? error.message : String(error)))
    }
  }
  for (const definition of buildReviewTools(resolved, { dispatcher: () => dispatcher })) ctx.tools.register(definition)
}

export { resolveConfig, DEFAULT_CONFIG } from './config.js'
export type { ReviewConfig } from './config.js'
