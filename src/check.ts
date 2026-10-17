/**
 * 证据执行：一条 finding 要么给出能跑的检查，要么给出能反驳它的理由。
 * 这里只负责"真的跑一遍"，不负责判断语义。
 *
 * @module dsh-review/check
 */

import { excerpt, run } from './exec.js'

export interface CheckResult {
  ok: boolean
  command: string
  cwd: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  output: string
}

export async function runCheck(root: string, command: string, timeoutMs: number, cwd?: string): Promise<CheckResult> {
  const workdir = cwd === undefined ? root : cwd
  const started = Date.now()
  const isWindows = process.platform === 'win32'
  const shell = isWindows ? 'cmd.exe' : '/bin/sh'
  const args = isWindows ? ['/d', '/s', '/c', command] : ['-c', command]
  const result = await run(shell, args, { cwd: workdir, timeoutMs, maxOutputBytes: 512 * 1024 })
  return {
    ok: result.ok,
    command,
    cwd: workdir,
    exitCode: result.code,
    timedOut: result.timedOut,
    durationMs: Date.now() - started,
    output: excerpt(result.stdout + (result.stderr === '' ? '' : '\n' + result.stderr), 40, 4000),
  }
}
