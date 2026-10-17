#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Ledger } from './ledger.js'
import { resolveConfig } from './config.js'
import { assertCurrent } from './run.js'
import { automatedVerdict } from './verdict.js'
import { git } from './exec.js'
import { parsePolicy, evaluatePullRequest } from './policy.js'
import { githubEvidence } from './github.js'
export async function main(argv = process.argv.slice(2)) {
 const args = new Map<string,string>(), flags = new Set<string>()
 for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ai-only') flags.add(argv[i])
  else if (['--run','--root','--state-dir'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--')) args.set(argv[i], argv[++i])
  else throw new Error('Usage: dsh-review-gate --run RUN_ID [--root PATH] [--state-dir DIR] [--ai-only]. Default requires a trusted GitHub pull_request event and GITHUB_TOKEN.')
 }
 const config = resolveConfig({ stateDir: args.get('--state-dir') ?? '@profile' }), root = realpathSync(args.get('--root') ?? process.cwd()), ledger = new Ledger(root, config.stateDir)
 const runId = args.get('--run'), run = runId ? ledger.snapshot().runs[runId] : undefined
 if (!run || run.target.root !== root) throw new Error('A native review run in this workspace is required')
 await assertCurrent(run, ledger, config)
 const automated = automatedVerdict(ledger.snapshot(), run.id)
 if (flags.has('--ai-only')) return { ...automated, scope: 'AI only; human approval and CI not checked' }
 if (!automated.ok) return automated
 if (run.target.kind !== 'commit') throw new Error('Pull-request gating requires a commit/base review, not a worktree or index review')
 if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_TOKEN) throw new Error('Missing trusted GitHub event/token. Use --ai-only only for a local AI-layer check.')
 const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), pr = event.pull_request, repository = event.repository?.full_name
 if (!pr || typeof repository !== 'string' || pr.head?.sha !== run.head || typeof pr.base?.sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(pr.base.sha)) throw new Error('Trusted PR event does not match the reviewed commit')
 // Always load owners' policy from the base commit, never the PR working files.
 const policyRead = await git(root, ['show','--no-ext-diff','--no-textconv',pr.base.sha + ':.github/dsh-review-policy.json'])
 if (!policyRead.ok) throw new Error('Missing trusted base-commit review policy')
 const mergeBase = await git(root, ['merge-base',pr.base.sha,run.head])
 if (!mergeBase.ok || mergeBase.stdout.trim() !== run.target.base) throw new Error('Review base differs from current PR base')
 const policy = parsePolicy(JSON.parse(policyRead.stdout)), evidence = await githubEvidence(repository, pr.number, process.env.GITHUB_TOKEN, run.head, pr.base.sha)
 const governance = evaluatePullRequest(policy, evidence, run.risk!)
 return { ...automated, ok: automated.ok && governance.ok, exitCode: governance.ok ? 0 : 1, reasons: [...automated.reasons,...governance.reasons], governance }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try { const result = await main(); process.stdout.write(JSON.stringify(result, null, 2) + '\n'); process.exitCode = result.ok ? 0 : 1 }
 catch (error) { process.stderr.write(JSON.stringify({ ok: false, exitCode: 1, error: error instanceof Error ? error.message : String(error) }) + '\n'); process.exitCode = 1 }
}
