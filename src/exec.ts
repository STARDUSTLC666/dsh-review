/**
 * 命令执行：git 与证据检查共用；带超时、输出上限与工作目录。
 *
 * @module dsh-review/exec
 */

import { spawn } from 'node:child_process'

export interface RunResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

export interface RunOptions {
  cwd: string
  timeoutMs: number
  maxOutputBytes?: number
  input?: string
  env?: NodeJS.ProcessEnv
}

const DEFAULT_OUTPUT_LIMIT = 256 * 1024

export function run(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const started = Date.now()
  const limit = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT
  return new Promise<RunResult>(resolve => {
    let settled = false
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs)
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut, durationMs: Date.now() - started })
    }
    child.stdout?.on('data', (chunk: Buffer) => { if (stdout.length < limit) stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < limit) stderr += chunk.toString('utf8') })
    child.on('error', (error: Error) => { stderr += error.message; finish(null) })
    child.on('close', (code: number | null) => finish(code))
    if (options.input !== undefined) {
      child.stdin?.end(options.input)
    } else {
      child.stdin?.end()
    }
  })
}

export async function git(cwd: string, args: string[], timeoutMs = 30000): Promise<RunResult> {
  return run('git', args, { cwd, timeoutMs })
}

/** 输出裁剪：保留头部与尾部，中间省略。 */
export function excerpt(text: string, maxLines = 40, maxChars = 4000): string {
  const trimmed = text.trimEnd()
  if (trimmed === '') return ''
  const lines = trimmed.split(/\r?\n/)
  let out = lines.length > maxLines ? [...lines.slice(0, maxLines), '… (' + (lines.length - maxLines) + ' 行省略)'].join('\n') : trimmed
  if (out.length > maxChars) out = out.slice(0, maxChars) + '…'
  return out
}
