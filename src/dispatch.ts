/**
 * 把镜头作业派给子智能体。有 subagents 服务就真派，没有就退回"给用户 AI 的指令"。
 *
 * @module dsh-review/dispatch
 */

import { randomUUID } from 'node:crypto'
import type { LensTask } from './lenses.js'

export interface Dispatcher {
  kind: 'subagents' | 'external'
  reason?: string
  dispatch(task: LensTask): Promise<{ ok: boolean; reason?: string }>
  settle(): Promise<void>
}

export interface DispatcherOptions {
  subagents?: {
    startActivation?(input: Record<string, unknown>): Promise<unknown>
    waitForChildren?(parent: unknown): Promise<unknown>
  }
  parent?: unknown
  provider?: string
}

export function externalDispatcher(): Dispatcher {
  return {
    kind: 'external',
    reason: '当前宿主没有 subagents 服务：作业书已生成，请调用方 AI 按 prompt 执行并把 JSON 写回 outFile。',
    async dispatch() { return { ok: false, reason: 'external' } },
    async settle() {},
  }
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const svc = options.subagents
  const start = svc?.startActivation
  if (svc === undefined || typeof start !== 'function') return externalDispatcher()
  return {
    kind: 'subagents',
    async dispatch(task: LensTask) {
      try {
        await start({
          delivery: 'parent',
          childId: randomUUID(),
          provider: options.provider,
          label: task.id,
          request: { prompt: task.prompt, parent: options.parent },
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },
    async settle() {
      if (typeof svc.waitForChildren === 'function' && options.parent !== undefined) {
        try { await svc.waitForChildren(options.parent) } catch { /* 单个子智能体失败不影响已完成产出 */ }
      }
    },
  }
}
