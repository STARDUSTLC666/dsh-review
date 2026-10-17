import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildReviewTools } from '../lib/tools.js'
import { resolveConfig } from '../lib/config.js'

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-review-adv-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q'); git('config', 'user.email', 't@e.com'); git('config', 'user.name', 't')
  mkdirSync(path.join(dir, 'src'), { recursive: true })
  writeFileSync(path.join(dir, 'src/a.js'), ['const x = 1', 'return x'].join('\n'))
  git('add', '-A'); git('commit', '-q', '-m', 'base')
  writeFileSync(path.join(dir, 'src/a.js'), ['const x = 1', 'const y = danger()', 'return x'].join('\n'))
  return dir
}

// 假派发器：直接按作业书写 JSON，模拟子智能体产出
function fakeDispatcher(findingsByLens) {
  return {
    kind: 'subagents',
    async dispatch(task) {
      const items = findingsByLens[task.id] ?? []
      mkdirSync(path.dirname(task.outFile), { recursive: true })
      writeFileSync(task.outFile, JSON.stringify({ lens: task.id, findings: items, declined: [] }), 'utf8')
      return { ok: true }
    },
    async settle() {},
  }
}

test('review_run 无派发能力时返回可执行作业书', async () => {
  const dir = makeRepo()
  const prev = process.cwd(); process.chdir(dir)
  try {
    const map = new Map(buildReviewTools(resolveConfig({ stateDir: '.dsh-review' })).map(t => [t.name, t]))
    const r = await map.get('review_run').execute({})
    assert.equal(r.dispatcher, 'external')
    assert.ok(r.tasks.length >= 1)
    assert.ok(r.tasks[0].prompt.includes('硬性要求'))
    assert.ok(r.tasks[0].outFile.endsWith('.json'))
    assert.equal(r.postable.length, 0)
  } finally { process.chdir(prev) }
})

test('review_run 派发后自动过把关层', async () => {
  const dir = makeRepo()
  const prev = process.cwd(); process.chdir(dir)
  try {
    const dispatcher = fakeDispatcher({
      correctness: [{ file: 'src/a.js', line: 2, kind: 'correctness', severity: 'blocker', message: 'danger 未判空', anchor: 'const y = danger()', evidence: 'node repro → TypeError' }],
      security: [{ file: 'src/a.js', line: 2, kind: 'style', severity: 'nit', message: '变量名太短', anchor: 'const y = danger()', evidence: 'e' }],
    })
    const map = new Map(buildReviewTools(resolveConfig({ stateDir: '.dsh-review' }), { dispatcher: () => dispatcher }).map(t => [t.name, t]))
    const r = await map.get('review_run').execute({})
    assert.equal(r.dispatcher, 'subagents')
    assert.equal(r.postable.length, 1)
    assert.equal(r.postable[0].lens, 'correctness')
    assert.equal(r.dropped, 1)
  } finally { process.chdir(prev) }
})

test('review_gate 在未关闭前拒绝，关闭后通过', async () => {
  const dir = makeRepo()
  const prev = process.cwd(); process.chdir(dir)
  try {
    const map = new Map(buildReviewTools(resolveConfig({ stateDir: '.dsh-review' })).map(t => [t.name, t]))
    const plan = await map.get('review_diff').execute({})
    const r = await map.get('review_report').execute({ head: plan.head, findings: [
      { file: 'src/a.js', line: 2, kind: 'correctness', severity: 'blocker', message: 'x', anchor: 'const y = danger()', evidence: 'e' },
    ] })
    const fp = r.postable[0].fingerprint
    const gate1 = await map.get('review_gate').execute({ head: plan.head })
    assert.equal(gate1.ok, false)
    assert.equal(gate1.exitCode, 1)
    const gateAfter = await map.get('review_gate').execute({ head: plan.head })
    await map.get('review_respond').execute({ head: plan.head, fingerprint: fp, disposition: 'fixed' })
    const gate2 = await map.get('review_gate').execute({ head: plan.head })
    assert.equal(gate2.ok, true)
    assert.equal(gate2.exitCode, 0)
    void gateAfter
  } finally { process.chdir(prev) }
})

test('review_learn 从账本沉淀建议', async () => {
  const dir = makeRepo()
  const prev = process.cwd(); process.chdir(dir)
  try {
    const map = new Map(buildReviewTools(resolveConfig({ stateDir: '.dsh-review' })).map(t => [t.name, t]))
    const plan = await map.get('review_diff').execute({})
    await map.get('review_report').execute({ head: plan.head, findings: [
      { file: 'src/a.js', line: 2, kind: 'correctness', severity: 'important', message: 'a', anchor: 'const y = danger()', evidence: 'e' },
      { file: 'src/a.js', line: 1, kind: 'correctness', severity: 'important', message: 'b', anchor: 'const x = 1', evidence: 'e' },
    ] })
    const r = await map.get('review_learn').execute({})
    assert.ok(r.suggestions.length >= 1)
    assert.ok(r.markdown.includes('##'))
  } finally { process.chdir(prev) }
})

test('review_issue 分类并产出作业书', async () => {
  const dir = makeRepo()
  const prev = process.cwd(); process.chdir(dir)
  try {
    const map = new Map(buildReviewTools(resolveConfig({ stateDir: '.dsh-review' })).map(t => [t.name, t]))
    const r = await map.get('review_issue').execute({ title: '应用崩溃，无法启动', body: '点开就报错' })
    assert.equal(r.kind, 'bug')
    assert.ok(readFileSync(r.promptFile, 'utf8').includes('分诊'))
    assert.ok(r.outFile.endsWith('.json'))
  } finally { process.chdir(prev) }
})

test('review_eval 登记与打分', async () => {
  const dir = makeRepo()
  const prev = process.cwd(); process.chdir(dir)
  try {
    const map = new Map(buildReviewTools(resolveConfig({ stateDir: '.dsh-review' })).map(t => [t.name, t]))
    const reg = await map.get('review_eval').execute({ action: 'register', entries: [{ sha: 'abc123', note: '线上空指针' }] })
    assert.equal(reg.count, 1)
    const list = await map.get('review_eval').execute({ action: 'list' })
    assert.equal(list.entries.length, 1)
    const score = await map.get('review_eval').execute({ action: 'score' })
    assert.equal(score.total, 1)
    assert.equal(score.found, 0)
  } finally { process.chdir(prev) }
})
