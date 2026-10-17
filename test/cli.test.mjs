import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repo, tools, scripted } from './helpers.mjs'
import { main } from '../lib/cli.js'
test('CLI requires explicit AI-only scope locally; full gating never assumes missing GitHub evidence', async () => {
 const r=repo(),{call}=tools(r.root,{}, {dispatcher:()=>scripted()}),run=await call('review_run')
 const args=['--run',run.runId,'--root',r.root,'--state-dir','.dsh-review']
 const result=await main([...args,'--ai-only']);assert.equal(result.ok,true);assert.match(result.scope,/not checked/)
 await assert.rejects(main(args),/commit\/base/)
 await assert.rejects(main(['--unknown']),/Usage/)
})
