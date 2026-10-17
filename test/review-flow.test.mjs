import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildReviewTools } from '../lib/tools.js'
import { resolveConfig } from '../lib/config.js'

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-review-flow-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'tester')
  mkdirSync(path.join(dir, 'src'), { recursive: true })
  writeFileSync(path.join(dir, 'src/a.js'), ['const x = 1', 'const keep = 42', 'return x'].join('\n'))
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  writeFileSync(path.join(dir, 'src/a.js'), ['const x = 1', 'const keep = 42', 'const added = doThing()', 'return x'].join('\n'))
  return dir
}

function tools(config) {
  const map = new Map(buildReviewTools(resolveConfig(config)).map(t => [t.name, t]))
  return (name, args) => map.get(name).execute(args)
}

test('review_diff 给出 head、文件与模式', async () => {
  const dir = makeRepo()
  const prev = process.cwd()
  process.chdir(dir)
  try {
    const call = tools({ stateDir: '.dsh-review' })
    const plan = await call('review_diff', {})
    assert.match(plan.head, /^[0-9a-f]{40}$/)
    assert.equal(plan.files.length, 1)
    assert.equal(plan.files[0].path, 'src/a.js')
    assert.ok(['quick', 'standard', 'deep'].includes(plan.mode))
    assert.ok(plan.plan.finders.length >= 1)
  } finally { process.chdir(prev) }
})

test('风格类直接丢弃，没有证据的进 unverified 而不是发出去', async () => {
  const dir = makeRepo()
  const prev = process.cwd()
  process.chdir(dir)
  try {
    const call = tools({ stateDir: '.dsh-review', evidenceRequired: true })
    const plan = await call('review_diff', {})
    const result = await call('review_report', {
      head: plan.head,
      findings: [
        { file: 'src/a.js', line: 3, kind: 'style', severity: 'important', message: '这行太长', anchor: 'const added = doThing()' },
        { file: 'src/a.js', line: 3, kind: 'correctness', severity: 'important', message: 'doThing 可能返回 null', anchor: 'const added = doThing()' },
      ],
    })
    assert.equal(result.postable.length, 0)
    assert.equal(result.dropped, 1)
    assert.equal(result.unverified, 1)
  } finally { process.chdir(prev) }
})

test('带证据的结论可发，重复提交被压制且只记一次', async () => {
  const dir = makeRepo()
  const prev = process.cwd()
  process.chdir(dir)
  try {
    const call = tools({ stateDir: '.dsh-review', evidenceRequired: true })
    const plan = await call('review_diff', {})
    const check = await call('review_check', { command: 'echo ok' })
    assert.equal(check.ok, true)
    const first = await call('review_report', {
      head: plan.head,
      findings: [{ file: 'src/a.js', line: 3, kind: 'correctness', severity: 'important', message: 'doThing 可能返回 null', anchor: 'const added = doThing()', evidence: 'review_check: echo ok' }],
    })
    assert.equal(first.postable.length, 1)
    assert.match(first.postable[0].fingerprint, /^[0-9a-f]{16}$/)
    const second = await call('review_report', {
      head: plan.head,
      findings: [{ file: 'src/a.js', line: 3, kind: 'correctness', severity: 'important', message: 'doThing 可能返回 null（措辞变了）', anchor: 'const added = doThing()', evidence: 'review_check: echo ok' }],
    })
    assert.equal(second.postable.length, 0)
    assert.equal(second.suppressed, 1)
  } finally { process.chdir(prev) }
})

test('重复发现应合并取最严，而不是先到先得', async () => {
  const dir = makeRepo()
  const prev = process.cwd()
  process.chdir(dir)
  try {
    const call = tools({ stateDir: '.dsh-review' })
    const plan = await call('review_diff', {})
    await call('review_report', { head: plan.head, findings: [
      { file: 'src/a.js', line: 3, kind: 'correctness', severity: 'important', message: 'A 镜头', anchor: 'const added = doThing()', evidence: 'e1' },
    ] })
    const second = await call('review_report', { head: plan.head, findings: [
      { file: 'src/a.js', line: 3, kind: 'correctness', severity: 'blocker', message: 'B 镜头', anchor: 'const added = doThing()', evidence: 'e2' },
    ] })
    assert.equal(second.postable.length, 0)
    assert.equal(second.suppressed, 1)
    const status = await call('review_status', { head: plan.head })
    assert.equal(status.posted, 1)
  } finally { process.chdir(prev) }
})

test('旧代码里的同样一行会被标成 pre-existing', async () => {
  const dir = makeRepo()
  const prev = process.cwd()
  process.chdir(dir)
  try {
    const call = tools({ stateDir: '.dsh-review' })
    const plan = await call('review_diff', {})
    const result = await call('review_report', {
      head: plan.head,
      findings: [{ file: 'src/a.js', line: 2, kind: 'correctness', severity: 'important', message: 'keep 未使用', anchor: 'const keep = 42', evidence: 'review_check: echo ok' }],
    })
    assert.equal(result.postable.length, 1)
    assert.equal(result.postable[0].preexisting, true)
    assert.equal(result.postable[0].severity, 'pre-existing')
  } finally { process.chdir(prev) }
})

test('nit 上限与处置驱动的噪音率', async () => {
  const dir = makeRepo()
  const prev = process.cwd()
  process.chdir(dir)
  try {
    const call = tools({ stateDir: '.dsh-review', severityFloor: 'nit', maxNits: 1 })
    const plan = await call('review_diff', {})
    const result = await call('review_report', {
      head: plan.head,
      findings: [
        { file: 'src/a.js', line: 3, kind: 'correctness', severity: 'nit', message: 'n1', anchor: 'const added = doThing()', evidence: 'e' },
        { file: 'src/a.js', line: 4, kind: 'correctness', severity: 'nit', message: 'n2', anchor: 'return x', evidence: 'e' },
      ],
    })
    assert.equal(result.postable.length, 1)
    assert.equal(result.dropped, 1)
    const fp = result.postable[0].fingerprint
    await call('review_respond', { head: plan.head, fingerprint: fp, disposition: 'wrong', note: '不是问题' })
    const status = await call('review_status', { head: plan.head })
    assert.equal(status.byDisposition.wrong, 1)
    assert.equal(status.noiseRate, 1)
  } finally { process.chdir(prev) }
})

test('第三轮后会提示轮次上限', async () => {
  const dir = makeRepo()
  const prev = process.cwd()
  process.chdir(dir)
  try {
    const call = tools({ stateDir: '.dsh-review', roundCap: 2 })
    const plan = await call('review_diff', {})
    await call('review_report', { head: plan.head, findings: [] })
    const second = await call('review_report', { head: plan.head, findings: [] })
    assert.ok(second.advice.includes('上限'))
  } finally { process.chdir(prev) }
})
