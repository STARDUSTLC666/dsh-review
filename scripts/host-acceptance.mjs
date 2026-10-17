import assert from 'node:assert/strict'
import { mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,symlinkSync,copyFileSync } from 'node:fs'
import { join,dirname,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn,execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
const pluginRoot=process.env.DSH_REVIEW_PACKAGE_ROOT?resolve(process.env.DSH_REVIEW_PACKAGE_ROOT):fileURLToPath(new URL('../',import.meta.url))
const runtime=process.env.DSH_REVIEW_DSH_ROOT
if(!runtime)throw new Error('Set DSH_REVIEW_DSH_ROOT to the installed DSH node_modules directory')
const output=resolve(process.env.DSH_REVIEW_HOST_OUTPUT||join(pluginRoot,'.review-validation','host'))
const parent=resolve(process.env.DSH_REVIEW_TEST_ROOT||join(output,'fixtures'))
mkdirSync(output,{recursive:true});mkdirSync(parent,{recursive:true})
const home=mkdtempSync(join(parent,'fixed-host-')), profile=join(home,'profiles/web'), probe=join(home,'probe'), project=join(home,'project')
for(const dir of [profile,probe,project])mkdirSync(dir,{recursive:true})
for(const[name,target]of[['@stardustlc/dsh-review',pluginRoot],['review-fixed-probe',probe]]){const dest=join(profile,'node_modules',name);mkdirSync(dirname(dest),{recursive:true});symlinkSync(target,dest,'junction')}
writeFileSync(join(profile,'package.json'),JSON.stringify({private:true,dependencies:{'@stardustlc/dsh-review':'link:'+pluginRoot,'review-fixed-probe':'link:'+probe},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@stardustlc/dsh-review']}}}))
writeFileSync(join(profile,'cordis.yml'),'[]\n')
writeFileSync(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'agent-default-model',config:{provider:'review-qa-local',model:'synthetic'}},{id:'session-title-llm',disabled:true},{insert:[{id:'review-fixed-probe',name:'review-fixed-probe'}]}]))
writeFileSync(join(probe,'package.json'),JSON.stringify({name:'review-fixed-probe',type:'module',main:'index.mjs'}))
const fixture={runtimeVersion:JSON.parse(readFileSync(join(runtime,'@deepseek-ai/dsh/package.json'),'utf8')).version,llmModule:join(runtime,'@deepseek-ai/dsh-llm/lib/index.js'),home,profile,project,probe,reportFile:join(home,'result.json'),scenario:join(home,'scenario.json'),outside:join(home,'outside.txt'),cancelled:join(home,'after-cancel.txt'),cancelArmed:join(home,'cancel-started.txt'),adapterLog:join(home,'adapter.jsonl')}
writeFileSync(join(probe,'fixture.json'),JSON.stringify(fixture));writeFileSync(fixture.scenario,JSON.stringify({bug:true}));copyFileSync(fileURLToPath(new URL('./host-fixture.mjs',import.meta.url)),join(probe,'index.mjs'))
const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:project,encoding:'utf8'})
git('init','-q');git('config','user.name','Review QA');git('config','user.email','qa@example.invalid');writeFileSync(join(project,'host.js'),'export const added = 1\n')
writeFileSync(join(project,'write-probe.cjs'),'require("node:fs").writeFileSync('+JSON.stringify(fixture.outside)+',"permission failure")\n')
writeFileSync(join(project,'cancel-probe.cjs'),'require("node:fs").writeFileSync('+JSON.stringify(fixture.cancelArmed)+',"started");setTimeout(()=>require("node:fs").writeFileSync('+JSON.stringify(fixture.cancelled)+',"cancellation failure"),1500)\n')
git('add','-A');git('commit','-qm','synthetic baseline');writeFileSync(join(project,'host.js'),'export const added = danger().name\n')
const allow=/^(?:path|pathext|systemroot|windir|comspec|temp|tmp|appdata|localappdata|userprofile|home|homedrive|homepath|programfiles(?:\(x86\))?|programdata|os|processor_architecture)$/i
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allow.test(key)))
Object.assign(env,{DSH_HOME:home,DSH_AGENTS_HOME:join(home,'agents'),DSH_TELEMETRY_DISABLED:'1',NO_COLOR:'1'})
const child=spawn(process.execPath,[join(runtime,'@deepseek-ai/dsh/lib/bin.js'),'--profile','web','--no-open','--host','127.0.0.1','--port','0'],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>log+=chunk)
try{
 const deadline=Date.now()+180000
 while(!existsSync(fixture.reportFile)&&Date.now()<deadline&&child.exitCode===null)await delay(300)
 assert.ok(existsSync(fixture.reportFile),'No host report; inspect fixed-host.log')
 const report=JSON.parse(readFileSync(fixture.reportFile,'utf8'));writeFileSync(join(output,'fixed-host-probe.json'),JSON.stringify(report,null,2))
 assert.equal(report.error,undefined)
 assert.equal(report.operations.nativeRun.value?.status,'complete')
 assert.equal(report.operations.nativeRun.value?.calls,10)
 assert.equal(report.operations.nativeRun.value?.postable.length,1)
 assert.equal(report.operations.gateBeforeReview.value?.ok,false)
 assert.equal(report.operations.gateWithFinding.value?.ok,false)
 assert.equal(report.operations.quotedCheck.value?.output.trim(),'42')
 assert.equal(report.operations.deniedCheck.isError,true)
 assert.equal(report.wroteOutsideReadOnlyWorkspace,false)
 assert.equal(report.cancelCommandStarted,true)
 assert.equal(report.operations.cancelledCheck.isError,true)
 assert.equal(report.wroteAfterCancellation,false)
 assert.equal(report.operations.staleGate.isError,true)
 assert.equal(report.operations.fixedRun.value?.status,'complete')
 assert.equal(report.operations.fixedGate.value?.ok,true)
 assert.equal(report.operations.manualReport.isError,false)
 assert.equal(report.operations.manualReport.value?.independent,false)
 assert.equal(report.operations.manualGate.value?.ok,false)
 console.log(JSON.stringify({passed:true,reportFile:join(output,'fixed-host-probe.json'),nativeCalls:report.operations.nativeRun.value.calls+report.operations.fixedRun.value.calls,synthetic:true,liveModel:false},null,2))
}finally{
 child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,10000).unref()})
 writeFileSync(join(output,'fixed-host.log'),log.replace(/([?&]token=)[^\s&]+/g,'$1[REDACTED]'));writeFileSync(join(output,'fixed-host-fixture.json'),JSON.stringify(fixture,null,2))
 if(existsSync(fixture.adapterLog))copyFileSync(fixture.adapterLog,join(output,'fixed-host-adapter.jsonl'))
}
