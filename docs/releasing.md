# Releasing CIRelay packages

The first public npm release is being prepared as version `0.1.0-alpha.1`. This document is a plan; repository CI does not publish and contributors do not need npm credentials.

## First alpha release checklist

1. Validate the latest `main` with `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format:check`.
2. Run `pnpm pack:check`. It verifies the isolated tarballs, including the shared prerelease version and exact internal dependency versions. Do not commit `.tgz` files.
3. From a clean, validated checkout and an authenticated maintainer environment, publish with the `alpha` dist-tag in dependency order:

   ```sh
   cd packages/core && npm publish --access public --tag alpha
   cd ../github && npm publish --access public --tag alpha
   cd ../mcp && npm publish --access public --tag alpha
   ```

   The order is required because `@cirelay/github` depends on `@cirelay/core`, while `@cirelay/mcp` depends on both packages. Always include `--tag alpha`: publishing this prerelease without it could incorrectly assign npm's default `latest` tag.

4. After all three packages are published, verify the intended user commands:

   ```sh
   npx @cirelay/mcp@alpha
   npx @cirelay/mcp@0.1.0-alpha.1
   ```

5. Only after publication is verified, create the corresponding Git tag and release notes according to maintainer policy.

Do not treat a successful pack check as publication. npm publication, Git tags, and GitHub Releases are deliberate maintainer actions outside normal CI.
