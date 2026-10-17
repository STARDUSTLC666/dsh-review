import type { LedgerState } from './ledger.js'
import { requiredApprovals } from './modes.js'
export function automatedVerdict(state: LedgerState, runId: string) {
 const run = state.runs[runId], reasons: string[] = []
 if (!run) return { ok: false, exitCode: 1, runId, reasons: ['Unknown review run'] }
 const record = state.heads[run.series]
 if (run.status !== 'complete' || run.stage !== 'done') reasons.push('Review did not complete: ' + run.status)
 if (!run.independent) reasons.push('External task submissions cannot prove independent execution')
 if (!run.risk) reasons.push('Missing independent risk classifications')
 if (run.unverified) reasons.push('Unverified findings: ' + run.unverified)
 if (run.target.files.some(f => f.binary)) reasons.push('Binary changes require a separate human/domain review; text review cannot certify their content')
 if (record?.latestRunId !== run.id || record.targetId !== run.targetId) reasons.push('This is not the latest review of the target')
 const open = Object.values(record?.posted ?? {}).filter(f => !f.disposition)
 if (open.length) reasons.push('Unresolved findings (including published nits/pre-existing): ' + open.length)
 return { ok: reasons.length === 0, exitCode: reasons.length ? 1 : 0, runId, targetId: run.targetId, head: run.head, reasons, open,
  requiredHumanApprovals: run.risk ? Math.min(2, requiredApprovals(run.risk.tier) + (run.risk.extraHuman ? 1 : 0)) : null,
  boundary: 'AI review layer only. Required CI checks and independent human approvals of this exact commit must be enforced separately. No merge approval is granted.' }
}
