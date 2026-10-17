import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs'
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
  l.save()
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
  l.save()
  assert.equal(l.status('h').noiseRate, null)
  assert.equal(l.status('h').byDisposition.unanswered, 1)
})

test('坏状态文件不致命', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-bad-'))
  const l = new Ledger(dir, '.dsh-review')
  assert.equal(l.status().posted, 0)
})

test('concurrent instances cannot silently overwrite one another', () => {
 const dir=mkdtempSync(path.join(process.env.DSH_REVIEW_TEST_ROOT||tmpdir(),'ledger-race-'))
 const a=new Ledger(dir,'.dsh-review'),b=new Ledger(dir,'.dsh-review')
 a.beginRound('one','standard');a.save();b.beginRound('two','standard')
 assert.throws(()=>b.save(),/stale write/)
 b.transaction(state=>{state.heads.two={head:'two',round:1,mode:'standard',posted:{},reviewedFiles:[],dropped:0,suppressed:0,unverified:0,updatedAt:new Date().toISOString()}})
 assert.deepEqual(Object.keys(new Ledger(dir,'.dsh-review').snapshot().heads).sort(),['one','two'])
})
test('v1 migration preserves its original evidence but never inherits a clean approval', () => {
 const dir=mkdtempSync(path.join(process.env.DSH_REVIEW_TEST_ROOT||tmpdir(),'ledger-v1-')),directory=path.join(dir,'.dsh-review');mkdirSync(directory)
 const original=JSON.stringify({version:1,heads:{legacy:{round:1,posted:{}}}});writeFileSync(path.join(directory,'state.json'),original)
 const ledger=new Ledger(dir,'.dsh-review');assert.equal(ledger.status().legacyPresent,true);assert.equal(ledger.status().runs.length,0)
 ledger.transaction(()=>{});assert.equal(readFileSync(path.join(directory,'state.json.v1.backup'),'utf8'),original)
})
test('an intentionally relocated DSH_HOME works while state-child junctions remain forbidden', () => {
 const dir=mkdtempSync(path.join(process.env.DSH_REVIEW_TEST_ROOT||tmpdir(),'ledger-profile-')),actual=path.join(dir,'actual-home'),link=path.join(dir,'linked-home')
 mkdirSync(actual);symlinkSync(actual,link,process.platform==='win32'?'junction':'dir')
 const previous=process.env.DSH_HOME;process.env.DSH_HOME=link
 try{const ledger=new Ledger(dir,'@profile');assert.ok(ledger.directory.startsWith(actual));ledger.event('relocated',{})}finally{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous}
 symlinkSync(actual,path.join(dir,'unsafe-state'),process.platform==='win32'?'junction':'dir')
 assert.throws(()=>new Ledger(dir,'unsafe-state'),/symlink/)
})
