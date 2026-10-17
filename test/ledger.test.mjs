import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Ledger } from '../lib/ledger.js'

const finding = (fp) => ({ fingerprint: fp, file: 'a.js', line: 1, kind: 'correctness', severity: 'important', message: 'm', evidence: 'echo', at: new Date().toISOString(), repeats: 0 })

test('轮次累加与持久化', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-'))
  const a = new Ledger(dir, '.dsh-review')
  assert.equal(a.beginRound('head1', 'standard').round, 1)
  assert.equal(a.beginRound('head1', 'standard').round, 2)
  a.remember(a.head('head1'), finding('fp1'))
  a.save()
  const b = new Ledger(dir, '.dsh-review')
  assert.equal(b.head('head1').round, 2)
  assert.ok(b.head('head1').posted.fp1)
})

test('处置与噪音率', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-noise-'))
  const l = new Ledger(dir, '.dsh-review')
  const rec = l.beginRound('h', 'standard')
  l.remember(rec, finding('f1'))
  l.remember(rec, finding('f2'))
  l.respond('h', 'f1', 'wrong', '不是 bug')
  l.respond('h', 'f2', 'fixed')
  const status = l.status('h')
  assert.equal(status.posted, 2)
  assert.equal(status.byDisposition.wrong, 1)
  assert.equal(status.byDisposition.fixed, 1)
  assert.equal(status.noiseRate, 0.5)
})

test('未答复不计入噪音率分母', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-unanswered-'))
  const l = new Ledger(dir, '.dsh-review')
  const rec = l.beginRound('h', 'standard')
  l.remember(rec, finding('f1'))
  assert.equal(l.status('h').noiseRate, null)
  assert.equal(l.status('h').byDisposition.unanswered, 1)
})

test('坏状态文件不致命', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-bad-'))
  const l = new Ledger(dir, '.dsh-review')
  assert.equal(l.status().posted, 0)
})
