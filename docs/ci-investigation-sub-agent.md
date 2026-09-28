# CIRelay CI Investigation Sub-Agent — Phase 1 design

CIRelay's next stage is a bounded **CI Investigation Sub-Agent**, not only a collection of MCP CI log tools.

The provider-neutral core remains deterministic infrastructure. Agent orchestration belongs at the application boundary, currently `apps/strands-agent`.

## Current main: what already exists

The current repository already has the hard evidence/data path:

- provider-neutral `CiProvider`, run/query types, `FailureContext`, deterministic extraction, raw-log cache, and targeted literal search in `@cirelay/core`;
- `GitHubActionsProvider` mapping GitHub Actions API responses into provider-neutral types and repository config;
- MCP handlers/tools for run resolution, status, failed jobs, `get_failure_context`, `search_job_logs`, and full log fallback;
- an evidence-first investigation policy: structured context first, targeted search second, full raw log last;
- a Strands adapter with Bedrock as the default model path and an explicit OpenAI-compatible path;
- a demonstrated Strands E2E using the existing `list_ci_runs -> get_failure_context` path;
- TypeScript core/provider/MCP tests, Python Strands adapter tests, docs, the investigation skill, and log fixtures.

The current Strands adapter is still prompt-driven rather than an explicit CIRelay-owned investigation state machine. It exposes only `list_ci_runs` and `get_failure_context`. It has no typed hypothesis ledger, no step budget, no explicit escalation state, no structured diagnosis contract enforced by application code, and no fixture eval of multi-step behavior.

There is also an implementation detail to fix before relying on cache reuse in the sub-agent loop: the current Python bridge launches a fresh Node process for each operation. Each process creates a new `CiToolHandlers`, so the process-local raw-log cache is not shared across separate Strands bridge calls even though the normal long-lived MCP server does share it.

## Minimal loop

Phase 1 targets this loop:

```text
Task
  -> InvestigationState
  -> decide exactly one next action
  -> execute one CIRelay operation
  -> observe
  -> normalize evidence
  -> update hypotheses / open questions / trace
  -> continue | stop | escalate
  -> StructuredDiagnosis
```

The model may propose the next action and semantic hypothesis, but application code owns the state, validates the action, enforces budgets, executes tools, records observations, and decides whether a proposed stop is admissible.

This separation is what makes the sub-agent more than a one-shot LLM wrapper.

## InvestigationState

The first state contract lives in `apps/strands-agent`, not `packages/core`.

It tracks:

- task and repository;
- phase: resolve run, collect evidence, test hypothesis, complete, or escalated;
- bounded step budget;
- selected run id;
- normalized evidence ledger;
- hypotheses with active/supported/refuted status;
- blocking open questions;
- action/observation trace;
- terminal reason;
- structured diagnosis when successful.

State transitions are explicit and testable. Completion requires observed evidence, at least one supported hypothesis, no blocking open question, and a diagnosis that cites known evidence ids.

## Evidence

The state-level evidence ledger does not replace `FailureContext.evidence`. It records the subset of observations that the investigation loop actually uses, with stable ids and provenance such as:

- run resolution;
- FailureContext;
- targeted log search;
- raw log fallback.

An evidence record preserves message, optional job id, line number, and category. Later PRs will add the normalization mapping from existing CIRelay tool responses.

## Hypothesis

A hypothesis is model-level interpretation, not provider fact.

It has:

- stable id;
- statement;
- status: active / supported / refuted;
- supporting evidence ids;
- contradicting evidence ids.

The loop should prefer one or a few falsifiable hypotheses over unconstrained chain-of-thought. The persisted state stores the conclusion and evidence links, not private model reasoning.

## Termination

Successful stop:

- the relevant run is resolved;
- observed evidence exists;
- at least one diagnosis hypothesis is supported;
- no blocking question remains;
- the diagnosis cites recorded evidence ids.

Escalation:

- step budget exhausted;
- no relevant failed run exists;
- CIRelay/tool error prevents progress;
- targeted investigation still leaves materially ambiguous causes;
- the required next capability is intentionally unsupported.

A stop is therefore an explicit state transition, not merely the model deciding to stop talking.

## StructuredDiagnosis

The minimal diagnosis contract contains:

- concise summary;
- observed evidence ids;
- agent inference;
- next developer action;
- confidence enum;
- limitations.

This preserves the existing Observed evidence / Agent inference boundary while making it machine-testable.

## PR sequence

### PR 1 — state and contracts

Add the explicit InvestigationState, Evidence, Hypothesis, action/observation trace, termination, and StructuredDiagnosis contracts plus network-independent state transition tests.

No runtime behavior changes yet.

### PR 2 — persistent CIRelay session + targeted search surface

Make the Strands bridge session-oriented so one investigation can reuse the same `CiToolHandlers` and raw-log cache. Expose `search_job_logs` to the sub-agent with bounded arguments. Keep full raw log as an explicit final fallback, not a default action.

### PR 3 — bounded investigation controller

Add the application-owned loop:

`decide -> validate -> execute -> observe -> update state -> continue/stop/escalate`.

The model produces structured decisions; the controller owns mutable progress and enforcement. Existing provider/model configuration is reused.

### PR 4 — minimal eval + CI wiring + docs

Add fixture-driven eval scenarios and run Python agent tests in GitHub CI. Measure behavior, not prose quality.

Minimum scenarios:

1. sufficient FailureContext -> stop without targeted search;
2. ambiguous FailureContext -> targeted search -> supported diagnosis;
3. no matching failed run -> escalate cleanly;
4. repeated ambiguity -> terminate at the step budget;
5. tool error -> typed escalation;
6. diagnosis may reference only evidence actually observed.

Useful metrics:

- task completion / correct escalation;
- evidence citation validity;
- unnecessary tool-call count;
- raw-log fallback rate;
- termination within budget;
- expected action trace.

A scripted/fake decision model should drive deterministic regression tests. A small optional live-model eval can be added separately, but network-dependent model calls should not be required for CI.

## Explicitly out of Phase 1

Do not add yet:

- A2A;
- Bedrock Multi-Agent Collaboration;
- Laya;
- automatic code edits;
- automatic PR creation;
- a new Web UI.

These are separate future layers. First prove that CIRelay can own one bounded, reproducible CI investigation loop.
