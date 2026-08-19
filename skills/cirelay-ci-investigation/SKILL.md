---
name: cirelay-ci-investigation
description: Investigate and fix CI failures with CIRelay MCP tools while preserving evidence provenance and minimizing log retrieval. Use when a user asks why a PR, commit, branch, workflow, run, or job failed; whether a PR passed validation; about failed GitHub Actions, builds, tests, lint, typechecks, or CI regressions; to find a relevant CI error; or to inspect CI evidence before changing code. Do not require the user to name CIRelay explicitly. CIRelay MCP tools must be available to the agent.
---

# Investigate CI failures with CIRelay

Use CIRelay as the deterministic evidence source and perform semantic diagnosis yourself. Installation and client configuration are outside this skill; see `docs/integrations.md` in the CIRelay repository.

## Follow the investigation sequence

1. Identify the repository and any PR, commit, branch, workflow, or run information already available. Do not ask for an identifier that can be resolved from context.
2. Resolve the relevant CI run. Prefer `list_ci_runs` to select by PR, commit, branch, conclusion, or recency. Use `get_ci_status` when a quick status check or recent state is sufficient.
3. Call `get_failure_context` for the resolved run as the primary diagnostic operation.
4. Inspect the returned failed jobs and steps, extracted evidence, error lines, stack-trace candidates, and changed files when available.
5. Decide whether that structured evidence supports an explanation. Stop retrieving CI data when it does.
6. If evidence is insufficient or ambiguous, call `search_job_logs` with narrow literal patterns derived from observed evidence or a specific hypothesis. Refine the hypothesis rather than searching broadly.
7. Only if targeted search remains insufficient, retrieve the complete relevant job log with `get_job_log`.
8. Explain the observed evidence and the inferred root cause separately. State uncertainty when the evidence does not support one conclusion.

Use this retrieval order:

```text
FailureContext -> targeted log search -> complete raw job log
```

Do not begin with a complete log, grep everything, and manually reconstruct context.

## Select tools deliberately

- **`get_ci_status`**: Check CI state quickly, optionally for a particular commit. Prefer it for pass/fail or recent-status questions that do not yet require diagnosis.
- **`list_ci_runs`**: Resolve or explore runs by PR, commit, branch, conclusion, or recency. Use it when the relevant run is not already unambiguous.
- **`list_failed_jobs`**: Retrieve job-level failure information when the run is known and FailureContext is unnecessary for the user's limited question.
- **`get_failure_context`**: Use as the primary investigation tool. Prefer its bounded structured evidence before any raw-log retrieval.
- **`search_job_logs`**: Use only for targeted follow-up when FailureContext is insufficient. Build narrow literal patterns from current evidence or hypotheses; avoid broad patterns where possible.
- **`get_job_log`**: Fetch the full raw log only as the final fallback for the relevant job. Never fetch it by default.

For a simple validation question, report the resolved status and stop. For a failure investigation, do not stop at a failed conclusion when FailureContext can supply the evidence needed to explain it.

## Preserve evidence provenance

Label or phrase conclusions so the source is clear:

- **Observed evidence from CIRelay:** concrete run/job/step states, extracted lines, stack-trace candidates, skipped steps, and changed files returned by a tool.
- **Agent interpretation:** the likely failure class, causal relationship, root cause, and proposed remedy inferred from that evidence.

For example:

```text
Observed: `setup-node` failed because the lockfile was not found; downstream tests were skipped.
Inference: This is likely a CI setup failure rather than an application-test failure.
```

Never attribute a semantic classification to CIRelay unless a future runtime response explicitly contains that classification. Treat categories such as CI/setup/infrastructure, dependency/install, compile/typecheck, lint/static analysis, unit/integration test, application startup or Spring ApplicationContext, package-manager failure, and timeout/cancellation only as reasoning aids.

Prefer evidence-backed conclusions. If multiple causes remain plausible, say what is ambiguous and run one targeted search that can discriminate between them rather than guessing.

## Fix only what the evidence justifies

When the user asks to fix the failure:

1. Complete the evidence-first investigation before editing code.
2. Identify the evidence-supported likely cause and inspect the relevant repository code or configuration.
3. Make the smallest justified change; do not modify unrelated code merely because CI failed.
4. If the failure happened before project code executed, say so before proposing any application-code change.
5. Run applicable local validation when possible.
6. If a new CI run becomes available, resolve and inspect it again with CIRelay. Report whether it validates the fix; otherwise distinguish local validation from remote CI confirmation.

## Apply stop and fallback rules

- Stop after a status tool when the user only asks whether validation passed and the relevant status is conclusive.
- Stop after `get_failure_context` when its evidence supports the explanation.
- Use targeted search only to answer a concrete unresolved question.
- Fetch a complete job log only after structured context and targeted search fail to provide sufficient evidence.
- Do not claim certainty, modify code, or expand retrieval when the available evidence does not justify it.

## Use the dogfood pattern

For “Why did this CI run fail?”, the agent used:

```text
list_ci_runs -> get_failure_context
```

CIRelay evidence showed a failed `setup-node` step, a missing `pnpm-lock.yaml`, and skipped install, lint, typecheck, test, and build steps. That evidence was sufficient, so the agent did not search or fetch full logs. The agent—not CIRelay—semantically classified the result as a CI setup failure.

## Accommodate future evidence

Keep run resolution, structured diagnosis, targeted follow-up, and provenance as separate decisions so additional evidence sources can be inserted later. Failure fingerprints, historical comparisons, last-success comparison, and richer diff correlation are future capabilities, not tools or evidence currently available in this workflow.
