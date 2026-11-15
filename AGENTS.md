# CIRelay agent guide

CIRelay turns CI failures into provider-neutral context for external coding agents. Its deterministic infrastructure also supports a bounded TypeScript CI investigation foundation.

## Boundaries

- Dependency flow is provider adapter -> `@cirelay/core` <- transports such as MCP and CLI.
- `packages/core` must remain independent of GitHub, MCP, DeepSeek Harness, and every specific provider.
- Investigation state, hypotheses and termination belong in `packages/agent`, outside core. The Python Strands application remains a separate hackathon demo. The foundation has no runtime tool loop or model SDK yet.
- Never introduce an LLM or model SDK into the core path.
- Keep tests network-independent by default; use fixtures and injected clients.
- Avoid overengineering. Prefer small, reviewable changes and explicit interfaces.
- Update `docs/architecture.md` when package or dependency boundaries change.

## Commands

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before submitting changes. Use `pnpm format` to apply repository formatting.
