import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { apply, resolveConfig } from '../lib/index.js'
import { buildReviewTools } from '../lib/tools.js'
import { runCheck } from '../lib/check.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let toolsDirectory
if (process.env.DSH_REVIEW_TEST_HOST_TOOLS) toolsDirectory = process.env.DSH_REVIEW_TEST_HOST_TOOLS
else {
  try {
    const mappings = JSON.parse(await readFile(path.join(here, '../../global-contracts-owned/runtime-mappings.json'), 'utf8'))
    toolsDirectory = mappings.mappings['packages/core/tools']
    await access(path.join(toolsDirectory, 'lib/index.js'))
  } catch { /* Standalone repositories can explicitly provide an official host. */ }
}

test('all Review tools register against the official schema subset and render both PTC SDKs', {
  skip: !toolsDirectory && 'Set DSH_REVIEW_TEST_HOST_TOOLS to the official installed @deepseek-ai/dsh-tools directory',
}, async () => {
  const hostTools = await import(pathToFileURL(path.join(toolsDirectory, 'lib/index.js')).href)
  const require = createRequire(pathToFileURL(path.join(toolsDirectory, 'package.json')))
  const sdk = typeof hostTools.renderToolsSdk === 'function' ? hostTools : await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tool-executor-ptc')).href)
  const registered = []
  apply({ tools: { register(tool) { hostTools.assertObjectJsonSchema(tool.parameters); registered.push(tool); return () => {} } } }, {})
  assert.equal(registered.length, 11)
  const schemas = registered.map(({ name, description, parameters }) => ({ name, description, parameters }))
  for (const render of [sdk.renderToolsSdk, sdk.renderToolsSdkPy]) {
    const source = render(schemas)
    for (const { name } of registered) assert.ok(source.includes(name))
  }
})

test('review_check advertises timeout limits while the controlled runner enforces them', async () => {
  const check = buildReviewTools(resolveConfig({})).find(tool => tool.name === 'review_check')
  const schema = check.parameters.properties.timeoutMs
  assert.match(schema.description, /1000.*600000/)
  assert.equal('minimum' in schema, false)
  assert.equal('maximum' in schema, false)
  for (const timeout of [999, 600001, 1000.5, Number.NaN]) {
    await assert.rejects(runCheck(path.resolve('.'), 'echo fixture', timeout, undefined, async () => assert.fail('invalid timeout must not execute'), { agent: {} }), /integer between 1000 and 600000/)
  }
  for (const timeout of [1000, 600000]) {
    let invoked = false
    await runCheck(path.resolve('.'), 'echo fixture', timeout, undefined, async input => {
      invoked = true
      assert.equal(input.timeoutMs, timeout)
      return { ok: true, exitCode: 0, timedOut: false, aborted: false, truncated: false, output: '' }
    }, { agent: {} })
    assert.equal(invoked, true)
  }
})
