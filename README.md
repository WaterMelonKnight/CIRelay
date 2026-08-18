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

## Quick Start

Requirements: Node.js 22+ and pnpm 10+.

```sh
git clone https://github.com/WaterMelonKnight/CIRelay.git
cd CIRelay
pnpm install
pnpm build
```

Next, create a least-privilege GitHub fine-grained personal access token by following the
[GitHub Actions provider setup guide](docs/providers/github.md), expose it as
`GITHUB_TOKEN`, and verify the integration:

```sh
export GITHUB_TOKEN='<your-token>'
pnpm smoke:github
```

Then start the local stdio MCP server (configure your MCP client to run the same command and
pass `GITHUB_TOKEN` in its environment):

```sh
pnpm --filter @cirelay/mcp exec cirelay-mcp
```

The value above is a placeholder, never a token to copy. See the
[provider guides](docs/providers/README.md) for the repeatable onboarding structure that future
CI integrations will follow. No credentials or network access are needed for the normal test
suite. See [architecture](docs/architecture.md) and the [roadmap](docs/roadmap.md).

## Status

Milestone 0 is an executable foundation. GitHub run/job/log and PR-file endpoints are wired for
a first-page implementation; robust pagination and API error translation are later work.

## License

Apache-2.0. See [LICENSE](LICENSE).
