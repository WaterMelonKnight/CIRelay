# CIRelay agent guide

CIRelay turns CI failures into provider-neutral context and can host a bounded CI Investigation Sub-Agent at the application boundary.

## Boundaries

- Dependency flow is provider adapter -> `@cirelay/core` <- transports and applications such as MCP, CLI, and `apps/strands-agent`.
- `packages/core` must remain deterministic and independent of GitHub, MCP, Strands, Bedrock, OpenAI-compatible providers, and every specific provider.
- Never introduce an LLM or model SDK into the core path.
- Agent orchestration, InvestigationState, hypotheses, termination, and structured diagnosis belong outside core; currently prefer `apps/strands-agent`.
- Keep tests network-independent by default; use fixtures, fake planners/models, and injected clients.
- Avoid overengineering. Prefer small, reviewable changes and explicit interfaces.
- Update `docs/architecture.md` when package or dependency boundaries change.

## Current agent direction

The first bounded sub-agent loop is:

`Task -> InvestigationState -> decide -> CIRelay tool -> observe -> update -> continue/stop/escalate -> StructuredDiagnosis`.

Phase 1 explicitly excludes A2A, Bedrock Multi-Agent Collaboration, Laya, automatic code edits, automatic PR creation, and a new Web UI.

## Commands

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before submitting changes. Use `pnpm format` to apply repository formatting.
