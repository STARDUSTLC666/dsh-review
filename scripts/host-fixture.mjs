import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
const fixture = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'))
const { LlmAdapter } = await import(pathToFileURL(fixture.llmModule).href)
const log = value => appendFileSync(fixture.adapterLog, JSON.stringify(value) + '\n')
class Adapter extends LlmAdapter {
 providerInfo(id) { return { id, name: 'Synthetic local review acceptance' } }
 async listModels(provider) { return [{ provider,id:'synthetic',name:'Synthetic',inputModalities:['text'] }] }
 async resolveModel(provider,id) { return {provider,id,name:'Synthetic',inputModalities:['text'],context:{contextWindow:500000}} }
 async *stream(options) {
  const texts = options.messages.flatMap(m => typeof m.content === 'string' ? [m.content] : m.content.filter(b=>b.type==='text').map(b=>b.text))
  const prompt = texts.find(t => t.includes('this exact identity: ')) ?? ''
  const match = /this exact identity: (\{[^\n]+\})/.exec(prompt)
  if (!match) throw new Error('Missing synthetic review identity')
  const identity = JSON.parse(match[1]), taskId = identity.taskId
  const snapshotPath = prompt.split('\n').find(l=>l.startsWith('Immutable review snapshot (read this first): ')).slice('Immutable review snapshot (read this first): '.length)
  const target=JSON.parse(readFileSync(snapshotPath,'utf8')), scenario=JSON.parse(readFileSync(fixture.scenario,'utf8'))
  let value
  if(taskId.startsWith('find-')) value={findings:taskId==='find-correctness'&&scenario.bug?[{file:'host.js',line:1,kind:'correctness',severity:'important',anchor:target.files.find(f=>f.path==='host.js').after.split(/\r?\n/)[0],message:'Synthetic null dereference has a concrete trigger',classOfBug:'unchecked-null',evidence:'Synthetic fixture only'}]:[],declined:[]}
  else if(taskId.startsWith('risk-')) value={tier:'medium',extraHuman:false,reasons:['Synthetic source change with ordinary risk']}
  else if(taskId.startsWith('verify-')) {
   let finding; for(const line of prompt.split('\n')){try{const v=JSON.parse(line);if(v.id)finding=v}catch{}}
   const file=target.files.find(f=>f.path==='host.js')
   value={candidateId:finding.id,decision:scenario.bug?'confirm':'reject',reason:scenario.bug?'Independent synthetic source evidence confirms the null property access.':'The new source removed the unsafe property access; the former defect is absent.',witnesses:[{file:'host.js',line:1,anchor:file.after.split(/\r?\n/)[0],side:'after'}]}
  } else {
   const line=prompt.split('\n').find(l=>l.startsWith('Confirmed candidates: '))
   value={orderedIds:JSON.parse(line.slice('Confirmed candidates: '.length)).map(f=>f.id),summary:'1 synthetic verified finding; preserve independent votes.',needsHuman:false}
  }
  log({taskId,roles:options.messages.map(m=>m.role),parentHistoryLeak:texts.some(t=>t.includes('PARENT_ONLY_SENTINEL')),synthetic:true})
  const block={type:'text',text:JSON.stringify({...identity,...value})}
  yield {type:'block-start',index:0,blockType:'text'}; yield{type:'text-delta',index:0,text:block.text}; yield{type:'block-end',index:0,block}; yield{type:'finish',reason:{kind:'stop'}}
 }
}
export const inject=['tools','appReady','agents','permissionPresets','llm','subagents','agentPresets']
export function apply(ctx) {
 ctx.effect(()=>ctx.llm.registerAdapter(['review-qa-local'],new Adapter()))
 ctx.effect(()=>ctx.appReady.onReady(()=>{void(async()=>{
  const report={runtime:fixture.runtimeVersion,isolated:true,liveModel:false,syntheticModel:true,operations:{}}
  let handle
  try{
   handle=await ctx.agents.create({sessionId:'review-fixed-'+Date.now(),meta:{cwd:fixture.project},agentOptions:{provider:'review-qa-local',model:'synthetic'}})
   await ctx.agentPresets.select(handle.agent,'standard')
   ctx.permissionPresets.set(handle.agent.session,'danger-full-access')
   const call=(name,args,signal=AbortSignal.timeout(90000))=>handle.agent.ctx.get('tools').execute({callId:'fixed-'+name+'-'+Date.now(),name,arguments:args,agent:handle.agent,signal})
   report.tools=ctx.tools.schemas().filter(t=>t.name.startsWith('review_')).map(t=>t.name)
   report.operations.gateBeforeReview=await call('review_gate',{})
   report.operations.plan=await call('review_diff',{})
   report.operations.nativeRun=await call('review_run',{mode:'deep'})
   const run=report.operations.nativeRun.value
   if(!run?.runId)throw new Error('Native review did not return runId: '+JSON.stringify(report.operations.nativeRun))
   const identity={runId:run.runId,targetId:run.targetId}
   report.operations.gateWithFinding=await call('review_gate',{runId:run.runId})
   report.operations.quotedCheck=await call('review_check',{...identity,command:'node -e "console.log(42)"',timeoutMs:5000})
   ctx.permissionPresets.set(handle.agent.session,'read-only')
   report.operations.deniedCheck=await call('review_check',{...identity,command:'node write-probe.cjs',timeoutMs:5000})
   report.wroteOutsideReadOnlyWorkspace=existsSync(fixture.outside)
   ctx.permissionPresets.set(handle.agent.session,'danger-full-access')
   const controller=new AbortController()
   let settled=false
   const checking=call('review_check',{...identity,command:'node cancel-probe.cjs',timeoutMs:10000},controller.signal).finally(()=>{settled=true})
   const cancelDeadline=Date.now()+10000
   while(!existsSync(fixture.cancelArmed)&&!settled&&Date.now()<cancelDeadline)await delay(25)
   report.cancelCommandStarted=existsSync(fixture.cancelArmed);controller.abort()
   report.operations.cancelledCheck=await checking
   await delay(1800); report.wroteAfterCancellation=existsSync(fixture.cancelled)
   writeFileSync(fixture.scenario,JSON.stringify({bug:false}))
   writeFileSync(fixture.project+'/host.js','export const added = safe()\n')
   report.operations.staleGate=await call('review_gate',{runId:run.runId})
   report.operations.fixedRun=await call('review_run',{mode:'standard'})
   const fixed=report.operations.fixedRun.value
   report.operations.fixedGate=await call('review_gate',{runId:fixed?.runId})
   report.operations.status=await call('review_status',{})
   report.operations.manualRun=await call('review_run',{dryRun:true,mode:'quick'})
   const manual=report.operations.manualRun.value
   const results=manual.tasks.map(t=>({runId:manual.runId,targetId:manual.targetId,taskId:t.id,...(t.role==='find'?{findings:[],declined:[]}:{tier:'medium',extraHuman:false,reasons:['External manual synthetic classification']})}))
   report.operations.manualReport=await call('review_report',{runId:manual.runId,targetId:manual.targetId,results})
   report.operations.manualGate=await call('review_gate',{runId:manual.runId})
   report.operations.issue=await call('review_issue',{title:'Synthetic issue crash',body:'Untrusted reproduction text'})
  }catch(error){report.error=error.stack??error.message}
  finally{if(handle)await handle.dispose();writeFileSync(fixture.reportFile,JSON.stringify(report,null,2))}
 })().catch(error=>writeFileSync(fixture.reportFile,JSON.stringify({error:error.stack})))}))
}
