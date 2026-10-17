import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planForMode, classifyRisk, modeForRisk, requiredApprovals } from '../lib/modes.js'

test('三档模式的镜头与预算递增', () => {
  const quick = planForMode('quick')
  const standard = planForMode('standard')
  const deep = planForMode('deep')
  assert.equal(quick.finders.length, 2)
  assert.equal(standard.finders.length, 4)
  assert.equal(deep.finders.length, 4)
  assert.equal(quick.verifiersPerFinding, 1)
  assert.equal(deep.verifiersPerFinding, 3)
  assert.equal(quick.arbiter, false)
  assert.equal(deep.arbiter, true)
  assert.ok(quick.estimatedCalls < standard.estimatedCalls && standard.estimatedCalls < deep.estimatedCalls)
})

test('风险分级：文档=低、普通代码=中、敏感路径=高', () => {
  assert.equal(classifyRisk(['README.md', 'docs/a.md']).tier, 'low')
  assert.equal(classifyRisk(['src/app.ts']).tier, 'medium')
  assert.equal(classifyRisk(['.github/workflows/ci.yml']).tier, 'high')
  assert.equal(classifyRisk(['src/payments/charge.ts']).tier, 'high')
  assert.equal(classifyRisk(['pnpm-lock.yaml']).tier, 'high')
})

test('模式由风险与规模决定，批准人数只由风险决定', () => {
  assert.equal(modeForRisk('high', 1), 'deep')
  assert.equal(modeForRisk('low', 2), 'quick')
  assert.equal(modeForRisk('low', 40), 'standard')
  assert.equal(modeForRisk('medium', 5), 'standard')
  assert.deepEqual([requiredApprovals('low'), requiredApprovals('medium'), requiredApprovals('high')], [0, 1, 2])
})
