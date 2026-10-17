import { classifyRisk, requiredApprovals, type RiskTier } from './modes.js'
import { matchGlob } from './rules.js'
export interface ReviewPolicy {
 trustedAuthors: string[]
 trustedReviewers: string[]
 requiredChecks: Array<{ name: string; appSlug: string }>
 sensitivePaths: string[]
 alwaysTwoPaths: string[]
}
export interface PullRequestEvidence {
 head: string; author: { login: string; type: string }; paths: string[]; draft: boolean
 reviews: Array<{ id: number; user: { login: string; type: string } | null; state: string; commit_id: string; submitted_at: string | null }>
 checks: Array<{ id: number; name: string; head_sha: string; status: string; conclusion: string | null; app: { slug: string } | null }>
 unresolvedThreads: number
}
export function parsePolicy(raw: unknown): ReviewPolicy {
 const policy = raw as ReviewPolicy
 if (!policy || ['trustedAuthors','trustedReviewers','sensitivePaths','alwaysTwoPaths'].some(key => !Array.isArray((policy as any)[key]) || (policy as any)[key].some((s: unknown) => typeof s !== 'string' || !s.trim())) || !Array.isArray(policy.requiredChecks) || !policy.requiredChecks.length || policy.requiredChecks.some(c => !c || typeof c.name !== 'string' || !c.name.trim() || typeof c.appSlug !== 'string' || !/^[\w-]+$/.test(c.appSlug))) throw new Error('Invalid trusted review policy; explicit reviewers, check names and app slugs are required')
 return policy
}
export function evaluatePullRequest(policy: ReviewPolicy, evidence: PullRequestEvidence, risk: { tier: RiskTier; extraHuman: boolean }) {
 const reasons: string[] = [], staticRisk = classifyRisk(evidence.paths, policy.sensitivePaths)
 const levels = ['low','medium','high'] as const, tier = levels[Math.max(levels.indexOf(risk.tier), levels.indexOf(staticRisk.tier))]
 const trusted = evidence.author.type === 'User' && policy.trustedAuthors.some(a => a.toLowerCase() === evidence.author.login.toLowerCase())
 let required = Math.min(2, requiredApprovals(tier) + (risk.extraHuman ? 1 : 0))
 if (!trusted) required = Math.max(2, required)
 if (evidence.paths.some(file => file.startsWith('.github/workflows/') || policy.sensitivePaths.some(p => matchGlob(p, file)))) required = Math.max(1, required)
 if (evidence.paths.some(file => policy.alwaysTwoPaths.some(p => matchGlob(p, file)))) required = 2
 const latest = new Map<string, PullRequestEvidence['reviews'][number]>()
 for (const review of [...evidence.reviews].sort((a,b) => a.id - b.id)) {
  if (!review.user || review.user.type !== 'User' || /\[bot\]$/i.test(review.user.login) || !['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state)) continue
  latest.set(review.user.login.toLowerCase(), review)
 }
 const approved = [...latest.values()].filter(r => r.state === 'APPROVED' && r.commit_id === evidence.head && r.user!.login.toLowerCase() !== evidence.author.login.toLowerCase() && policy.trustedReviewers.some(user => user.toLowerCase() === r.user!.login.toLowerCase())).map(r => r.user!.login)
 if (approved.length < required) reasons.push('Exact-commit human approvals: ' + approved.length + '/' + required)
 if ([...latest.values()].some(r => r.state === 'CHANGES_REQUESTED')) reasons.push('A human request for changes is still open')
 if (!Number.isInteger(evidence.unresolvedThreads) || evidence.unresolvedThreads < 0 || evidence.unresolvedThreads > 0) reasons.push('Unresolved review threads: ' + evidence.unresolvedThreads)
 for (const check of policy.requiredChecks) {
  const runs = evidence.checks.filter(c => c.name === check.name && c.app?.slug === check.appSlug && c.head_sha === evidence.head).sort((a,b) => b.id - a.id)
  if (!runs[0] || runs[0].status !== 'completed' || runs[0].conclusion !== 'success') reasons.push('Required check not successful on current head: ' + check.name)
 }
 if (evidence.draft) reasons.push('Draft pull request')
 return { ok: reasons.length === 0, reasons, tier, trustedAuthor: trusted, requiredHumanApprovals: required, approvedHumans: approved,
  boundary: 'Read-only evidence check. Repository owners must enforce branch protection, CODEOWNERS, merge queue and release/rollback controls. This command neither approves nor merges.' }
}
