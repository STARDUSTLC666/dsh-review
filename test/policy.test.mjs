import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePolicy, evaluatePullRequest } from '../lib/policy.js'
import { githubEvidence } from '../lib/github.js'
const policy = { trustedAuthors:['owner'], requiredChecks:[{name:'tests',appSlug:'github-actions'},{name:'security-review',appSlug:'github-actions'}], sensitivePaths:['src/critical/**'], alwaysTwoPaths:['.github/workflows/**'] }
const head = 'a'.repeat(40), base = 'b'.repeat(40)
const evidence = () => ({ head, author:{login:'owner',type:'User'}, paths:['docs/guide.md'], draft:false, reviews:[], checks:policy.requiredChecks.map((c,i) => ({ id:i+1,name:c.name,app:{slug:c.appSlug},head_sha:head,status:'completed',conclusion:'success' })), unresolvedThreads:0 })
const approve = (login='human', extra={}) => ({id:1,user:{login,type:'User'},state:'APPROVED',commit_id:head,submitted_at:'2026-10-17T00:00:00Z',...extra})
test('lighter rules only apply to trusted human authors', () => {
 assert.equal(evaluatePullRequest(parsePolicy(policy),evidence(),{tier:'low',extraHuman:false}).ok,true)
 const e=evidence(); e.author.login='outsider'
 const result=evaluatePullRequest(policy,e,{tier:'low',extraHuman:false})
 assert.equal(result.ok,false); assert.equal(result.requiredHumanApprovals,2)
})
test('bot, author and stale-commit approvals do not fill human slots', () => {
 const e=evidence(); e.paths=['src/critical/access.js']; e.reviews=[approve('review-bot[bot]',{user:{login:'review-bot[bot]',type:'Bot'}}),approve('owner',{id:2}),approve('human',{id:3,commit_id:base})]
 const result=evaluatePullRequest(policy,e,{tier:'medium',extraHuman:false})
 assert.equal(result.ok,false); assert.equal(result.approvedHumans.length,0)
})
test('each required person must approve this exact current head', () => {
 const e=evidence(); e.paths=['.github/workflows/ci.yml']; e.reviews=[approve('one'),approve('two',{id:2})]
 assert.equal(evaluatePullRequest(policy,e,{tier:'low',extraHuman:false}).ok,true)
 e.reviews.push(approve('two',{id:3,state:'DISMISSED'}))
 assert.equal(evaluatePullRequest(policy,e,{tier:'low',extraHuman:false}).ok,false)
})
test('open threads, changed requests and non-success checks block', () => {
 for (const mutate of [e=>e.unresolvedThreads=1,e=>e.reviews.push(approve('human',{state:'CHANGES_REQUESTED'})),e=>e.checks[0].conclusion='skipped',e=>e.checks[0].head_sha=base,e=>e.checks[0].app.slug='untrusted',e=>e.checks.push({...e.checks[0],id:100,conclusion:'failure'})]) {
  const e=evidence(); mutate(e); assert.equal(evaluatePullRequest(policy,e,{tier:'low',extraHuman:false}).ok,false)
 }
})
test('a later comment does not erase a valid approval, while latest change requests do', () => {
 const e=evidence(); e.paths=['src/a.js']; e.reviews=[approve(),approve('human',{id:2,state:'COMMENTED'})]
 assert.equal(evaluatePullRequest(policy,e,{tier:'medium',extraHuman:false}).ok,true)
 e.reviews.push(approve('human',{id:3,state:'CHANGES_REQUESTED'}))
 assert.equal(evaluatePullRequest(policy,e,{tier:'medium',extraHuman:false}).ok,false)
})
test('missing check identities and malformed policy fail closed', () => {
 assert.throws(()=>parsePolicy({...policy,requiredChecks:[]}),/Invalid/)
 assert.throws(()=>parsePolicy({...policy,requiredChecks:[{name:'tests'}]}),/Invalid/)
})
test('GitHub adapter gathers read-only exact-head evidence without accepting partial inventories', async () => {
 const requests=[], pr={head:{sha:head},base:{sha:base,repo:{full_name:'owner/repo'}},changed_files:1,user:{login:'owner',type:'User'},draft:false}
 const fetcher=async(url,opts)=>{requests.push({url,method:opts.method}); let value
  if(url.endsWith('/graphql')) value={data:{repository:{pullRequest:{headRefOid:head,reviewThreads:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}}}
  else if(url.includes('/reviews?')) value=[]
  else if(url.includes('/check-runs?')) value={check_runs:[]}
  else if(url.includes('/files?')) value=[{filename:'docs/guide.md'}]
  else value=pr
  return new Response(JSON.stringify(value),{status:200})
 }
 const result=await githubEvidence('owner/repo',1,'fixture-token',head,base,fetcher)
 assert.deepEqual(result.paths,['docs/guide.md']); assert.equal(result.unresolvedThreads,0)
 assert.ok(requests.every(r=>r.method==='GET'||r.url.endsWith('/graphql')))
 pr.changed_files=2
 await assert.rejects(githubEvidence('owner/repo',1,'fixture-token',head,base,fetcher),/Incomplete/)
})
