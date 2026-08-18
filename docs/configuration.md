# Repository configuration

CIRelay repositories may commit a canonical `.cirelay.yml` file (`.cirelay.yaml` is also recognized). Configuration is declarative, versioned, and treated as untrusted input. Version 1 supports only bounded literal rules—regular expressions, code execution, environment expansion, credentials, prompts, and provider-specific settings are intentionally unsupported.

```yaml
version: 1

extractionProfile: java-spring

logExtraction:
  include:
    - 'connection refused'
    - 'PAY-'
  exclude:
    - 'Known harmless warning'
  context:
    before: 3
    after: 6
  maxExcerptLines: 100
```

## Fields

- `version` must be `1`.
- `extractionProfile` may be `generic`, `java-maven`, `java-spring`, or `node-pnpm`.
- `logExtraction.include` adds literal-matching lines as automatic evidence.
- `logExtraction.exclude` suppresses literal-matching candidate evidence lines. It does not rewrite raw logs or discard unrelated context lines.
- `logExtraction.context.before` and `.after` control the lines surrounding each automatic evidence candidate.
- `logExtraction.maxExcerptLines` caps the combined excerpt.

Pattern lists, pattern lengths, context windows, and excerpt sizes have strict bounds. An absent file is normal and preserves CIRelay's generic defaults. An existing malformed or unsupported file produces a typed configuration error rather than being silently ignored.

## Resolution and precedence

For failure context, CIRelay reads repository configuration at the resolved CI run's `run.commit.sha`. It does not fall back to the latest default-branch configuration, so the policy and CI evidence come from the same revision.

Effective extraction settings follow this precedence, from lowest to highest:

1. built-in defaults;
2. repository `.cirelay.yml`;
3. explicit `get_failure_context` invocation options.

An explicit extraction profile replaces the repository profile; profiles are not merged. Log `sourcePolicy` remains an invocation concern and is not configurable in the repository file.

`search_job_logs` stays separate: its literal patterns are ephemeral, call-scoped agent hypotheses. Repository include and exclude rules affect only automatic failure-context extraction and are not injected into runtime searches.
