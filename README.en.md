# dsh-review

[中文](README.md)

Independent code review for DeepSeek Harness: find concrete defects, verify them separately, preserve evidence and disclose unfinished work. Inspired by [the Claude Code team's workflow](https://claude.dev/blog/solving-code-review-at-anthropic/).

Requires Git, Node.js 22.19+ or 24+, and the official DSH services for tools, subagents, permission presets and jobs. Runtime acceptance targets DSH 0.2.1-rc.1. Start the conversation at the Git repository root.

```bash
dsh plugin --profile web add @stardustlc/dsh-review
```

For Desktop, install into the profile Desktop actually uses, then start a new conversation. No credentials are copied or modified.

Use the scoped package name. The unscoped npm package `dsh-review` belongs to another author and is unrelated to this repository.

Ask DSH to review your current changes with `review_run`, or provide `base: "main"` for committed changes and `staged: true` for the index. Interrupted runs can resume with their `runId`.

| Mode | Fresh-context finders | Independent verification | Synthesis |
|---|---|---|---|
| quick | Correctness and security | One verifier per candidate | Deterministic filtering |
| standard | Correctness, state, compatibility, security | Three voters, two must agree | Deterministic filtering |
| deep | Same four lenses | Three voters, two must agree | Additional arbiter preserving confirmed findings |

Every mode includes two separate risk classifications. Sensitive changes cannot be downgraded. Forked author context is rejected.

Each run is bound to an immutable base, HEAD, source snapshot and nonce. Missing or malformed output, changed code, exhausted budgets and incomplete verification block the AI gate. Evidence must cite actual snapshot source; an asserted command transcript alone is insufficient.

Posted findings require a fix or reasoned disposition. Fixes clear only after independent re-verification. Reviews default to three completed rounds; round three limits new findings to the actual incremental edits while re-checking unresolved findings. New files remain eligible. Binary changes require separate review.

The ten tools are `review_diff`, `review_run`, `review_report`, `review_check`, `review_respond`, `review_status`, `review_gate`, `review_learn`, `review_issue` and `review_eval`. External task submissions cannot prove independent execution and never pass the automatic gate. No tool publishes GitHub feedback or grants a human approval.

Evidence commands go through the live caller's controlled host terminal, including permission and cancellation handling. Read-only sessions refuse command execution. On the official Windows preset, controlled `pwsh` bridges to Git Bash when Bash is not exposed; Git Bash and PowerShell 7.3+ are required. There is no direct process fallback.

Default state is `DSH_HOME/plugins/dsh-review/<repository hash>/`. A workspace child directory can be configured explicitly. Corrupt ledgers fail closed; v1 evidence is backed up without inheriting old approvals.

Defaults: three rounds, incremental re-review after round two, 20 findings, two nits, severity floor `important`, 80 worker calls, concurrency three, ten-minute run timeout, two-minute command timeout, 4 MiB snapshot limit and the `spawn` backend. The legacy `evidenceRequired: false` setting cannot disable independent verification.

`dsh-review-gate` can combine the AI result with read-only GitHub evidence: successful required checks, resolved threads and current-commit human approvals. Trusted-author policy is loaded from the PR base commit, never its editable working files. Owners must separately enforce branch protection, CODEOWNERS, merge queues and release controls.

See [integration, migration and rollback](docs/INTEGRATION.md), [design and boundaries](docs/DESIGN.md), [validation](docs/VALIDATION.md) and [changelog](CHANGELOG.md). Evaluation uses curated defect matches, clean controls and separate coverage reporting; it does not claim production recall from synthetic tests.

Issues and PRs are welcome. Include reproducible inputs, versions and expected/actual behavior; redact secrets and private source. MIT License.

## Plugin updates

Requires DSH 0.2.1-rc.3 or newer. Update controls sit at the bottom of the existing workbench, or native plugin details for plugins without a workbench. Checks, release notes and preferences expand in place, with no separate update page or settings menu. Automatic checks are on by default; **automatic installation is off by default**. Only explicit opt-in permits compatible stable patches while idle with no unsaved changes. Preferences are independent, with per-plugin disable, deferral and ignore controls. No forced DSH restart or upgrade, and local-source installations stay unchanged. Suite components explain and operate on the whole Suite in the same footer.

Older releases need one manual update in native plugin management to acquire these controls. Publishing to npm does not replace an existing user installation.
