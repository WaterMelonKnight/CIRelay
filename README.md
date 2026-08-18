# CIRelay

**CI feedback infrastructure for coding agents.**

CIRelay gives an external coding agent provider-neutral, structured evidence about CI failures. It resolves GitHub Actions runs from a pull request, commit, or branch; retrieves failed jobs and logs; and reduces noisy logs into `FailureContext`. Extraction is deterministic and framework-aware, while `search_job_logs` lets an agent test its own hypotheses. Repository policy can live in [`.cirelay.yml`](docs/configuration.md).

CIRelay is infrastructure—not a generic log platform, autonomous coding agent, LLM wrapper, or hosted service.

## How CIRelay runs today

```text
Coding agent
    |
    | stdio MCP
    v
CIRelay MCP process
    |
    | GitHub API
    v
GitHub Actions
```

The MCP process runs locally, in the same development environment or sandbox as the coding agent: for example, a developer laptop, Codespace, dev container, or cloud coding-agent sandbox with GitHub API network access. GitHub Actions is currently the only implemented provider. A hosted or remote deployment model is future work.

## Source-checkout quick start

CIRelay requires **Node.js 22 or newer**, as declared by the workspace engines configuration. Corepack supplies the pinned pnpm version.

```sh
git clone https://github.com/WaterMelonKnight/CIRelay.git
cd CIRelay
corepack enable
pnpm install --frozen-lockfile
pnpm build
export GITHUB_TOKEN='<your-token>'
node packages/mcp/dist/main.js
```

The final command starts the stdio MCP server and waits for an MCP client; it is not an interactive shell. The intended package UX after publication is `npx @cirelay/mcp`, but no package has been published by this repository yet.

### GitHub token permissions

Prefer a fine-grained personal access token limited to the repositories CIRelay may inspect. Set it only through the `GITHUB_TOKEN` environment variable; never commit it. Grant these repository permissions:

- **Actions: read** for workflow runs, jobs, and logs;
- **Pull requests: read** for PR metadata and changed-file context;
- **Contents: read** to load `.cirelay.yml` from the resolved commit.

See the [GitHub provider guide](docs/providers/github.md) for details and troubleshooting.

## Connect an MCP client

A generic stdio MCP configuration for a built source checkout is:

```json
{
  "mcpServers": {
    "cirelay": {
      "command": "node",
      "args": ["/absolute/path/to/CIRelay/packages/mcp/dist/main.js"],
      "env": {
        "GITHUB_TOKEN": "<your-token>"
      }
    }
  }
}
```

Replace the absolute path and token placeholder. An absolute path avoids relying on client-specific working-directory support. Configuration shape and location vary by MCP client, so consult the client's documentation.

## Investigate a failure

Ask the agent to “Investigate why PR #42 failed.” It can first call `get_failure_context` for broad deterministic extraction:

```json
{
  "owner": "acme",
  "repository": "payments",
  "pullRequestNumber": 42,
  "conclusion": "failure",
  "latest": true,
  "extractionProfile": "java-spring"
}
```

The profile is optional. A repository can select it automatically with a compact `.cirelay.yml` policy:

```yaml
version: 1
extractionProfile: java-spring

logExtraction:
  include:
    - 'connection refused'
  exclude:
    - 'Known harmless warning'
```

Keep configuration details in the [configuration reference](docs/configuration.md).

The agent can then drill into a failed job with repeated `search_job_logs` calls:

```json
{
  "owner": "acme",
  "repository": "payments",
  "jobId": "123456789",
  "patterns": ["postgres", "5432", "connection refused"],
  "sourcePolicy": "prefer-cache"
}
```

`get_failure_context` broadly extracts bounded evidence; `search_job_logs` searches for agent-directed literal patterns. With `prefer-cache`, repeated searches in the same MCP process can reuse its cached raw log.

## Dogfooding

CIRelay has been exercised against a real failed GitHub Actions run from this repository; see the [recorded smoke-test details](docs/providers/github.md#real-dogfood-result). CIRelay can reduce a failed job's raw CI log into structured evidence, then let an agent drill down with `search_job_logs`. This is deterministic evidence extraction, not automated semantic root-cause diagnosis.

## Current limitations

- GitHub Actions is the implemented CI provider, and MCP uses local stdio only.
- Raw-log caching is process-local and ephemeral.
- There is no hosted CIRelay service, GitHub App, webhook delivery, or persistent failure history yet.
- No LLM is required in the CIRelay core path.

Normal tests use fixtures and injected clients and require neither GitHub nor npm credentials. For architecture and query details, see [architecture](docs/architecture.md) and [run-query semantics](docs/run-queries.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
