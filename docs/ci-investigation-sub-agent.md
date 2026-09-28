# CIRelay CI Investigation Sub-Agent

## Status

This document defines the next phase after the completed Strands hackathon E2E.

The target is no longer only “MCP tools that another coding agent may call.” The
target is a bounded CI investigation sub-agent with explicit state, iterative
evidence gathering, termination rules, and a structured diagnosis.

This phase deliberately excludes:

- A2A;
- Bedrock multi-agent collaboration;
- Laya;
- automatic code edits;
- automatic pull-request creation;
- a new Web UI.

The provider-neutral CIRelay core remains deterministic and model-free.

## What already exists

The current `main` already provides the lower layers needed by an investigation
agent:

- `packages/core`: provider-neutral `CiProvider`, run resolution, raw-log source
  policies/cache, deterministic extraction, targeted literal search, and
  `FailureContext`;
- `packages/github`: GitHub Actions implementation of the provider boundary;
- `packages/mcp`: six CI investigation tools and the canonical evidence-first
  retrieval semantics;
- `skills/cirelay-ci-investigation/SKILL.md`: the current investigation policy:
  resolve run -> FailureContext -> targeted search -> raw log only as fallback;
- `apps/strands-agent`: a real Strands adapter with Bedrock as the default model
  provider and an explicit OpenAI-compatible path used for the validated
  DeepSeek E2E.

The hackathon Strands adapter is intentionally thin. Its state currently lives
implicitly in model conversation context and its stop rule is primarily prompt
guidance. That is the main gap this phase addresses.

## Target loop

The minimum sub-agent loop is:

```text
Task
  -> InvestigationState
  -> decide next action
  -> execute one bounded CIRelay action
  -> Observation
  -> deterministic state update
  -> refresh hypotheses
  -> continue / stop / escalate
  -> StructuredDiagnosis
```

The model may choose among bounded actions, but the model does not own the
authoritative state or loop guardrails.

## State model

The first implementation introduces explicit contracts in
`apps/strands-agent/src/cirelay_strands_agent/investigation.py`.

### InvestigationState

The controller owns:

- original task;
- repository;
- phase;
- resolved run ID when known;
- normalized observed evidence;
- hypotheses;
- action/observation history;
- step count;
- consecutive no-progress count;
- completion reason or escalation reason.

### Evidence

Evidence represents observed facts only. The initial neutral form retains:

- stable evidence ID;
- source (`ci-run`, `failure-context`, or `log-search`);
- message;
- optional job ID;
- optional log line number;
- optional category.

It must not contain an unqualified semantic root-cause claim.

### Hypothesis

A hypothesis is agent interpretation and stays separate from evidence. It has:

- stable hypothesis ID;
- statement;
- status: `open`, `supported`, or `rejected`;
- supporting evidence IDs;
- contradicting evidence IDs.

A later planner may replace/refine hypotheses after each observation, but a
hypothesis never mutates the underlying evidence.

## Action model

The first bounded action vocabulary is:

- `list_ci_runs`;
- `get_failure_context`;
- `search_job_logs`;
- `stop`;
- `escalate`.

`get_job_log` is intentionally not part of the first sub-agent action vocabulary.
It can be introduced later as an explicit final-fallback action after the stateful
loop and evals demonstrate a need.

An action has a stable signature based on its kind and arguments. The controller
uses this to prevent an LLM from repeatedly issuing the same unproductive call.

## Observation and reducer

Tool payloads will be normalized into `InvestigationObservation` before state is
updated. The reducer is deterministic:

1. reject observations after a terminal state;
2. verify that the observation corresponds to the requested action;
3. deduplicate evidence by stable evidence ID;
4. update resolved run ID if the observation resolved it;
5. increment step count;
6. reset no-progress count when new evidence or a new run was discovered;
7. otherwise increment no-progress count;
8. append an auditable `ActionRecord`;
9. advance the phase.

The model cannot silently rewrite the action history or delete observed evidence.

## Termination conditions

Termination has two sources.

### Semantic stop/escalation

The planner may request:

- `stop`: evidence supports a bounded developer-facing diagnosis;
- `escalate`: evidence remains insufficient or ambiguous and the allowed
  investigation actions cannot resolve it.

The controller records the reason and emits a `StructuredDiagnosis`.

### Deterministic guardrails

Independent of the model, the controller stops/escalates when a hard limit is
reached. Initial defaults are:

