# DeepSeek Harness integration

**Status: standard-MCP integration path documented; Harness configuration
verification and runtime dogfood are pending.**

CIRelay is an agent-neutral local stdio MCP server. The intended integration is
for DeepSeek Harness to launch CIRelay as an MCP subprocess:

```text
DeepSeek Harness
      |
      | MCP client (local stdio process)
      v
@cirelay/mcp
      |
      v
CIRelay Core
      |
      v
GitHubActionsProvider
      |
      v
GitHub API
```

No hosted CIRelay service, DeepSeek SDK, or Harness-specific CIRelay package is
needed for this design.

## Verification boundary

The official DeepSeek Harness documentation and repository could not be
accessed from the environment used to prepare this guide. Consequently, this
guide does **not** claim that a particular Harness release supports local stdio
MCP, and it intentionally does not invent a configuration file name, location,
schema, CLI registration command, environment-injection syntax, automatic tool
discovery behavior, or native skill/plugin API.

Before dogfooding, check the official documentation for the installed Harness
version and confirm that it can launch a local MCP server over stdio. If it can,
translate the verified Harness configuration into this client-neutral process
definition:

```yaml
command: npx
args:
  - -y
  - '@cirelay/mcp@alpha'
environment:
  GITHUB_TOKEN: <inject securely; never commit a literal token>
```

The command Harness must spawn is:

```sh
npx -y @cirelay/mcp@alpha
```

Do not start it as a separate HTTP service. CIRelay communicates with its MCP
client through the subprocess's standard input and output.

## Runtime and credentials

The subprocess needs:

- Node.js 22 or newer.
- Outbound access to the GitHub API and npm access for the first `npx` install.
- `GITHUB_TOKEN` supplied securely to the subprocess.

Prefer inherited environment variables or Harness's documented secret or
environment injection facility. Do not put a token in a checked-in example or
configuration file. Use a least-privilege credential limited to repositories
CIRelay may inspect:

- **Actions: read** for runs, jobs, and logs.
- **Pull requests: read** when pull-request or diff context is needed.
- **Contents: read** for `.cirelay.yml`.

See the shared [integration security guidance](../integrations.md#security) and
[GitHub provider permissions](../providers/github.md#minimum-permissions).

After registration, use Harness's documented MCP inspection facility, if one
exists, to confirm that these tools are available:

- `get_ci_status`
- `list_ci_runs`
- `list_failed_jobs`
- `get_failure_context`
- `search_job_logs`
- `get_job_log`

## Investigation policy and skills

Keep three layers distinct:

1. **MCP capability:** CIRelay exposes read-only CI tools and evidence through
   the MCP process above.
2. **Canonical CIRelay policy:** the agent-neutral
   [`cirelay-ci-investigation` skill](../../skills/cirelay-ci-investigation/SKILL.md)
   describes intent recognition, tool order, fallback rules, and the boundary
   between observed evidence and agent inference.
3. **Harness-native skills/plugins:** whether Harness can load `SKILL.md`
   directly, and the required installation location or manifest, could not be
   verified. Do not assume direct compatibility.

If the installed Harness version supports the same `SKILL.md` convention, use
the canonical file without changing its policy. Otherwise, a future lightweight
adapter should express that policy in Harness's documented instruction or skill
format and leave MCP execution in `@cirelay/mcp`. A native Cordis/Harness plugin
is deliberately outside this integration's current scope; any developer-preview
API should be treated as unstable until its official contract is verified.

## Manual dogfood scenario

Start Harness in the CIRelay repository with the MCP subprocess configured and
the credential available, then give it this natural request:

> 帮我看看 CIRelay 仓库最近一个失败的 CI 为什么挂了

Do not mention CIRelay or individual tools in the prompt. The test is meant to
measure automatic intent recognition and tool selection. Expected behavior:

1. Harness recognizes CI-investigation intent and selects CIRelay's MCP tools.
2. It resolves the relevant run, normally with `list_ci_runs`.
3. It calls `get_failure_context` as the primary diagnostic operation.
4. It stops retrieving CI data if that evidence is sufficient.
5. Only if needed, it calls `search_job_logs` with narrow literal patterns.
6. Only as a final fallback, it calls `get_job_log` for the relevant job.
7. It combines CI evidence with inspection of relevant repository files.
8. Its answer separates CIRelay-observed evidence from agent inference.

This document is configuration guidance, not evidence of a completed dogfood
run.

## Dogfood record

Complete this checklist after a real manual run; retain `no` answers and issues
so integration limitations remain visible.

- DeepSeek Harness version:
- CIRelay version:
- Agent/model:
- User prompt:
- CIRelay automatically selected: yes/no
- MCP tools called:
- Tool call order:
- Was `get_failure_context` used before raw logs: yes/no
- Was `search_job_logs` required: yes/no
- Was `get_job_log` required: yes/no
- Did the agent inspect repository files after receiving CI evidence: yes/no
- Final diagnosis:
- Evidence/inference boundary preserved: yes/no
- Issues encountered:

## Future work

After the MCP configuration and a real run are verified, future work may include
a native Harness plugin or preset if its API stabilizes, automatic installation
of CIRelay's canonical skill, a CI-event-to-agent wake-up workflow, failure
fingerprints, diff correlation, and historical failure context. These are
roadmap possibilities, not capabilities of the integration documented here.
