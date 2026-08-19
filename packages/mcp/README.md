# @cirelay/mcp

The public alpha of CIRelay's local stdio MCP server for coding agents.

Run it directly from npm without cloning or building the repository:

```sh
npx -y @cirelay/mcp@alpha
```

The process waits for an MCP client on stdio, so normal usage is to configure a coding agent to spawn it. It requires Node.js 22 or newer and a user-provided `GITHUB_TOKEN`.

For Claude Code:

```sh
export GITHUB_TOKEN='<your-token>'
claude mcp add cirelay \
  -- npx -y @cirelay/mcp@alpha
claude
```

Export `GITHUB_TOKEN` in the same shell that launches Claude Code so CIRelay
inherits it. Do not pass an expanded secret through `claude mcp add --env` when
that would persist the value in Claude Code's MCP configuration. Use a
least-privilege token and never commit credentials to scripts or repository
files. See the
[CIRelay repository](https://github.com/WaterMelonKnight/CIRelay#readme) for
tools, workflow, permissions, limitations, and license information.
