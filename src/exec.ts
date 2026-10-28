/**
 * 受信任的结构化 Git 读取。证据命令由宿主 Bash 工具执行。
 *
 * @module dsh-review/exec
 */

import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { prepareRawDiff } from './git-safety.js'

export interface RunResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
  truncated: boolean
}

export interface RunOptions {
  cwd: string
  timeoutMs: number
  maxOutputBytes?: number
  input?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
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
    let truncated = false
    let bytes = 0
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    const abort = () => child.kill('SIGKILL')
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs)
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      stdout += decoders.stdout.end(); stderr += decoders.stderr.end()
      resolve({ ok: code === 0 && !timedOut && !options.signal?.aborted && !truncated, code, stdout, stderr, timedOut, truncated, durationMs: Date.now() - started })
    }
    const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const available = Math.max(0, limit - bytes)
      const accepted = chunk.subarray(0, available)
      bytes += accepted.length
      const value = decoders[stream].write(accepted)
      if (stream === 'stdout') stdout += value; else stderr += value
      if (accepted.length < chunk.length) truncated = true
    }
    child.stdout?.on('data', (chunk: Buffer) => collect('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => collect('stderr', chunk))
    child.on('error', (error: Error) => { stderr += error.message; finish(null) })
    child.on('close', (code: number | null) => finish(code))
    if (options.input !== undefined) {
      child.stdin?.end(options.input)
    } else {
      child.stdin?.end()
    }
  })
}

export async function git(cwd: string, args: string[], timeoutMs = 30000, maxOutputBytes = DEFAULT_OUTPUT_LIMIT, signal?: AbortSignal): Promise<RunResult> {
  const config = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.attributesFile=' + (process.platform === 'win32' ? 'NUL' : '/dev/null')]
  const env = { ...process.env, GIT_ATTR_NOSYSTEM: '1' }
  if (args[0] !== 'diff') return run('git', [...config, ...args], { cwd, timeoutMs, maxOutputBytes, signal, env })
  const started = Date.now()
  try {
    const isolation = await prepareRawDiff(async query => {
      const result = await run('git', [...config, ...query], { cwd, timeoutMs: Math.min(timeoutMs, 10000), maxOutputBytes: 65536, signal, env })
      if (!result.ok) throw new Error('Git safety metadata unavailable; review incomplete')
      return result.stdout
    })
    const result = await run('git', [...config, isolation.option, ...args], { cwd, timeoutMs, maxOutputBytes, signal, env })
    isolation.verify()
    return result
  } catch (error) {
    return { ok: false, code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error), timedOut: false, truncated: false, durationMs: Date.now() - started }
  }
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
