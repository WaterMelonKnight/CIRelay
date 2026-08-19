# CIRelay

**CI feedback infrastructure for AI coding agents.**

CIRelay turns CI and verification signals into structured, code-change-aware context that coding agents can consume through MCP. It provides agent-native CI context, structured failure evidence, and deterministic log reduction without putting a model in the core path.

CIRelay is a local stdio MCP server today, backed by a provider-neutral core. It is not a GitHub Actions replacement, a generic MCP wrapper, or merely a log reader.

## Quick Start

Run the public alpha directly from npm—no clone or build is required:

```sh
npx -y @cirelay/mcp@alpha
```

CIRelay currently communicates over stdio. When launched manually, it may appear to “hang” because it is waiting for an MCP client. In normal use, configure your coding agent to spawn CIRelay as its MCP subprocess rather than keeping it running in another terminal.

Node.js 22 or newer and a GitHub credential are required.

### Claude Code

Register CIRelay without storing a token in its MCP configuration. Export the
token in the same shell that launches Claude Code so the spawned CIRelay process
inherits it:

```sh
export GITHUB_TOKEN='<your-token>'
claude mcp add cirelay \
  -- npx -y @cirelay/mcp@alpha
claude
```

Verify the configuration with either command:

```sh
claude mcp list
claude mcp get cirelay
```

Then ask Claude Code:

> Use CIRelay to inspect the latest failed CI run for PR #42. Resolve the failed run, retrieve FailureContext, and search logs only if more evidence is needed.

Claude Code spawns CIRelay as a stdio subprocess. Do not pass an expanded
secret through `claude mcp add --env` when that would persist the value in
Claude Code's MCP configuration. See the shared [integration security
guidance](docs/integrations.md#security) for credential permissions and
handling.

## Agent integrations

CIRelay is coding-agent-neutral infrastructure: any coding agent that supports
local stdio MCP servers can use its standard MCP interface. Claude Code is the
primary, end-to-end dogfooded integration; the other compatible clients below
have documentation but have not yet been dogfooded with CIRelay.

| Agent                      | Transport       | Status                                  |
| -------------------------- | --------------- | --------------------------------------- |
| Claude Code                | stdio MCP       | Tested end-to-end                       |
| OpenCode                   | local/stdio MCP | Compatible, docs added                  |
| GitHub Copilot CLI         | local/stdio MCP | Compatible, docs added                  |
| GitHub Copilot cloud agent | local MCP       | Compatible with environment constraints |
| Codex CLI                  | MCP             | Documentation pending verification      |

See [Agent integrations](docs/integrations.md) for client configuration, the
client-neutral process model, status qualifications, and shared security
guidance. For the recommended agent workflow, see the canonical
[CI investigation skill](skills/cirelay-ci-investigation/SKILL.md). Future or
unverified clients are not presented as tested.

## Why CIRelay?

The traditional investigation path makes an agent retrieve raw CI logs, grep or read thousands of lines, and infer what matters. CIRelay makes the preferred path:

```text
Agent -> structured FailureContext -> targeted evidence -> optional deeper search
```

`FailureContext` contains bounded, deterministic evidence rather than an automated diagnosis. The coding agent remains responsible for interpreting that evidence. This design reduces irrelevant log material and lets the agent request a targeted search only when the initial context is insufficient.

## Real Claude Code dogfood

CIRelay has been connected successfully to Claude Code as an MCP server and exercised end to end against a real failed GitHub Actions run in this repository.

When asked **“Why did this CI run fail?”**, Claude Code used `list_ci_runs` and `get_failure_context`. CIRelay resolved the relevant run, identified the failed job and its failed `setup-node` step, returned the relevant error evidence, and showed that the downstream install, lint, typecheck, test, and build steps were skipped:

```text
Dependencies lock file is not found.
Supported file patterns: pnpm-lock.yaml
```

That structured evidence was sufficient for Claude Code to determine that the run had a CI setup/infrastructure failure caused by a missing `pnpm-lock.yaml`, rather than an application test failure. `search_job_logs` was not needed. CIRelay supplied deterministic evidence; the coding agent—not CIRelay—made the semantic classification.

## MCP tools

| Tool                  | When an agent should use it                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `get_ci_status`       | Check recent runs, optionally for a particular commit.                                             |
| `list_ci_runs`        | Resolve or explore runs by run ID, pull request, commit, branch, conclusion, or recency.           |
| `list_failed_jobs`    | Inspect the failed jobs for a known run.                                                           |
| `get_job_log`         | Retrieve a complete raw job log only when the investigation explicitly requires it.                |
| `get_failure_context` | Build structured, bounded failure evidence for one resolved run; prefer this before reading logs.  |
| `search_job_logs`     | Search a job for targeted literal patterns when `FailureContext` does not contain enough evidence. |

The intended workflow is:

1. Resolve or list the relevant run with `list_ci_runs` (or check status with `get_ci_status`).
2. Call `get_failure_context` to retrieve failed jobs, steps, and extracted evidence.
3. Call `search_job_logs` only if the structured context is insufficient. Fetch an entire log only as a last resort.

This core investigation policy is also reflected directly in the MCP tool descriptions, so compatible agents can follow it without installing the canonical skill.

See [CI run query semantics](docs/run-queries.md) and [configuration](docs/configuration.md) for detailed request behavior.

## Packages

The first public npm packages are available on the `alpha` prerelease line:

| Package           | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `@cirelay/core`   | Provider-neutral domain model and deterministic extraction.        |
| `@cirelay/github` | GitHub Actions provider adapter.                                   |
| `@cirelay/mcp`    | Local stdio MCP server for coding agents and the user entry point. |

To add the MCP package to a project instead of invoking it with `npx`:

```sh
npm install @cirelay/mcp@alpha
```

For most users, `npx -y @cirelay/mcp@alpha` is the simplest option.

## Architecture

```text
Claude Code / Codex / DeepSeek Harness / other coding agents
                            |
                            | stdio MCP
                            v
                       CIRelay MCP
                            |
                            v
                       CIRelay Core
                       /          \
          GitHub provider          deterministic extraction
                 |
                 v
          GitHub Actions API
```

`packages/core` remains provider-neutral: it does not depend on GitHub, MCP, a coding-agent harness, or an LLM/model SDK. Provider adapters translate CI data into core interfaces, while transports expose those interfaces to clients. See the detailed [architecture](docs/architecture.md).

## Alpha status and limitations

- CIRelay is alpha-quality software and its interfaces may change.
- GitHub Actions is the first and currently implemented CI provider.
- Local stdio MCP is the current deployment model; there is no hosted service.
- Authentication relies on user-provided GitHub credentials.
- Raw-log caching is process-local and ephemeral; there is no persistent history or fingerprint database yet.
- Webhook/event push delivery is not available yet.

### Planned direction

Future work may include failure fingerprints, similar historical failures, last-success comparison, code-change/diff correlation, webhook/event delivery, additional CI providers, and DeepSeek Harness integration. These are roadmap directions, not current features.

## Development

npm users do **not** need a source checkout or these contributor steps. To develop CIRelay itself, clone the repository and run:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm pack:check
```

Normal tests use fixtures and injected clients and require neither GitHub nor npm credentials.

## License

Apache-2.0. See [LICENSE](LICENSE).
