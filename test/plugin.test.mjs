import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'
test('registered tools are disposed with the plugin, so reloading does not leak duplicates', () => {
 const active=new Set(),disposers=[]
 const ctx={tools:{register(tool){active.add(tool.name);return()=>active.delete(tool.name)}},effect(effect){disposers.push(effect())}}
 apply(ctx)
 assert.equal(active.size,11)
 for(const dispose of disposers)dispose()
 assert.equal(active.size,0)
 apply(ctx);assert.equal(active.size,11)
})
test('invalid configuration is reported, never silently replaced with permissive defaults', () => {
 assert.throws(()=>apply({tools:{register(){throw new Error('must not register')}}},{roundCap:0}),/roundCap/)
})
test('read-only review tools declare isConcurrencySafe while mutating tools do not', () => {
 const defs=new Map()
 apply({tools:{register(tool){defs.set(tool.name,tool);return()=>{}}}})
 assert.equal(defs.get('review_health').isConcurrencySafe(),true)
 assert.equal(defs.get('review_diff').isConcurrencySafe(),true)
 assert.equal(defs.get('review_status').isConcurrencySafe(),true)
 assert.equal(defs.get('review_run').isConcurrencySafe,undefined)
 assert.equal(defs.get('review_respond').isConcurrencySafe,undefined)
})
