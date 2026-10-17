import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { repo, tools } from './helpers.mjs'
import { captureTarget } from '../lib/target.js'
import { Ledger } from '../lib/ledger.js'
import { isPreexisting } from '../lib/preexisting.js'
import { loadRules } from '../lib/rules.js'
import { symlinkSync } from 'node:fs'
test('Chinese and escaped filenames are included in source snapshots', async () => {
 const file = 'src/中文 文件.js', r = repo({ [file]: 'export const a = 1\n' }, { [file]: 'export const a = 2\n' })
 const target = await captureTarget(r.root, {}, 4e6, '.dsh-review')
 assert.equal(target.files.length, 1); assert.equal(target.files[0].path, file); assert.equal(target.files[0].addedLines[0], 1)
})
test('staged target reads the index, not newer working-tree changes', async () => {
 const r = repo(); r.git('add','src/a.js'); r.write('src/a.js', 'not the staged content\n')
 const target = await captureTarget(r.root, { staged: true }, 4e6, '.dsh-review')
 assert.match(target.files[0].after, /danger\(\)/); assert.equal(target.kind, 'staged')
 const run = await tools(r.root).call('review_run', { staged: true })
 const snapshot = JSON.parse(readFileSync(path.join(r.root, '.dsh-review','runs',run.runId,'snapshot.json'), 'utf8'))
 assert.match(snapshot.files[0].after, /danger\(\)/); assert.doesNotMatch(snapshot.files[0].after, /not the staged/)
})
test('oversized diffs fail with an explicit coverage error instead of silently dropping files', async () => {
 const r = repo(); r.write('src/huge.js', 'large content\n'.repeat(500)); r.write('src/z-last.js','tail failure()\n')
 await assert.rejects(captureTarget(r.root, {}, 1024, '.dsh-review'), /exceeds|incomplete/)
 assert.equal((await tools(r.root).call('review_gate')).ok, false)
})
test('a skipped file changing still invalidates the target identity', async () => {
 const r = repo({ 'src/ignored.js':'old\n','REVIEW.md':'# Skip\n- src/ignored.js\n' }, { 'src/ignored.js':'first\n' })
 const first = await captureTarget(r.root, {}, 4e6, '.dsh-review'); r.write('src/ignored.js','second\n')
 const next = await captureTarget(r.root, {}, 4e6, '.dsh-review')
 assert.notEqual(next.id, first.id); assert.deepEqual(first.skipped,['src/ignored.js'])
})
test('untracked source is included by default and state files are excluded', async () => {
 const r = repo(); r.write('src/untracked.js','new function\n'); const ledger = new Ledger(r.root,'.dsh-review'); ledger.event('fixture',{})
 const target = await captureTarget(r.root, {}, 4e6, '.dsh-review')
 assert.ok(target.files.some(f => f.path === 'src/untracked.js')); assert.ok(!target.allPaths.some(f => f.startsWith('.dsh-review/')))
 const without = await captureTarget(r.root, { includeUntracked:false }, 4e6, '.dsh-review')
 assert.ok(!without.files.some(f => f.path === 'src/untracked.js'))
})
test('historical source cache is isolated by actual repository and immutable base', async () => {
 const a = repo({ 'src/a.js':'shared\n' }, {}), b = repo({ 'src/a.js':'different\n' }, {})
 assert.equal(await isPreexisting(a.root, 'HEAD', 'src/a.js', 'shared'), true)
 assert.equal(await isPreexisting(b.root, 'HEAD', 'src/a.js', 'shared'), false)
})
test('committed changes cannot relax their own review rules', async () => {
 const r=repo({'src/a.js':'export const value = 1\n','REVIEW.md':'## 限制\nmax_nits: 0\n'}, {'src/a.js':'export const value = danger().name\n','REVIEW.md':'## Skip\n- **\n'})
 r.git('add','-A');r.git('commit','-qm','attempt to bypass review')
 const target=await captureTarget(r.root,{base:r.baseSha},4e6,'.dsh-review')
 assert.equal(target.rules.maxNits,0);assert.deepEqual(target.rules.skip,[])
 assert.ok(target.files.some(f=>f.path==='src/a.js'))
})
test('guidance may not follow a directory junction outside the workspace', () => {
 const r=repo(),privateRepo=repo({'REVIEW.md':'private fixture data\n'}, {})
 symlinkSync(privateRepo.root,path.join(r.root,'docs'),process.platform==='win32'?'junction':'dir')
 assert.throws(()=>loadRules(r.root),/inside the workspace/)
})