- maximum 8 investigation steps;
- maximum 2 consecutive no-progress observations;
- maximum 2 consecutive executions of the same action signature before a third
  identical request is rejected/escalated.

These are initial safety defaults, not benchmark-derived optimal values. Evals
should validate or adjust them.

## StructuredDiagnosis

Terminal output preserves the evidence/inference boundary:

- status: completed or escalated;
- task and repository;
- resolved run ID;
- concise summary;
- observed evidence;
- hypotheses;
- explicit terminal reason;
- developer next action when appropriate.

The diagnosis is therefore a stateful investigation result, not only free-form
LLM prose.

## Planner boundary

The next implementation stage should introduce a small planner interface:

```text
plan(state) -> InvestigationDecision
```

The Strands-backed planner receives a compact serialization of the current state
and returns one typed decision. It does not invoke CIRelay tools directly.

This is the key architectural change from the hackathon adapter:

```text
hackathon:
Strands Agent owns tool loop implicitly

sub-agent:
controller owns state + loop
Strands planner proposes one bounded next decision
executor calls CIRelay
reducer owns state transition
```

The existing model-provider configuration (`bedrock` / `openai`) can be reused by
the planner adapter.

## Executor boundary

The executor maps typed actions to the existing CIRelay bridge/handlers.

Initial execution path:

```text
InvestigationAction
  -> Python executor
  -> Node bridge
  -> CiToolHandlers
  -> CIRelay core/provider
  -> raw result
  -> observation normalizer
```

The bridge must be extended to expose `search_job_logs`; the core/MCP search
implementation itself already exists and should not be duplicated in Python.

## Small-PR plan

### PR 1 — explicit state foundation

Scope:

- `InvestigationState`;
- `Evidence`;
- `Hypothesis`;
- action/observation contracts;
- deterministic reducer;
- loop guardrails;
- `StructuredDiagnosis`;
- network-independent unit tests.

No change to the existing hackathon runtime path.

### PR 2 — bounded executor + targeted search

Scope:

- add `search_job_logs` to the Strands Node bridge;
- normalize `list_ci_runs`, `FailureContext`, and log-search results into
  observations/evidence;
- keep the same shared CIRelay handler semantics;
- test with fake bridge payloads.

No planner/model changes.

### PR 3 — explicit controller loop + Strands planner

Scope:

- `plan(state) -> decision`;
- bounded controller loop;
- typed stop/escalate decisions;
- reuse current Bedrock/OpenAI-compatible model construction;
- new CLI entrypoint/mode for the stateful investigator;
- keep the current evidence-first retrieval order.

### PR 4 — minimal eval suite + docs

Scope:

- deterministic scripted planner/fake-client evals;
- a small recorded fixture set;
- optional real E2E smoke against CIRelay itself;
- metrics and pass/fail thresholds;
- update README/architecture and retire the “hackathon-only thin wrapper” wording
  only after the stateful path is validated.

Each PR should remain independently reviewable.

## Minimum eval

The first eval should test behavior, not answer style.

Use a small set of fixed scenarios:

1. **FailureContext sufficient**
   - expected calls: `list_ci_runs -> get_failure_context -> stop`;
   - must not call search.

2. **Targeted search required**
   - FailureContext is intentionally ambiguous;
   - expected calls:
     `list_ci_runs -> get_failure_context -> search_job_logs -> stop`.

3. **Ambiguous after search**
   - search returns no discriminating evidence;
   - expected result: `escalate`, not a fabricated root cause.

4. **No-progress loop**
   - planner repeatedly proposes an identical/unproductive action;
   - controller must terminate through a guardrail.

5. **Evidence/inference separation**
   - every supported hypothesis must reference observed evidence IDs;
   - diagnosis must not promote a model-only statement into observed evidence.

6. **Boundedness**
   - total actions never exceed the configured step limit.

Initial useful metrics:

- correct terminal status;
- expected tool sequence;
- unnecessary-tool-call count;
- raw-log-call count (target: zero in phase one);
- evidence-backed hypothesis rate;
- max-step / no-progress guardrail compliance;
- deterministic replay success for scripted evals.

A model-based E2E can be added on top, but the scripted eval must pass first. That
is what demonstrates that the architecture is more than a one-shot LLM wrapper:
state transitions, action execution, and termination behavior are testable without
an LLM.
