import test from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { repo, tools, scripted, candidate } from './helpers.mjs'
import { captureTarget } from '../lib/target.js'
import { candidateId, parseVote } from '../lib/gate.js'
import { classifyRisk } from '../lib/modes.js'

function owned(t, ...args) {
  const r = repo(...args)
  t.after(() => { assert.ok(path.basename(r.root).startsWith('dsh-review-')); rmSync(r.root, { recursive: true, force: true }) })
  return r
}
test('verification rejects blank, unrelated-file and distant witnesses even when they exist in the snapshot', async t => {
  const r = owned(t, { 'src/a.js': 'const keep = 42\nexport const value = 1\n', 'src/b.js': 'export const other = 0\n' }, {
    'src/a.js': 'const keep = 42\n' + candidate.anchor + '\n\n' + Array.from({ length: 20 }, (_, i) => 'const unrelated' + i + ' = 0').join('\n'),
    'src/b.js': 'export const other = 1\n',
  })
  const target = await captureTarget(r.root, {}, 4e6, '@profile'), id = candidateId(candidate, target)
  for (const witness of [
    { file: 'src/a.js', line: 3, anchor: '' },
    { file: 'src/b.js', line: 1, anchor: 'export const other = 1' },
    { file: 'src/a.js', line: 20, anchor: 'const unrelated16 = 0' },
  ]) assert.throws(() => parseVote({ candidateId: id, decision: 'reject', reason: 'A long generic reason proves absolutely nothing', witnesses: [witness] }, 'independent', id, target, candidate), /witness|candidate|snapshot/i)
  const valid = parseVote({ candidateId: id, decision: 'confirm', reason: 'The introducing dereference executes without a null guard', witnesses: [{ file: candidate.file, line: candidate.line, anchor: candidate.anchor }] }, 'independent', id, target, candidate)
  assert.equal(valid.decision, 'confirm')
})
test('a changed target cannot mark a posted defect fixed while its original anchor remains', async t => {
  const r = owned(t), first = tools(r.root, {}, { dispatcher: () => scripted({ find: task => task.id === 'find-correctness' ? [candidate] : [] }) })
  await first.call('review_run')
  r.write('src/extra.js', 'export const unrelated = true\n')
  const next = tools(r.root, {}, { dispatcher: () => scripted({ decision: 'reject' }) })
  const run = await next.call('review_run')
  assert.equal((await next.call('review_status')).byDisposition.fixed ?? 0, 0)
  assert.ok(run.unverified > 0)
  assert.equal((await next.call('review_gate', { runId: run.runId })).ok, false)
})
test('default profile state never excludes repository code named .dsh-review or @profile', async t => {
  const r = owned(t)
  for (const file of ['.dsh-review/payments/charge.js', '@profile/auth/login.js']) r.write(file, 'export const charge = dangerous()\n')
  const target = await captureTarget(r.root, {}, 4e6, '@profile')
  for (const file of ['.dsh-review/payments/charge.js', '@profile/auth/login.js']) {
    assert.ok(target.files.some(item => item.path === file), file)
    assert.ok(target.allPaths.includes(file), file)
    assert.ok(!target.skipped.includes(file), file)
  }
  assert.equal(classifyRisk(target.allPaths, []).tier, 'high')
})
