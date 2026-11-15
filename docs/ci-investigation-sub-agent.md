# TypeScript CI Investigation Sub-Agent foundation

`packages/agent` (`@cirelay/agent`, private) is the model-independent state
foundation for a future bounded CI investigator. This phase has no planner,
executor, model SDK, or running agent loop. The existing public alpha and Python
Strands hackathon demo retain their APIs and execution paths.

## Consolidating the earlier proposals

Reviewed the complete diffs of [PR #28](https://github.com/WaterMelonKnight/CIRelay/pull/28)
and [PR #29](https://github.com/WaterMelonKnight/CIRelay/pull/29), against main at
`60fc14989b00d1a35dcb232bfa6c2f08128b9bcb`. Neither proposal is merged or modified.
Their Python state implementations are superseded by this TypeScript direction;
their design work remains useful.

| Area                  | PR #28                                                                                                    | PR #29                                                                                              | Consolidated foundation                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State and transitions | Mutable state, observation reducer, explicit history                                                      | Frozen dataclasses, separate selection/evidence/step functions                                      | Deeply frozen snapshots, atomic action/observation transitions                                                                                                             |
| Evidence              | IDs, source, message, optional job/line/category; duplicate IDs silently ignored                          | Similar ledger; same ID overwrites observed facts                                                   | Immutable facts with provider/run/job/line provenance; conflicting IDs rejected; duplicate content retains canonical ID                                                    |
| Hypotheses            | Open/supported/rejected, support and contradiction references; unvalidated replacement                    | Active/supported/refuted, stable-ID upsert; references unvalidated                                  | Open/supported/rejected; known, unique, disjoint references; supported/rejected require corresponding evidence                                                             |
| Guards                | Canonical argument signature, consecutive repeated-action and no-progress checks; caller must invoke them | Step budget and remaining-step properties; no repetition/no-progress guard                          | Pre-dispatch budget and whole-history repetition enforcement; observation-level no-progress escalation                                                                     |
| Termination           | Free-form reasons; completion allowed without evidence; terminal markers can be overwritten               | Typed reasons; terminal updates blocked; evidence/support/questions gate completion                 | Typed reasons; terminal state immutable; completion requires selected run and one unambiguous cited hypothesis                                                             |
| Diagnosis             | Terminal status, task/repository/run, full evidence and hypotheses, reason/next action                    | Summary, evidence IDs, inference, next action, confidence, limitations; known diagnosis IDs checked | Terminal result preserves evidence/hypotheses/questions and typed reason; successful diagnosis cites selected hypothesis and evidence, with separate inference/limitations |
| Tests                 | 10 tests: state/history, signatures, no-progress/repeat/budget, terminal output                           | 5 tests: progression/upsert, completion gate, budget, terminal escalation                           | Network-independent Vitest coverage of both plus provenance, atomic rejection, correlation, immutability, reference failures and tool errors                               |
| Documentation         | Detailed staged loop, planner/executor boundaries and eval scenarios                                      | Blocking questions, session/cache lifetime caveat, CI/eval sequencing                               | TypeScript foundation now; bounded tool loop next; Python demo remains separate                                                                                            |

Retain #28's observation/history contract, stable signatures, explicit terminal
output, and progress guards. Retain #29's immutable transitions, blocking
questions, typed termination, evidence-linked diagnosis and limitations. Do not
retain mutable observation facts, unenforced guard helpers, unchecked hypothesis
links, or permissive completion. Confidence labels are deferred: reference
validity is enforceable here, calibrated semantic confidence is not.

## Contracts and transitions

Dependency direction is `@cirelay/agent -> @cirelay/core` (shared type imports).
Core does not depend on agent. `RepositoryRef`, `CiRunQuery`, search query fields,
failure-context options and evidence categories reuse core contracts. Evidence
normalization will consume existing extraction/search results; this package does
not parse logs or duplicate tool handlers.

```text
createInvestigation(task, repository, limits)
  -> applyAction(list_ci_runs) -> pending
  -> applyObservation(matching actionId, resolvedRunId)
  -> applyAction(get_failure_context) -> pending
  -> applyObservation(matching actionId, evidence)
  -> reviseHypotheses(hypotheses, blockingQuestions)
  -> applyAction(stop + diagnosis | escalate + reason)
  -> buildStructuredDiagnosis(terminalState)
```

Only the pending action may receive an observation. Dispatch another action only
after committing its observation. A future executor must use the pending action
and ID returned by the state machine, never the original unvalidated proposal.
Executor failures are observations with `error` and no evidence/run resolution;
they consume the pending step and escalate as `tool-error`.

Run resolution is pinned once selected. Context must precede targeted search;
search evidence must cite the requested job. Every evidence item identifies its
provider and selected run, with optional job, URL and positive log line. It must
have the source appropriate to the observing action. Line numbers require jobs.
Facts and hypotheses remain separate. IDs are stable: conflicting reuse fails
atomically. Exact content/provenance duplicates (excluding ID) retain the first
ID; duplicate aliases are discarded and cannot be cited. Different sources or
locations remain distinct observations. New IDs alone cannot create progress.

Defaults are 8 tool steps, 2 consecutive no-progress observations, and 2 executions
of an identical action signature across the whole investigation. Limits must be
positive safe integers. Signatures sort object keys and retain array order;
they represent exact typed requests, not semantic equivalence of different
search patterns. Merely rewriting hypotheses/questions never resets progress.
New evidence or initial run resolution does. A no-progress limit automatically
escalates when the observation is committed. A repeated request or exhausted
budget escalates **before dispatch**. The final budgeted observation may still
support a successful stop; attempting another tool action exhausts the budget.
Stop/escalate decisions do not consume tool steps. History length plus an optional
pending action determines consumed/reserved steps; no independent mutable step
counter can drift.

Completion requires a selected run, observed evidence, no blocking question, one
supported non-rejected hypothesis, no contradictory citations on that hypothesis,
and a diagnosis citing its supporting evidence. An unresolved competing hypothesis
prevents completion. Reject alternatives with counterevidence or revise the
current hypothesis set explicitly before stopping. This is structural validation,
not a claim that code can prove the semantic truth of a model's inference.

Escalation reasons are `step-budget-exhausted`, `repeated-action`, `no-progress`,
`ambiguous-evidence`, `no-failed-run`, `tool-error`, and `unsupported-capability`.
Successful completion uses `sufficient-evidence`. Escalated results preserve all
observed evidence, hypotheses and questions without fabricating a successful
diagnosis. No transition can reopen or overwrite a terminal result.

The API accepts trusted TypeScript application contracts, not arbitrary model JSON
or restored state. Future model decisions require schema validation at that
boundary. Evidence summaries and errors may originate in untrusted CI logs; they
are data, never executable instructions. There is no state deserialization or
persistence API in this phase. State cloning/freezing protects snapshots from
caller mutation, not from a caller fabricating a different state object.

## Development and next phase

Build the workspace before checks because package type exports resolve to `dist`:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

The root Vitest configuration automatically includes `packages/agent` tests.
Python compatibility remains checked separately with
`.venv/bin/python -m pytest apps/strands-agent/tests` when the demo dependencies
are installed.

Next: implement a bounded TypeScript investigation tool loop with an injected
planner/executor and fixture normalizers for `list_ci_runs`, `get_failure_context`,
and `search_job_logs`. Reuse a single handler/log-source session per investigation
so raw-log cache lifetime spans actions. #29 correctly identifies that the Python
demo's fresh Node subprocess per operation does not share that cache. Keep the
existing evidence-first sequence; raw whole logs remain an explicit future
fallback, not a foundation action. Add scripted evals for sufficient context,
search disambiguation, persistent ambiguity, missing runs, tool errors and bounds
before considering a model adapter.

Excluded: automatic code edits or PR creation by the runtime agent, A2A,
multi-agent orchestration, UI, persistent storage, production credentials,
Agent SDKs, npm publication and releases.
