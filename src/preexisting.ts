/**
 * 预存在判定：同样一行代码在 base 版本里就有 → 标 pre-existing，
 * 不让"改一行"的人背上一堆旧债（对应文章里 59% 重复告警的教训）。
 *
 * @module dsh-review/preexisting
 */

import { git } from './exec.js'
import { normalizeLine } from './fingerprint.js'

const cache = new Map<string, Set<string>>()

export async function baseLines(root: string, base: string, file: string): Promise<Set<string>> {
  const key = base + '\u0000' + file
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const lines = new Set<string>()
  const result = await git(root, ['show', base + ':' + file], 20000)
  if (result.ok) {
    for (const line of result.stdout.split(/\r?\n/)) lines.add(normalizeLine(line))
  }
  cache.set(key, lines)
  return lines
}

export async function isPreexisting(root: string, base: string, file: string, anchor: string): Promise<boolean> {
  const normalized = normalizeLine(anchor)
  if (normalized === '') return false
  const lines = await baseLines(root, base, file)
  return lines.has(normalized)
}
