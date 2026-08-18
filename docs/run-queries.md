# CI run queries

CIRelay supports two selector levels. An explicit `runId` is the precise,
low-level path and continues to retrieve that run directly. Agent-friendly
queries can instead select runs for one commit, pull request, or branch, and can
filter by a provider-neutral conclusion or select the latest match.

## Semantics

`CiRunQuery` contains a repository and optionally `runId`, `commitSha`,
`pullRequestNumber`, `branch`, `conclusion`, `latest`, and `limit`.

- `runId` cannot be combined with a commit, pull-request, or branch selector.
- At most one of `commitSha`, `pullRequestNumber`, and `branch` may be used.
- Exact run lookup calls `getRun`; it does not list all repository runs.
- A pull-request query asks the provider for the neutral PR reference, then
  lists runs for its head SHA. For GitHub this uses the pull-request endpoint,
  rather than relying on optional workflow-run PR metadata.
- GitHub sends commit, branch, and conclusion filters to the Actions list-runs
  endpoint. Core also checks conclusions so provider implementations have
  consistent results.
- Results are deterministically ordered newest-first by `createdAt`, with
  `updatedAt` and run ID as tie-breakers. `latest: true` returns only the first
  matching run after that ordering.
- No matches, invalid selector combinations, unsupported PR resolution, and an
  ambiguous request for exactly one run produce `RunResolutionError` values
  with stable domain codes.

The MCP `list_ci_runs` tool exposes this query subset and returns neutral
`CiRun` values. Existing tools that accept an explicit run ID remain available.

## Agent flow

For “Analyze the latest failed CI for PR #42,” the flow is:

```text
PR #42
  -> provider-neutral PR head reference
  -> runs matching the head SHA and failure conclusion
  -> deterministic latest run
  -> FailureContext
```

Core provides `buildFailureContextForQuery` for this final composition while
keeping provider APIs and transports outside the core package.
