# CIRelay agent guide

CIRelay turns CI failures into provider-neutral context for external coding agents. It is infrastructure, not an autonomous agent.

## Boundaries

- Dependency flow is provider adapter -> `@cirelay/core` <- transports such as MCP and CLI.
- `packages/core` must remain independent of GitHub, MCP, DeepSeek Harness, and every specific provider.
- Never introduce an LLM or model SDK into the core path.
- Keep tests network-independent by default; use fixtures and injected clients.
- Avoid overengineering. Prefer small, reviewable changes and explicit interfaces.
- Update `docs/architecture.md` when package or dependency boundaries change.

## Commands

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before submitting changes. Use `pnpm format` to apply repository formatting.
