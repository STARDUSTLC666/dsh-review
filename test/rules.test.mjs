import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadRules, matchGlob, isSkipped } from '../lib/rules.js'

test('REVIEW.md 解析：跳过、上限、严重度、模式、判据', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rules-'))
  writeFileSync(path.join(dir, 'REVIEW.md'), [
    '# 审阅规则',
    '',
    '## 跳过',
    '- vendor/**',
    '- **/*.lock',
    '',
    '## 限制',
    'max_nits: 1',
    'severity_floor: blocker',
    'mode: deep',
    '',
    '## 坏掉长什么样',
    '- 文档：说的是错的',
    '- 配置：路由错了',
    '',
    '## 敏感路径',
    '- src/billing/**',
  ].join('\n'))
  const rules = loadRules(dir)
  assert.equal(rules.found, true)
  assert.deepEqual(rules.skip, ['vendor/**', '**/*.lock'])
  assert.equal(rules.maxNits, 1)
  assert.equal(rules.severityFloor, 'blocker')
  assert.equal(rules.mode, 'deep')
  assert.deepEqual(rules.failureSignals, ['文档：说的是错的', '配置：路由错了'])
  assert.deepEqual(rules.sensitivePaths, ['src/billing/**'])
})

test('没有 REVIEW.md 时返回空规则', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rules-none-'))
  const rules = loadRules(dir)
  assert.equal(rules.found, false)
  assert.deepEqual(rules.skip, [])
})

test('glob 支持 ** 与 *', () => {
  assert.equal(matchGlob('vendor/**', 'vendor/a/b.js'), true)
  assert.equal(matchGlob('**/*.lock', 'pnpm-lock.lock'), true)
  assert.equal(matchGlob('src/*.ts', 'src/a.ts'), true)
  assert.equal(matchGlob('src/*.ts', 'src/deep/a.ts'), false)
  assert.equal(isSkipped('vendor/x/y.js', ['vendor/**']), true)
})
