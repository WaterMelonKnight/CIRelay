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
