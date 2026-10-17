import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildReviewTools } from '../lib/tools.js'
import { resolveConfig } from '../lib/config.js'
export function repo(initial = { 'src/a.js': 'const keep = 42\nexport const value = 1\n' }, changed = { 'src/a.js': 'const keep = 42\nexport const value = danger().name\n' }) {
 const base = process.env.DSH_REVIEW_TEST_ROOT || tmpdir(); mkdirSync(base, { recursive: true })
 const root = mkdtempSync(path.join(base, 'dsh-review-'))
 const git = (...args) => execFileSync('git', ['-c','core.autocrlf=false',...args], { cwd: root, encoding: 'utf8' }).trim()
 const write = (file, content) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content) }
 git('init','-q'); git('config','user.name','Review Test'); git('config','user.email','review@example.invalid')
 for (const [file, content] of Object.entries(initial)) write(file, content)
 git('add','-A'); git('commit','-qm','base'); const baseSha = git('rev-parse','HEAD')
 for (const [file, content] of Object.entries(changed)) write(file, content)
 return { root, git, write, baseSha }
}
export const candidate = { file: 'src/a.js', line: 2, kind: 'correctness', severity: 'important', message: 'danger() can be null and the property access throws', anchor: 'export const value = danger().name', evidence: 'A narrative is not independent proof', classOfBug: 'unchecked-null' }
export function scripted(options = {}) {
 const seen = []
 return { kind: 'subagents', seen, async settle() {}, async dispatch(task) {
  seen.push(task)
  if (options.dispatch) { const custom = await options.dispatch(task, seen); if (custom !== undefined) return custom }
  const snapshotFile = task.prompt.split('\n').find(line => line.startsWith('Immutable review snapshot (read this first): ')).slice('Immutable review snapshot (read this first): '.length)
  const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'))
  const envelope = { runId: task.runId, targetId: task.targetId, taskId: task.id }
  let data
  if (task.role === 'find') data = { findings: options.find ? await options.find(task, snapshot) : [], declined: [] }
  else if (task.role === 'risk') data = { tier: options.risk ?? 'medium', extraHuman: options.extraHuman ?? false, reasons: ['Synthetic fixture classification for ordinary code'] }
  else if (task.role === 'verify') {
   let finding
   for (const line of task.prompt.split('\n')) { try { const value = JSON.parse(line); if (value.id === task.candidateId) finding = value } catch {} }
   const file = snapshot.files.find(f => f.path === finding?.file) ?? snapshot.files[0]
   const line = file?.after?.split(/\r?\n/).findIndex(l => l.trim()) ?? -1
   data = { candidateId: task.candidateId, decision: options.decision ?? 'confirm', reason: 'Independent source tracing confirms the concrete null dereference trigger', witnesses: line >= 0 ? [{ file: file.path, line: line + 1, anchor: file.after.split(/\r?\n/)[line] }] : [] }
   if (options.vote) data = await options.vote(task, snapshot, finding, data)
  } else {
   const line = task.prompt.split('\n').find(line => line.startsWith('Confirmed candidates: '))
   data = { orderedIds: JSON.parse(line.slice('Confirmed candidates: '.length)).map(f => f.id), summary: 'Verified findings are retained; no human approval is granted.', needsHuman: false }
  }
  return { ok: true, output: JSON.stringify({ ...envelope, ...data }) }
 } }
}
export function tools(root, config = {}, options = {}) {
 const map = new Map(buildReviewTools(resolveConfig({ stateDir: '.dsh-review', ...config }), options).map(t => [t.name,t]))
 const context = { agent: { id: 'fixture-parent', session: { header: { cwd: root } } } }
 const call = (name, args = {}, extra = {}) => map.get(name).execute(args, { ...context, ...extra })
 return { call, map, context }
}
export const ids = run => ({ runId: run.runId, targetId: run.targetId })
