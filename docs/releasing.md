# Releasing CIRelay packages

The intended first public npm release is an alpha/pre-release (for example, `0.1.0-alpha.1`). This document is a plan; repository CI does not publish and contributors do not need npm credentials.

## Planned release checklist

1. Validate the latest `main` with `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format:check`.
2. Run `pnpm pack:check`. Inspect the isolated tarballs and packed manifests; do not commit `.tgz` files.
3. Version `@cirelay/core`, `@cirelay/github`, and `@cirelay/mcp` consistently with an alpha version, updating the lockfile and internal dependency ranges.
4. From a clean, validated checkout and an authenticated maintainer environment, publish the public packages in dependency order: core, GitHub adapter, then MCP. Never put an npm token in source or PR CI.
5. Verify installation and `npx @cirelay/mcp`, then create the corresponding Git tag and release notes according to maintainer policy.

Do not treat a successful pack check as publication. Publishing and creating a GitHub Release are deliberate maintainer actions outside normal CI.
