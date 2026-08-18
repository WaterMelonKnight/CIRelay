# Provider documentation

CIRelay keeps provider-specific setup here so that the root README can stay focused
on the shortest path to a working installation.

## Available guides

- [GitHub Actions](github.md) — the currently implemented CI provider.

GitLab CI, Jenkins, Buildkite, and CircleCI are possible future providers, not
implemented integrations.

## Convention for provider guides

Each future provider guide should use the following sections, in this order:

1. **Supported capabilities** — what CIRelay can retrieve or construct now, with
   future work clearly separated.
2. **Authentication method** — the credential type and how CIRelay receives it.
3. **Minimum permissions** — required scopes and separately labeled optional or
   recommended permissions.
4. **Configuration variables** — every supported environment variable or setting,
   including defaults where applicable.
5. **Quick verification command** — the smallest real-provider check and its exact
   scope.
6. **Security notes** — safe credential storage, scoping, expiration, logging, and
   rotation guidance.
7. **Troubleshooting** — common errors with specific checks and remedies.
8. **Known limitations** — current constraints without implying roadmap features
   already exist.

Guides should use placeholders instead of credentials, avoid duplicating general
architecture documentation, and never promise support that is not present in the
codebase.
