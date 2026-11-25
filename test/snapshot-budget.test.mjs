import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { repo } from './helpers.mjs'
import { captureTarget } from '../lib/target.js'
import { loadRules } from '../lib/rules.js'

test('oversized untracked files fail before a whole-file allocation', async t => {
  const r = repo(), file = path.join(r.root, 'oversized.bin')
  fs.writeFileSync(file, '')
  fs.truncateSync(file, 16 * 1024 * 1024)
  const original = fs.readFileSync
  t.mock.method(fs, 'readFileSync', function (target, ...args) {
    if (path.resolve(String(target)) === file) throw new Error('oversized source was bulk-read')
    return original.call(this, target, ...args)
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  await assert.rejects(captureTarget(r.root, {}, 4096, '.dsh-review'), /snapshot exceeds maxDiffBytes/)
})

test('oversized review guidance fails before its file is opened', t => {
  const r = repo(), file = path.join(r.root, 'REVIEW.md')
  r.write('REVIEW.md', 'x'.repeat(32 * 1024 + 1))
  const original = fs.openSync
  let opened = false
  t.mock.method(fs, 'openSync', function (target, ...args) {
    if (path.resolve(String(target)) === file) opened = true
    return original.call(this, target, ...args)
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  assert.throws(() => loadRules(r.root), /32 KiB/)
  assert.equal(opened, false)
})
