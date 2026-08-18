# CI provider guides

Provider setup belongs in this directory so that the root README can stay a short, neutral entry
point. [GitHub Actions](github.md) is CIRelay's first supported provider. GitLab CI, Jenkins,
Buildkite, and CircleCI guides should be added here when those integrations exist; their mention
here is a documentation convention, not a claim of current support.

## Guide convention

Every provider guide should use the same discoverable sections:

1. Supported capabilities
2. Authentication method
3. Minimum permissions
4. Configuration variables
5. Quick verification command
6. Security notes
7. Troubleshooting
8. Known limitations

Keep the quick path first, distinguish required permissions from optional ones, use fake values in
all examples, and link to the provider's authoritative authentication and permission documentation.
Provider-specific details stay in the provider guide rather than accumulating in the root README.
