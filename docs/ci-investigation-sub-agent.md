# CI Investigation Sub-Agent

CIRelay's next phase is a bounded CI investigation sub-agent, not merely a set
of MCP log tools.

## Current baseline

The existing repository already provides the sensing/tool layer:

- provider-neutral `CiProvider`, run resolution, raw-log source/cache,
  deterministic extraction, targeted literal search, and `FailureContext` in
  `packages/core`;
- `GitHubActionsProvider` as the first concrete CI adapter;
- MCP tools and shared handlers for run discovery, `FailureContext`, targeted
  log search, and raw-log fallback;
- an evidence-first policy: resolve run -> `get_failure_context` -> targeted
  search only when needed -> full log last;
- a Strands adapter with Bedrock as the AWS-oriented default and an explicit
  OpenAI-compatible model path used for the demonstrated DeepSeek E2E;
- unit tests for core extraction/cache/search/run resolution, MCP
  handlers/server behavior, and the Strands bridge/tool surface.

What is missing is an explicit investigation protocol around those
capabilities. The current Strands demo lets the model own an implicit tool loop,
but CIRelay does not yet retain a typed investigation state, hypotheses,
budgets, terminal status, or a structured diagnosis contract.

## Target loop

```text
Task
  -> InvestigationState
  -> decide next action
  -> CIRelay operation
  -> Observation
  -> update state
  -> continue | stop | escalate
  -> StructuredDiagnosis
```

The model should own semantic decisions and hypotheses. Deterministic code
should own state transitions, budgets, tool preconditions, evidence provenance,
and termination guardrails.

## InvestigationState

The first implementation keeps state in the Strands outer adapter so
`packages/core` remains model-neutral and provider-neutral.

State tracks:

- original task and repository;
- resolved run ID;
- whether `FailureContext` has been loaded;
- observed evidence accumulated from `FailureContext` and targeted search;
- hypotheses with explicit `open`, `supported`, or `rejected` status and
  evidence references;
- observations/tool history;
- tool-call and targeted-search budgets;
- active/stopped/escalated terminal status and reason.

Evidence is an observed fact. A hypothesis is an interpretation. They must
remain separate.

## Action contract

The phase-1 action vocabulary is deliberately small:

1. `list-runs` — required while no run is resolved;
2. `get-failure-context` — required once a run is known and before semantic
   diagnosis;
3. `search-job-logs` — optional targeted follow-up after `FailureContext`,
   with a known job and concrete literal patterns;
4. `stop` — emit a diagnosis only after `FailureContext` and at least one
   observed evidence item;
5. `escalate` — terminate when evidence is insufficient, a capability is
   missing, or budgets/errors prevent a grounded diagnosis.

Full raw-log retrieval is intentionally not part of the initial autonomous
loop. It remains available in the normal MCP product and can be added later as
an explicit high-cost escalation action if evals show it is necessary.

## Termination conditions

`stop` is valid only when the run is resolved, `FailureContext` has been
observed, and the state contains evidence supporting the diagnosis.

`escalate` is valid when the agent cannot produce a grounded diagnosis within
the bounded tool/search budget, encounters a missing capability or
unrecoverable tool error, or still has materially ambiguous hypotheses.

The controller must reject unbounded tool use and invalid orderings even if a
model requests them.

## Structured diagnosis contract

The next PR will wire the loop to a typed final output containing at minimum:

- outcome: diagnosed or escalated;
- concise summary;
- observed evidence references;
- supported/rejected hypotheses;
- confidence expressed as a bounded qualitative field rather than fabricated
  numeric probability;
- next action;
- escalation reason when applicable;
- investigation metadata such as run ID and tool/search counts.

## PR sequence

### PR 1 — state and transition contract

Add the explicit state/evidence/hypothesis/action types plus deterministic
transition validation and tests. No live model behavior changes yet.

### PR 2 — bounded Strands investigation loop

Wire the state contract to Strands. Add `search_job_logs` to the sub-agent
bridge/tool surface, make semantic next-action decisions explicit, apply
tool/search budgets, and return a structured diagnosis. Keep
Bedrock/OpenAI-compatible provider selection unchanged.

### PR 3 — minimum eval suite

Add sanitized fixture scenarios and trajectory assertions. The initial suite
should cover at least:

- obvious failure where `FailureContext` is sufficient and search is not
  called;
- ambiguous failure that requires one targeted search;
- misleading/skipped downstream checks that must not be called failures;
- no useful evidence -> escalation rather than hallucinated diagnosis;
- tool error or exhausted budget -> bounded escalation;
- repeated equivalent fixture -> stable evidence/trajectory invariants even if
  wording differs.

Measure tool selection/order, unnecessary search rate, grounded evidence
references, termination correctness, and diagnosis schema validity. This proves
more than a one-shot wrapper because the evaluated artifact is the multi-step
trajectory and state transition behavior, not only the final prose.

## Explicitly out of phase 1

- A2A;
- Bedrock Multi-Agent collaboration;
- Laya;
- automatic code edits;
- automatic commits or pull requests;
- a new Web UI.
