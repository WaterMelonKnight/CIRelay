# Agent integrations

CIRelay exposes a standard local stdio MCP server. A coding agent that supports
local MCP servers can spawn CIRelay and use its tools; CIRelay is infrastructure
for coding agents rather than a plugin for one particular agent.

## Integration status

| Agent                      | Transport       | Status                                  |
| -------------------------- | --------------- | --------------------------------------- |
| Claude Code                | stdio MCP       | Tested end-to-end                       |
| OpenCode                   | local/stdio MCP | Compatible, docs added; not dogfooded   |
| GitHub Copilot CLI         | local/stdio MCP | Compatible, docs added; not dogfooded   |
| GitHub Copilot cloud agent | local MCP       | Compatible with environment constraints |
| Codex CLI                  | MCP             | Documentation pending verification      |

“Compatible” means that the client's documented local MCP process shape matches
CIRelay. It does not mean that the integration has completed the same real-run
dogfood test as Claude Code. Future clients and unverified configuration
interfaces are not documented as working integrations.

## Client-neutral stdio model

The essential MCP process configuration is:

```yaml
command: npx
args:
  - -y
  - '@cirelay/mcp@alpha'
environment:
  GITHUB_TOKEN: <inject securely through the client environment>
```

The MCP client should spawn this command and communicate with it over stdio.
Users normally do not manually start CIRelay in another terminal. CIRelay needs
Node.js 22 or newer, outbound access to the GitHub API, and a GitHub credential
in `GITHUB_TOKEN`.

## Claude Code

**Status: Tested end-to-end.**

Export the credential in the shell that starts Claude Code, then register the
command without copying the credential into Claude Code's MCP configuration:

```sh
export GITHUB_TOKEN='<your-token>'
claude mcp add cirelay \
  -- npx -y @cirelay/mcp@alpha
claude
```

Claude Code spawns CIRelay as a stdio subprocess, which inherits
`GITHUB_TOKEN` from that shell. Check the registration with `claude mcp list`
or `claude mcp get cirelay`. This setup has been dogfooded against a real failed
GitHub Actions run. See the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp)
for the client interface.

## OpenCode

**Status: Compatible configuration documented; not yet dogfooded.**

Add the local server to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cirelay": {
      "type": "local",
      "command": ["npx", "-y", "@cirelay/mcp@alpha"],
      "enabled": true,
      "environment": {
        "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"
      }
    }
  }
}
```

Export `GITHUB_TOKEN` before starting OpenCode; `{env:GITHUB_TOKEN}` uses
OpenCode's documented environment-variable substitution rather than storing the
credential in the file. OpenCode automatically exposes tools from configured
MCP servers to the model. See the official [OpenCode MCP server documentation](https://opencode.ai/docs/mcp-servers/)
and [configuration variables documentation](https://opencode.ai/docs/config/#variables).

## GitHub Copilot CLI

**Status: Compatible configuration documented; not yet dogfooded.**

Copilot CLI supports local/stdio MCP servers. In Copilot CLI's MCP configuration,
use GitHub's documented local-server shape:

```json
{
  "mcpServers": {
    "cirelay": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@cirelay/mcp@alpha"],
      "tools": [
        "get_ci_status",
        "list_ci_runs",
        "list_failed_jobs",
        "get_job_log",
        "get_failure_context",
        "search_job_logs"
      ]
    }
  }
}
```

Start Copilot CLI from an environment that already contains `GITHUB_TOKEN` so
the local subprocess inherits it. The `tools` list explicitly allowlists
CIRelay's read-only MCP tools; use only the tools you want enabled. Follow the
official [GitHub Copilot CLI MCP documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
for the current configuration location and management commands.

## GitHub Copilot cloud agent

**Status: Compatible with environment constraints; not yet dogfooded.**

GitHub Copilot's cloud coding agent supports repository-level MCP configuration
and local/stdio servers. Configure the same local process shape (`npx` with
`-y` and `@cirelay/mcp@alpha`) in the repository's Copilot coding-agent MCP
settings and explicitly allowlist the required CIRelay tools.

Unlike a process on a developer workstation, this deployment must make Node.js
22 or newer, outbound GitHub API access, and GitHub credentials available in the
agent environment. Store credentials in GitHub's **Copilot coding agent**
environment as Agents secrets or variables whose names begin with
`COPILOT_MCP_`, then map the name to `GITHUB_TOKEN` in the MCP server's
environment configuration. Never put a literal token in repository MCP
configuration. See GitHub's official [MCP configuration and secret guidance for
Copilot coding agent](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-coding-agent-with-mcp).

## Codex CLI

Codex CLI integration is planned/documentation pending verification of the
current MCP configuration interface.

## Security

Use one least-privilege GitHub credential limited to repositories CIRelay may
inspect. Fine-grained credentials should grant:

- **Actions: read** for workflow runs, jobs, and logs.
- **Pull requests: read** when pull-request or diff context is needed.
- **Contents: read** so CIRelay can read `.cirelay.yml`.

Never commit GitHub tokens or embed literal secrets in checked-in MCP
configuration. Prefer each client's secret store, environment injection, or
environment-variable substitution mechanism. See the [GitHub provider guide](providers/github.md#minimum-permissions)
for authentication details.
