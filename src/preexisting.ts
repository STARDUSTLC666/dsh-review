/**
 * 基准行查询，仅供上下文提示。同一行存在不代表缺陷预先存在；
 * 正式 pre-existing 判定必须由独立复核者说明基准版本中的成因。
 *
 * @module dsh-review/preexisting
 */

import { git } from './exec.js'
import { normalizeLine } from './fingerprint.js'
import { realpathSync } from 'node:fs'

const cache = new Map<string, Set<string>>()

export async function baseLines(root: string, base: string, file: string): Promise<Set<string>> {
  const resolved = await git(root, ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'])
  if (!resolved.ok) throw new Error('Cannot resolve review base')
  const sha = resolved.stdout.trim()
  const key = realpathSync(root) + '\u0000' + sha + '\u0000' + file
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const lines = new Set<string>()
  const result = await git(root, ['show', '--no-ext-diff', '--no-textconv', sha + ':' + file], 20000, 8 * 1024 * 1024)
  if (result.truncated) throw new Error('Base file is too large; pre-existing status is unknown')
  if (result.ok) {
    for (const line of result.stdout.split(/\r?\n/)) lines.add(normalizeLine(line))
  }
  if (cache.size >= 128) cache.clear()
  cache.set(key, lines)
  return lines
}

export async function isPreexisting(root: string, base: string, file: string, anchor: string): Promise<boolean> {
  const normalized = normalizeLine(anchor)
  if (normalized === '') return false
  const lines = await baseLines(root, base, file)
  return lines.has(normalized)
}
