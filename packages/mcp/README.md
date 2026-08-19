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
  --env GITHUB_TOKEN=$GITHUB_TOKEN \
  -- npx -y @cirelay/mcp@alpha
```

Use a least-privilege token and never commit credentials to scripts or repository files. See the [CIRelay repository](https://github.com/WaterMelonKnight/CIRelay#readme) for tools, workflow, permissions, limitations, and license information.
