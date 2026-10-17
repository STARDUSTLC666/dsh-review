import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repo, tools, scripted, candidate } from './helpers.mjs'
test('evaluation matches curated defects, separates unrun cases and measures clean-case noise', async () => {
 const r=repo(); r.git('add','src/a.js');r.git('commit','-qm','synthetic introduced bug');const badSha=r.git('rev-parse','HEAD')
 const d=scripted({find:t=>t.id==='find-correctness'?[{...candidate,classOfBug:'unrelated-defect'}]:[]}), {call}=tools(r.root,{}, {dispatcher:()=>d})
 const truth={bugId:'null-access',file:candidate.file,kind:candidate.kind,classOfBug:candidate.classOfBug,anchor:candidate.anchor}
 await call('review_eval',{action:'register',entries:[{id:'incident',sha:badSha,base:r.baseSha,expected:[truth],note:'Secret human incident answer must not reach reviewer prompts'}]})
 const prompts=await call('review_eval',{action:'prompts'})
 assert.doesNotMatch(JSON.stringify(prompts),/Secret human|unchecked-null/)
 const run=await call('review_run',{base:r.baseSha})
 await call('review_eval',{action:'record',caseId:'incident',runId:run.runId,cohort:'synthetic-control'})
 let score=await call('review_eval',{action:'score'}), cohort=score.cohorts[0]
 assert.equal(cohort.strictRecall,0);assert.equal(cohort.falsePositives,1);assert.equal(cohort.falseNegatives,1)
 await assert.rejects(call('review_eval',{action:'record',caseId:'incident',runId:run.runId,cohort:'synthetic-control'}),/already exists/)
 r.write('src/a.js','const keep = 42\nexport const value = safe()\n');r.git('add','src/a.js');r.git('commit','-qm','synthetic clean control');const cleanSha=r.git('rev-parse','HEAD')
 await call('review_eval',{action:'register',entries:[{id:'known-clean',sha:cleanSha,base:badSha,expected:[]}]})
 score=await call('review_eval',{action:'score'});cohort=score.cohorts[0]
 assert.deepEqual(cohort.unrun,['known-clean']);assert.equal(cohort.completeEvaluation,false)
 const cleanFinding={...candidate,anchor:'export const value = safe()',classOfBug:'false-positive'}
 const next=tools(r.root,{}, {dispatcher:()=>scripted({find:t=>t.id==='find-correctness'?[cleanFinding]:[]})})
 const clean=await next.call('review_run',{base:badSha})
 await next.call('review_eval',{action:'record',caseId:'known-clean',runId:clean.runId,cohort:'synthetic-control'})
 cohort=(await next.call('review_eval',{action:'score'})).cohorts[0]
 assert.equal(cohort.cleanCaseFalsePositiveRate,1);assert.equal(cohort.completeEvaluation,true);assert.equal(cohort.coverage,1)
})
test('correctly matched findings score independently of later ledger dispositions', async () => {
 const r=repo();r.git('add','src/a.js');r.git('commit','-qm','synthetic bug');const sha=r.git('rev-parse','HEAD')
 const {call}=tools(r.root,{}, {dispatcher:()=>scripted({find:t=>t.id==='find-correctness'?[candidate]:[]})})
 await call('review_eval',{action:'register',entries:[{id:'bug',sha,base:r.baseSha,expected:[{bugId:'b',file:candidate.file,kind:candidate.kind,classOfBug:candidate.classOfBug,anchor:candidate.anchor}]}]})
 const run=await call('review_run',{base:r.baseSha})
 await call('review_respond',{runId:run.runId,targetId:run.targetId,fingerprint:run.postable[0].fingerprint,disposition:'wrong',note:'A later triage opinion must not rewrite the immutable evaluation prediction.'})
 await call('review_eval',{action:'record',caseId:'bug',runId:run.runId,cohort:'synthetic-match'})
 const score=(await call('review_eval',{action:'score'})).cohorts[0]
 assert.equal(score.strictRecall,1);assert.equal(score.precision,1)
})
test('historical labels require real immutable commits and native commit/base runs', async () => {
 const r=repo(),{call}=tools(r.root)
 await assert.rejects(call('review_eval',{action:'register',entries:[{id:'bad',sha:'main',base:r.baseSha,expected:[]}]}),/immutable/)
 await call('review_eval',{action:'register',entries:[{id:'clean',sha:r.baseSha,base:r.baseSha,expected:[]}]})
 const run=await call('review_run')
 await assert.rejects(call('review_eval',{action:'record',caseId:'clean',runId:run.runId,cohort:'manual'}),/completed native/)
 assert.deepEqual((await call('review_eval',{action:'score'})).cohorts,[])
})
