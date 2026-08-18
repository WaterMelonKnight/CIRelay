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
- an official-SDK MCP stdio server with `get_ci_status`, `list_failed_jobs`, `get_job_log`, and `get_failure_context`;
- a minimal CLI and webhook-server skeleton;
- fixture/mocked tests and project CI.

It does **not** contain an autonomous repair agent, LLM calls, a GitHub App, production webhook delivery, a DeepSeek Harness plugin, GitLab/Jenkins support, a database/event store, or a SaaS dashboard.

## Development

Requirements: Node.js 22+ and pnpm 10+.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

To start MCP after building, provide a GitHub token with read access to the target repository:

```sh
GITHUB_TOKEN=... pnpm --filter @cirelay/mcp exec cirelay-mcp
```

No credentials or network access are needed for tests. See [architecture](docs/architecture.md) and the [roadmap](docs/roadmap.md).

### Live GitHub Actions smoke test

An opt-in smoke test exercises the real GitHub adapter and MCP handlers against
historical failed CIRelay run `32023569355`. It retrieves the run, finds it via
`listRuns`, retrieves failed jobs and decoded logs, and builds a
`FailureContext` with log-derived evidence. It is deliberately separate from
the network-independent test suite and CI.

Build the workspace, then provide the token only through the environment:

```sh
pnpm build
GITHUB_TOKEN=... pnpm smoke:github
```

For a fine-grained personal access token, grant access to the target repository
with **Actions: read** and **Contents: read**. Also grant **Pull requests: read**
when validating a pull-request run, because failure-context construction reads
the PR's changed files when run metadata includes a PR. A classic token needs
the `repo` scope for private repositories (or `public_repo` for public
repositories). Organization policy or SSO authorization may impose additional
requirements.

The script never prints or persists the token. `CIRELAY_SMOKE_OWNER`,
`CIRELAY_SMOKE_REPO`, and `CIRELAY_SMOKE_RUN_ID` can override the dogfood target.

## Status

Milestone 0 is an executable foundation. GitHub run/job/log and PR-file endpoints are wired for a first-page implementation; robust pagination, API error translation, authentication guidance, and integration verification are deliberately scheduled for M1.

## License

Apache-2.0. See [LICENSE](LICENSE).
