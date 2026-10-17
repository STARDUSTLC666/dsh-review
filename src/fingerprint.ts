/**
 * finding 指纹：用"种类 + 文件 + 归一化代码行"生成稳定 id，
 * 这样重排、rebase、加空行都不会让同一条 finding 变新，天然支持"不复报"。
 *
 * @module dsh-review/fingerprint
 */

import { createHash } from 'node:crypto'

export function normalizeLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function fingerprintOf(input: { kind: string; file: string; anchor: string }): string {
  const payload = [input.kind.trim().toLowerCase(), input.file.replace(/\\/g, '/').trim(), normalizeLine(input.anchor)].join('\u0000')
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}
