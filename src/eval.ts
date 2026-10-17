import { git } from './exec.js'
import { Ledger } from './ledger.js'
interface Truth { bugId: string; file: string; kind: string; classOfBug: string; anchor: string }
interface EvalCase { id: string; sha: string; base: string; expected: Truth[]; note: string }
interface EvalRecord { caseId: string; runId: string; cohort: string; truePositives: string[]; falseNegatives: string[]; falsePositives: number; predictions: number; at: string }
export async function evaluation(ledger: Ledger, root: string, args: Record<string, any>) {
 const action = args.action
 const store = () => ledger.snapshot().evaluations ?? { cases: {}, results: {} }
 if (action === 'register') {
  if (!Array.isArray(args.entries)) throw new Error('register requires entries')
  const prepared: EvalCase[] = []
  for (const entry of args.entries) {
   if (!entry || typeof entry.id !== 'string' || !/^[\w.-]{1,64}$/.test(entry.id) || !Array.isArray(entry.expected)) throw new Error('Each case needs id and human-curated expected bugs; [] is a known-clean case')
   const commits: string[] = []
   for (const ref of [entry.sha, entry.base]) {
    if (typeof ref !== 'string' || !/^[a-f0-9]{7,40}$/.test(ref)) throw new Error('Evaluation sha/base must be immutable commit ids')
    const result = await git(root, ['rev-parse','--verify','--end-of-options',ref + '^{commit}'])
    if (!result.ok) throw new Error('Evaluation commit does not exist')
    commits.push(result.stdout.trim())
   }
   for (const bug of entry.expected) if (['bugId','file','kind','classOfBug','anchor'].some(key => typeof bug[key] !== 'string' || !bug[key].trim())) throw new Error('Ground truth requires bugId, file, kind, classOfBug and exact anchor')
   if (new Set(entry.expected.map((bug: Truth) => bug.bugId)).size !== entry.expected.length) throw new Error('Duplicate ground-truth bug ids')
   prepared.push({ id: entry.id, sha: commits[0], base: commits[1], expected: entry.expected.map((bug: Truth) => ({ bugId: bug.bugId, file: bug.file, kind: bug.kind, classOfBug: bug.classOfBug, anchor: bug.anchor })), note: typeof entry.note === 'string' ? entry.note : '' })
  }
  ledger.transaction(state => {
   const db = state.evaluations ??= { cases: {}, results: {} }
   for (const item of prepared) {
    if (db.cases[item.id]) throw new Error('Case id already registered; ground truth is immutable')
    db.cases[item.id] = item
   }
  })
  return { action, count: Object.keys(store().cases).length }
 }
 if (action === 'list') return { action, entries: Object.values(store().cases), results: Object.values(store().results) }
 if (action === 'prompts') {
  // Labels and incident notes deliberately stay out of the reviewer prompt.
  return { action, tasks: Object.values(store().cases).map(value => {
   const entry = value as EvalCase
   return { caseId: entry.id, head: entry.sha, base: entry.base, instructions: 'Use an isolated checkout of this exact head and base, without future commits or incident labels. Run the normal review pipeline, then record its native runId. Do not inspect the evaluation ground truth.' }
  }) }
 }
 if (action === 'record') {
  if (typeof args.caseId !== 'string' || typeof args.runId !== 'string' || typeof args.cohort !== 'string' || !args.cohort.trim()) throw new Error('record requires caseId, runId and cohort')
  ledger.transaction(state => {
   const db = state.evaluations ??= { cases: {}, results: {} }, entry = db.cases[args.caseId] as EvalCase | undefined, run = state.runs[args.runId]
   if (!entry || !run || run.status !== 'complete' || !run.independent || run.target.kind !== 'commit' || run.head !== entry.sha || run.target.base !== entry.base) throw new Error('Evaluation requires a completed native commit review of the exact case head/base')
   const findings = (run.accepted ?? []).filter(f => f.severity !== 'pre-existing')
   const unmatched = new Set(entry.expected.map(bug => bug.bugId)), matched: Truth[] = []
   let fp = 0
   for (const f of findings) {
    const bug = entry.expected.find(bug => unmatched.has(bug.bugId) && f.file === bug.file && f.kind === bug.kind && f.classOfBug === bug.classOfBug && f.anchor === bug.anchor)
    if (bug) { matched.push(bug); unmatched.delete(bug.bugId) } else fp++
   }
   const key = args.caseId + ':' + args.cohort
   if (db.results[key]) throw new Error('A case/cohort result already exists; use a new cohort for a new reviewer')
   db.results[key] = { caseId: entry.id, runId: run.id, cohort: args.cohort, truePositives: matched.map(b => b.bugId), falseNegatives: entry.expected.filter(b => !matched.includes(b)).map(b => b.bugId), falsePositives: fp, predictions: findings.length, at: new Date().toISOString() } satisfies EvalRecord
  })
  return { action, recorded: true }
 }
 if (action !== 'score') throw new Error('Unknown evaluation action')
 const db = store(), cases = Object.keys(db.cases), results = Object.values(db.results).map(r => r as EvalRecord).filter(r => !args.cohort || r.cohort === args.cohort)
 const cohorts = [...new Set(results.map(r => r.cohort))]
 return { action, registeredCases: cases.length, cohorts: cohorts.map(cohort => {
  const rows = results.filter(r => r.cohort === cohort), tp = rows.reduce((n,r) => n + r.truePositives.length, 0), fn = rows.reduce((n,r) => n + r.falseNegatives.length, 0), fp = rows.reduce((n,r) => n + r.falsePositives, 0)
  const tested = new Set(rows.map(r => r.caseId)), clean = rows.filter(r => (db.cases[r.caseId] as EvalCase).expected.length === 0)
  return { cohort, tested: tested.size, unrun: cases.filter(id => !tested.has(id)), coverage: cases.length ? tested.size / cases.length : 0, truePositives: tp, falseNegatives: fn, falsePositives: fp, strictRecall: tp + fn ? tp / (tp + fn) : null, precision: tp + fp ? tp / (tp + fp) : null, cleanCases: clean.length, cleanCaseFalsePositiveRate: clean.length ? clean.filter(r => r.falsePositives > 0).length / clean.length : null,
   completeEvaluation: tested.size === cases.length && cases.length > 0, matchedRunIds: rows.map(r => r.runId) }
 }), metric: 'Strict human-curated location/category/anchor matching; not a semantic-quality claim. Unrun cases are reported separately.' }
}
