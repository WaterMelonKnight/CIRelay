# CIRelay

**CI feedback infrastructure for AI coding agents.**

CIRelay turns CI failures into structured context and events that AI coding agents can understand and act on. It collects provider data, normalizes runs and jobs, reduces noisy logs, and exposes deterministic evidence. CIRelay is not another autonomous agent and does not put an LLM in its core path.

## Interaction modes

**Pull mode (Milestone 0):** `Agent -> MCP -> CIRelay -> CI provider`

An agent asks CIRelay for CI status, failed jobs, logs, or a complete failure context through a local stdio MCP server.

**Push mode (future):** `CI provider -> webhook/event -> CIRelay -> agent adapter`

Provider events will become neutral failure events and contexts for later delivery. The webhook application currently only establishes this boundary and a health endpoint.

## Milestone 0

This repository contains a strict TypeScript pnpm workspace with:

- provider-neutral domain and failure-context construction in `@cirelay/core`;
- the first `CiProvider`, an Octokit-backed GitHub Actions adapter;
- an official-SDK MCP stdio server with `list_ci_runs`, `get_ci_status`, `list_failed_jobs`, `get_job_log`, and `get_failure_context`;
- a minimal CLI and webhook-server skeleton;
- fixture/mocked tests and project CI.

It does **not** contain an autonomous repair agent, LLM calls, a GitHub App, production webhook delivery, a DeepSeek Harness plugin, GitLab/Jenkins support, a database/event store, or a SaaS dashboard.

## Quick start

Requirements: Node.js 22+ and pnpm 10+.

```sh
git clone https://github.com/WaterMelonKnight/CIRelay.git
cd CIRelay
pnpm install
pnpm build
```

Create a fine-grained GitHub personal access token for only the repositories CIRelay
needs to inspect, then provide it through the environment. The value below is a
placeholder, not a real token.

```sh
export GITHUB_TOKEN='<your-token>'
pnpm smoke:github
pnpm --filter @cirelay/mcp exec cirelay-mcp
```

See the [GitHub Actions provider guide](docs/providers/github.md) for token setup,
least-privilege permissions, smoke-test overrides, security, and troubleshooting.
The [provider documentation index](docs/providers/README.md) defines the structure
future provider guides should follow.

## Real dogfood result

The live smoke test succeeded against historical failed GitHub Actions run
[`32023569355`](https://github.com/WaterMelonKnight/CIRelay/actions/runs/32023569355)
in this repository. It found one failed job and 21,145 characters of real CI log
were reduced into a small structured `FailureContext` containing four pieces of
`failed-step` and `error-line` evidence. This is evidence extraction, not a claim
of semantic root-cause diagnosis.

The smoke test targets exactly one repository and one explicit run ID; it does
not scan repositories or historical runs. Full output and verification details
are in the [GitHub Actions provider guide](docs/providers/github.md#real-dogfood-result).

## Status

Milestone 0 is an executable foundation. GitHub run/job/log and PR-file endpoints
are wired for a first-page implementation. No credentials or network access are
needed for the normal test suite. See the [architecture](docs/architecture.md)
and [run-query semantics](docs/run-queries.md). Queries may use a precise run ID
or agent-friendly PR, commit, and branch selectors, including the latest failed
matching run. Agents can explore matches with `list_ci_runs` or retrieve a
single structured result directly with `get_failure_context`; precise `runId`
calls remain supported.

## License

Apache-2.0. See [LICENSE](LICENSE).
