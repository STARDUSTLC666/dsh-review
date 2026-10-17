import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDispatcher } from '../lib/dispatch.js'
const task={id:'fixture',title:'Fixture',prompt:'independent review',outFile:'unused'}
test('dispatcher uses the actual service receiver, parent, prompt blocks and result lifecycle', async () => {
 const parent={id:'live-parent'},signal=new AbortController().signal, events=[]
 const service={resolveMaxDepth(){return 2},getProvider(){return {inheritsParentContext:false}},async startActivation(input){assert.equal(this,service);assert.equal(input.request.parent,parent);assert.deepEqual(input.request.prompt,[{type:'text',text:task.prompt}]);assert.equal(input.request.maxDepth,2);events.push('start');return {childId:'child',result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'{}'}]}),async dispose(){events.push('dispose')}}}}
 const dispatcher=createDispatcher({subagents:service,parent,signal,cwd:process.cwd()})
 assert.equal((await dispatcher.dispatch(task)).ok,true);assert.deepEqual(events,['start','dispose'])
})
test('forked context, partial errors and missing live parents never count as reviews', async () => {
 const signal=new AbortController().signal, parent={}, cwd=process.cwd()
 const fork=createDispatcher({parent,signal,cwd,subagents:{getProvider:()=>({inheritsParentContext:true}),async startActivation(){throw new Error('must not start')}}})
 assert.equal((await fork.dispatch(task)).ok,false)
 const partial=createDispatcher({parent,signal,cwd,subagents:{getProvider:()=>({inheritsParentContext:false}),async startActivation(){return {childId:'partial',result:Promise.resolve({stopReason:'error',output:[{type:'text',text:'{"findings":[]}'}]}),async dispose(){}}}}})
 assert.equal((await partial.dispatch(task)).ok,false)
 assert.equal(createDispatcher({subagents:{}}).kind,'external')
})
