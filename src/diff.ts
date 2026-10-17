/**
 * 统一 diff 解析：把 git diff 拆成文件 / hunk / 行，并保留新文件行号。
 *
 * @module dsh-review/diff
 */

export type LineType = 'add' | 'del' | 'ctx'

export interface DiffLine {
  type: LineType
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface Hunk {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'

export interface FileDiff {
  path: string
  oldPath: string | null
  status: FileStatus
  binary: boolean
  hunks: Hunk[]
  added: number
  removed: number
}

export interface ParsedDiff {
  files: FileDiff[]
  added: number
  removed: number
  complete: boolean
}

const HEADER = /^diff --git a\/(.+?) b\/(.+)$/

export function gitPath(value: string): string {
  if (!value.startsWith('"')) return value
  if (!value.endsWith('"')) throw new Error('Incomplete quoted Git path')
  const bytes: number[] = []
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] !== '\\') { bytes.push(...Buffer.from(value[i])); continue }
    const octal = /^[0-7]{1,3}/.exec(value.slice(i + 1))
    if (octal) { bytes.push(parseInt(octal[0], 8)); i += octal[0].length; continue }
    const ch = value[++i]
    const escaped: Record<string, string> = { t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v', a: '\x07', '\\': '\\', '"': '"' }
    if (!(ch in escaped)) throw new Error('Invalid Git path escape')
    bytes.push(...Buffer.from(escaped[ch]))
  }
  return Buffer.from(bytes).toString('utf8')
}

export function parseDiff(raw: string): ParsedDiff {
  const files: FileDiff[] = []
  let current: FileDiff | null = null
  let hunk: Hunk | null = null
  let oldNo = 0
  let newNo = 0
  let complete = true

  const push = () => {
    if (current !== null) files.push(current)
    current = null
    hunk = null
  }

  for (const line of raw.split(/\r?\n/)) {
    const quoted = /^diff --git ("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/.exec(line)
    const header = HEADER.exec(line)
      ?? (quoted ? [line, gitPath(quoted[1]).replace(/^a\//, ''), gitPath(quoted[2]).replace(/^b\//, '')] : null)
    if (line.startsWith('diff --git ') && header === null) complete = false
    if (header !== null) {
      push()
      current = { path: header[2], oldPath: header[1], status: 'modified', binary: false, hunks: [], added: 0, removed: 0 }
      continue
    }
    if (current === null) continue
    if (line.startsWith('new file mode')) { current.status = 'added'; continue }
    if (line.startsWith('deleted file mode')) { current.status = 'deleted'; continue }
    if (line.startsWith('rename from')) { current.status = 'renamed'; current.oldPath = line.slice(12).trim(); continue }
    if (line.startsWith('copy from')) { current.status = 'copied'; current.oldPath = line.slice(10).trim(); continue }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') { current.binary = true; continue }
    if (hunk === null && line.startsWith('--- ')) {
      const target = line.slice(4).trim()
      if (current.status !== 'added' && target !== '/dev/null') current.oldPath = gitPath(target).replace(/^a\//, '')
      continue
    }
    if (hunk === null && line.startsWith('+++ ')) {
      const target = line.slice(4).trim()
      if (target !== '/dev/null') current.path = gitPath(target).replace(/^b\//, '')
      continue
    }
    const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunkHeader !== null) {
      oldNo = Number(hunkHeader[1])
      newNo = Number(hunkHeader[3])
      hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [] }
      current.hunks.push(hunk)
      continue
    }
    if (hunk === null) continue
    if (line.startsWith('\\')) continue
    const marker = line.slice(0, 1)
    const text = line.slice(1)
    if (marker === '+') {
      hunk.lines.push({ type: 'add', oldNo: null, newNo, text })
      current.added++
      newNo++
    } else if (marker === '-') {
      hunk.lines.push({ type: 'del', oldNo, newNo: null, text })
      current.removed++
      oldNo++
    } else if (marker === ' ') {
      hunk.lines.push({ type: 'ctx', oldNo, newNo, text })
      oldNo++
      newNo++
    }
  }
  push()
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  return { files, added, removed, complete }
}

/** 取某个新行号附近的上下文（用于给 finding 定位）。 */
export function contextAround(file: FileDiff, line: number, radius = 3): DiffLine[] {
  for (const hunk of file.hunks) {
    const index = hunk.lines.findIndex(l => l.newNo === line)
    if (index < 0) continue
    return hunk.lines.slice(Math.max(0, index - radius), index + radius + 1)
  }
  return []
}
