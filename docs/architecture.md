# Architecture

## Principles

CIRelay translates CI-provider information into a small neutral domain. Core performs deterministic extraction only: it does not know about GitHub or MCP and it never invokes a model. Adapters depend inward on core, while transports operate against `CiProvider`.

```mermaid
flowchart LR
  GH[GitHub Actions] --> GHP[GitHubActionsProvider]
  GHP --> P[CiProvider]
  P --> Core[CIRelay Core]
  Core --> FC[FailureContext]
  FC --> MCP[MCP stdio]
  FC --> CLI[CLI / future REST]
  WH[Future webhooks] --> EVT[CiFailureEvent] --> Core
```

## Packages

- `packages/core`: provider-neutral references, run/job/step models, `CiProvider`, evidence extraction, and `FailureContext` construction. Its only runtime dependency is Zod, reserved for neutral schemas as they evolve.
- `packages/github`: translates GitHub Actions API payloads to core types. Octokit and token authentication stop at this boundary.
- `packages/mcp`: official MCP SDK stdio transport and tool handlers. Handlers receive any `CiProvider`; only the executable chooses GitHub.
- `packages/cli`: deliberately small command entry point.
- `apps/webhook-server`: future push-mode boundary. M0 provides health behavior and provider-event parsing, but no signature verification or delivery endpoint.

## Run resolution and failure context

Core owns provider-neutral `CiRunQuery` validation, deterministic run ordering,
and selection. Providers expose only primitives: exact run lookup, filtered run
listing, and (optionally) pull-request reference lookup. For GitHub, PR lookup
produces a head SHA before Actions runs are listed; MCP merely transports the
neutral query. Detailed ordering and ambiguity rules are documented in
[CI run queries](run-queries.md).

`buildFailureContext` loads a neutral run and its jobs, selects failed jobs, collects their logs, and extracts error lines and stack-like candidates using deterministic patterns. It includes PR changed files when the provider supports them. This is evidence, not diagnosis.

Future fingerprinting, last-success comparison, historical matching, framework parsers, and diff correlation can enrich the structure without changing provider boundaries.

## Deliberate limitations

M0 requests only the first GitHub API page and exposes underlying API failures. Job-log responses vary across clients and redirects; the adapter supports text and byte responses but M1 should add integration tests and explicit error handling. The webhook server does not accept or authenticate events yet.
