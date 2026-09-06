# AWS Agents for Humans hackathon: Strands CI agent

This first hackathon integration adds one focused [Strands Agents SDK](https://strandsagents.com/) agent that turns a natural-language CI question into a CIRelay investigation. It is a thin consumer, not a change to CIRelay's CI intelligence.

## What is new and what is reused

**Pre-existing work:** CIRelay core, GitHub Actions provider, MCP server/tooling, deterministic failure extraction, and the evidence-first workflow existed before this hackathon submission.

**New hackathon work:** the Strands Agent, its two-tool CIRelay adapter, the CLI/demo flow, and this document. No AgentCore, hosted service, UI, or general execution tool is included.

```mermaid
flowchart TD
  U[User] --> A[Strands Agent]
  A --> T[list_ci_runs / get_failure_context]
  T --> B[thin Node subprocess bridge]
  B --> H[existing CIRelay handlers]
  H --> G[GitHub Actions provider]
  G --> GH[GitHub Actions]
```

## Setup and demo

Requirements are Node.js 22+, pnpm, Python 3.11+, AWS credentials available through the standard AWS credential chain, and a GitHub token with Actions read access.

```sh
pnpm install
pnpm build
python -m venv .venv
. .venv/bin/activate
python -m pip install -e './apps/strands-agent'
export GITHUB_TOKEN='<github-token>'
export AWS_REGION='us-east-1'
# Optional; this is the default Bedrock model:
export STRANDS_MODEL_ID='us.amazon.nova-pro-v1:0'
python -m cirelay_strands_agent \
  "Investigate the latest failed CI for WaterMelonKnight/CIRelay and tell me the root cause and what I should inspect next."
```

`GITHUB_TOKEN` is required. AWS authentication and `AWS_REGION` configure Bedrock; `STRANDS_MODEL_ID` is optional. Credentials are never passed as tool arguments or hardcoded.

## Expected workflow

The agent interprets the request, calls `list_ci_runs` to resolve a failed run, and calls `get_failure_context` with the resulting run ID. It stops when that bounded evidence is sufficient, clearly separates **Observed evidence** from **Agent inference**, and gives a concise next action. This first adapter intentionally exposes neither full-log retrieval nor shell/Python execution tools.
