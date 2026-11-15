# Roadmap

- **M0 — foundation:** monorepo, architecture, domain model, GitHub provider foundation, MCP stdio pull mode, and CI.
- **M1 — GitHub reliability:** real Actions run/job/log retrieval, token authentication guidance, pagination, rate limits, and error handling.
- **M2 — extraction:** stronger deterministic error/stack parsing, failure fingerprints, and changed-file correlation.
- **M3 — dogfooding:** CIRelay analyzes CIRelay's own failed CI in an end-to-end demo.
- **M4 — inbound events:** verified `workflow_run` and `workflow_job` webhooks.
- **M5 — GitHub App:** installation authentication and repository authorization.
- **M6 — delivery:** durable event delivery and agent wakeup adapters.
- **M7 — DeepSeek Harness:** native adapter/plugin without coupling core to the harness.
- **M8 — providers:** additional adapters such as GitLab CI, Jenkins, Buildkite, and CircleCI.

Each milestone should remain independently reviewable. Storage, queues, dashboards, or model-driven diagnosis should be justified by concrete requirements rather than added speculatively.

## Bounded CI investigation

The [TypeScript foundation](ci-investigation-sub-agent.md) in `packages/agent`
consolidates the state-design proposals from PR #28 and PR #29. It provides
immutable state, evidence provenance, hypothesis/diagnosis validation, tool-step
budgets, repetition protection, no-progress escalation and typed termination.
The Python Strands hackathon demo remains supported but is not the production
agent foundation.

Phase 2 adds the bounded TypeScript investigation loop with injected planner
and executor, existing CIRelay handlers, a per-investigation process-local log
cache and deterministic fixture tests. Next: richer scripted policy evals; model
adapters require a separate review after deterministic loop validation. Automatic edits/PR creation, A2A, UI and persistent storage remain
outside this phase.
