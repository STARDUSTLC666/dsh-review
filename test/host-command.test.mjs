import test from 'node:test'
import assert from 'node:assert/strict'
import { executeHostCommand } from '../lib/host-command.js'
const input=()=>({name:'bash',arguments:{command:"printf '%s' 'quote & value'",workdir:'E:/fixture with spaces'},agent:{ctx:{get:()=>({language:'typescript'})}},signal:new AbortController().signal})
const result={isError:false,value:{exitCode:0,stdout:{text:'passed'},stderr:{text:''}}}
test('legacy calls keep the caller agent, arguments and cancellation',async()=>{
 const call=input();let seen;assert.equal(await executeHostCommand({execute:async v=>(seen=v,result)},call),result)
 assert.equal(seen.agent,call.agent);assert.equal(seen.signal,call.signal);assert.equal(seen.arguments,call.arguments)
})
test('native batch results must settle the exact admitted correlation id',async()=>{
 const call=input(),tools={definitions:()=>[],selectExecutor:()=>({describe:()=>({schemas:[{name:'bash'}]})}),execute:async v=>({results:[{callId:v.calls[0].id,result}]})}
 assert.equal(await executeHostCommand(tools,call),result)
 for(const rows of [[],[{callId:'wrong',result}],[{callId:'x',result},{callId:'x',result}]])await assert.rejects(executeHostCommand({...tools,execute:async()=>({results:rows})},call),/incomplete|mismatched/)
})
test('PTC uses the selected transport and preserves quoted arguments, never dispatching a direct shell call',async()=>{
 const call=input(),logs=[],seen=[]
 const tools={definitions:()=>[],selectExecutor:()=>({describe:()=>({schemas:[{name:'run_code'}]})}),async execute(value){
  seen.push(value.calls[0].name);const args=JSON.parse(value.calls[0].arguments)
  const run=new Function('tools','console','return (async()=>{'+args.code+'})()')
  await run({bash:async args=>{assert.deepEqual(args,call.arguments);return result.value}},{log:line=>logs.push(line)})
  return{results:[{callId:value.calls[0].id,result:{isError:false,value:{logs}}}]}
 }}
 assert.deepEqual((await executeHostCommand(tools,call)).value,result.value);assert.deepEqual(seen,['run_code'])
})
test('PTC refusals and missing, duplicated or denied results never become passing evidence',async()=>{
 const base={definitions:()=>[],selectExecutor:()=>({describe:()=>({schemas:[{name:'run_code'}]})})},call=input()
 for(const value of [{logs:[]},{logs:[],sandbox:{denied:true}}])await assert.rejects(executeHostCommand({...base,execute:async v=>({results:[{callId:v.calls[0].id,result:{isError:false,value}}]})},call),/missing|denied/)
 const error={isError:true,error:{message:'permission refused'}}
 assert.equal(await executeHostCommand({...base,execute:async v=>({results:[{callId:v.calls[0].id,result:error}]})},call),error)
})
test('cancellation prevents dispatch and unsupported tool names are rejected',async()=>{
 const call=input(),controller=new AbortController();controller.abort(new Error('canceled'))
 const tools={execute:()=>assert.fail('must not dispatch')}
 await assert.rejects(executeHostCommand(tools,{...call,signal:controller.signal}),/canceled/)
 await assert.rejects(executeHostCommand(tools,{...call,name:'bash;unexpected'}),/Unsupported/)
})
