/**
 * REVIEW.md：仓库级审阅规则。写法参照 Claude Code 团队的约定——
 * 说清"这里坏掉长什么样"、上限、跳过的路径，并要求 file:line 证据。
 *
 * @module dsh-review/rules
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface ReviewRules {
  found: boolean
  path: string | null
  /** 跳过审阅的路径 glob。 */
  skip: string[]
  /** 单轮 nit 上限（覆盖配置）。 */
  maxNits: number | null
  /** 严重度下限（覆盖配置）。 */
  severityFloor: 'blocker' | 'important' | 'nit' | null
  /** 审阅模式（覆盖自动分级）。 */
  mode: 'quick' | 'standard' | 'deep' | null
  /** "这里坏掉长什么样"的条目，喂给 finder 当判据。 */
  failureSignals: string[]
  /** 需要额外人工的路径（风险分级用）。 */
  sensitivePaths: string[]
}

const CANDIDATES = ['REVIEW.md', '.dsh-review/REVIEW.md', 'docs/REVIEW.md']

function parseList(lines: string[]): string[] {
  return lines.map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(l => l !== '' && !l.startsWith('#'))
}

export function loadRules(root: string): ReviewRules {
  const rules: ReviewRules = { found: false, path: null, skip: [], maxNits: null, severityFloor: null, mode: null, failureSignals: [], sensitivePaths: [] }
  const file = CANDIDATES.map(c => path.join(root, c)).find(p => existsSync(p))
  if (file === undefined) return rules
  rules.found = true
  rules.path = path.relative(root, file).replace(/\\/g, '/')
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  let section = ''
  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^#{1,6}\s*(.+)$/.exec(line.trim())
    if (heading !== null) { section = heading[1].toLowerCase(); continue }
    if (/^(skip|跳过|ignore|忽略)/.test(section)) {
      const item = /^\s*[-*]\s*(.+)$/.exec(line)
      if (item !== null) rules.skip.push(item[1].trim())
      continue
    }
    if (/^(sensitive|敏感|high.?risk|高风险)/.test(section)) {
      const item = /^\s*[-*]\s*(.+)$/.exec(line)
      if (item !== null) rules.sensitivePaths.push(item[1].trim())
      continue
    }
    if (/^(failure|坏掉|失败|what breaks|判据)/.test(section)) {
      const item = /^\s*[-*]\s*(.+)$/.exec(line)
      if (item !== null) rules.failureSignals.push(item[1].trim())
      continue
    }
    const kv = /^\s*([a-z_]+)\s*[:：]\s*(.+)$/i.exec(line)
    if (kv !== null) {
      const key = kv[1].toLowerCase()
      const value = kv[2].trim()
      if (key === 'max_nits' && /^\d+$/.test(value)) rules.maxNits = Number(value)
      if (key === 'severity_floor' && ['blocker', 'important', 'nit'].includes(value)) rules.severityFloor = value as ReviewRules['severityFloor']
      if (key === 'mode' && ['quick', 'standard', 'deep'].includes(value)) rules.mode = value as ReviewRules['mode']
    }
  }
  return rules
}

/**
 * 极简 glob：** 匹配任意层级（含零层），* 只在本层匹配。
 * 支持 REVIEW.md 里常见的 vendor/**、**\/*.lock、src/*.ts。
 */
export function matchGlob(pattern: string, target: string): boolean {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
  const input = target.replace(/\\/g, '/')
  let regex = ''
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') { regex += '(?:.*/)?'; i += 2; continue }
        regex += '.*'; i += 1; continue
      }
      regex += '[^/]*'
      continue
    }
    if (ch === '?') { regex += '[^/]'; continue }
    regex += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + regex + '$').test(input)
}

export function isSkipped(file: string, skip: string[]): boolean {
  return skip.some(pattern => matchGlob(pattern, file))
}
