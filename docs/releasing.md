# Releasing CIRelay packages

The next MCP-only release is `@cirelay/mcp@0.1.0-alpha.4`. Core and GitHub remain at `0.1.0-alpha.3`; the repository does not require lockstep versions.

## Alpha.3 MCP packaging postmortem

The alpha.3 MCP package was packed from an existing `dist/` directory. The package had no npm `prepack` lifecycle and TypeScript compilation did not clean removed outputs, while the smoke check packed whatever was already present. As a result, neither the missing compiled descriptions module nor the old inline descriptions and runtime version were caught before publication.

The MCP package now runs a clean build during `npm pack` and therefore during `npm publish`. Its generated build metadata takes the runtime version from `package.json` and records a hash of the current MCP TypeScript sources. `pnpm pack:check` inspects the actual npm tarball, verifies its descriptions, imports, version, executable, and source hash, and exercises a source-edit-without-rebuild regression probe.

## Alpha.1 packaging postmortem

`0.1.0-alpha.1` was published with pnpm `workspace:` dependency specifications still present in its npm manifests, which made external npm installation fail. `0.1.0-alpha.2` replaces those specifications with exact npm-compatible versions. Release checks must inspect artifacts produced by `npm pack`, which models the `npm publish` manifest behavior, rather than relying only on `pnpm pack` artifacts.

## Alpha.4 MCP release checklist

1. Validate the latest `main` with `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format:check`.
2. Run `pnpm pack:check`. It uses `npm pack`, which triggers the MCP clean build, and verifies the isolated tarballs. Do not commit `.tgz` files.
3. Independently create and inspect the release candidate, then remove it when finished:

   ```sh
   mkdir -p .artifacts
   npm pack ./packages/mcp --pack-destination .artifacts
   tar -tzf .artifacts/cirelay-mcp-0.1.0-alpha.4.tgz | grep 'package/dist/tool-descriptions.js'
   tar -xOzf .artifacts/cirelay-mcp-0.1.0-alpha.4.tgz package/dist/tool-descriptions.js | grep 'Primary diagnostic tool for CI failures'
   tar -xOzf .artifacts/cirelay-mcp-0.1.0-alpha.4.tgz package/dist/tool-descriptions.js | grep 'complete raw CI job log only as a final fallback'
   tar -xOzf .artifacts/cirelay-mcp-0.1.0-alpha.4.tgz package/dist/server.js | grep "from './tool-descriptions.js'"
   tar -xOzf .artifacts/cirelay-mcp-0.1.0-alpha.4.tgz package/dist/build-metadata.js | grep '0.1.0-alpha.4'
   ```

4. From a clean, validated checkout and an authenticated maintainer environment, publish only MCP with the `alpha` dist-tag:

   ```sh
   cd packages/mcp && npm publish --access public --tag alpha
   ```

   Always include `--tag alpha`: publishing this prerelease without it could incorrectly assign npm's default `latest` tag.

5. After publication, verify the intended user commands:

   ```sh
   npx @cirelay/mcp@alpha
   npx @cirelay/mcp@0.1.0-alpha.4
   ```

6. Only after publication is verified, create the corresponding Git tag and release notes according to maintainer policy.

Do not treat a successful pack check as publication. npm publication, Git tags, and GitHub Releases are deliberate maintainer actions outside normal CI.
