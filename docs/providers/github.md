# GitHub Actions provider setup

This guide configures CIRelay's current local/MCP **pull-mode** integration. CIRelay reads GitHub
Actions information on demand; normal use does not need write access.

## Supported capabilities

The GitHub adapter can read workflow runs, workflow jobs, job logs, and (when a workflow run is
associated with a pull request) changed files for that pull request. CIRelay turns these responses
into provider-neutral failure context and log-derived evidence.

## Authentication method

For local development and a local MCP server, prefer a
[fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token).
In GitHub's web interface, go to:

**Profile picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens
→ Generate new token**

Choose the user or organization that owns the target repository as the **Resource owner**. Under
**Repository access**, prefer **Only select repositories**, then select only the repository or
repositories that CIRelay must inspect. Choose a short expiration period that is practical for
your workflow.

Organization-owned repositories can be subject to organization approval, administrator token
policies, or SAML SSO authorization. If access is pending or blocked, ask the organization owner
which approval or authorization is required. GitHub documents the
[organization approval model](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)
and [SAML SSO authorization](https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on).

## Minimum permissions

Under **Repository permissions**, use read-only access:

| Permission        | Access | Why CIRelay uses it                                                                                                                                                                                                                                                 |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Actions**       | Read   | Retrieve workflow runs and jobs and download job logs. GitHub lists Actions (read) for the relevant [workflow-run](https://docs.github.com/en/rest/actions/workflow-runs) and [workflow-job](https://docs.github.com/en/rest/actions/workflow-jobs) endpoints.      |
| **Pull requests** | Read   | Retrieve changed files when a run is associated with a pull request. Omit this if PR changed-file analysis is not wanted. GitHub lists Pull requests (read) for [listing pull-request files](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files). |
| **Contents**      | Read   | Recommended as a conservative read-only repository baseline, but **not strictly required by the endpoints CIRelay currently calls**. Current run/job/log access is covered by Actions (read), and changed-file access by Pull requests (read).                      |

Fine-grained tokens also receive mandatory metadata access automatically. Do **not** grant write
permissions for normal CIRelay pull-mode usage. Start with the smallest repository set and the
permissions above, then expand scope only for a demonstrated need.

## Configuration variables

CIRelay reads the token from `GITHUB_TOKEN`:

```sh
export GITHUB_TOKEN='<your-token>'
```

`<your-token>` is deliberately a placeholder; replace it locally with the token GitHub shows once
after creation. Here, `GITHUB_TOKEN` is CIRelay's environment-variable name for that fine-grained
personal access token; it does not mean the automatic token available inside a GitHub Actions
workflow. For an interactive shell, reading the token without echoing it can avoid placing it
directly in shell history:

```sh
read -rsp 'GitHub token: ' GITHUB_TOKEN && echo
export GITHUB_TOKEN
```

Environment variables are preferable to repository configuration files. A process-specific form
also works, but may be retained in shell history on some systems:

```sh
GITHUB_TOKEN='<your-token>' pnpm smoke:github
```

When configuring an MCP client, set `GITHUB_TOKEN` through that client's environment/secret
configuration and use this command after building:

```sh
pnpm --filter @cirelay/mcp exec cirelay-mcp
```

Consult the MCP client's documentation for its environment syntax; do not paste the token into a
tracked project file.

## Quick verification command

The opt-in live smoke test uses the configured token and makes real GitHub API requests. It is not
part of the normal network-independent CI test suite.

```sh
pnpm build
pnpm smoke:github
```

By default it dogfoods `WaterMelonKnight/CIRelay` using historical failed workflow run
`32023569355`. To inspect another accessible failed run, override any of:

| Variable               | Purpose                          |
| ---------------------- | -------------------------------- |
| `CIRELAY_SMOKE_OWNER`  | Repository owner or organization |
| `CIRELAY_SMOKE_REPO`   | Repository name                  |
| `CIRELAY_SMOKE_RUN_ID` | Numeric workflow run ID          |

For example (all values are illustrative):

```sh
CIRELAY_SMOKE_OWNER=example-owner \
  CIRELAY_SMOKE_REPO=example-repository \
  CIRELAY_SMOKE_RUN_ID=123456789 \
  pnpm smoke:github
```

A successful run verifies workflow-run retrieval, failed-job retrieval, job-log download, log
decoding, `FailureContext` construction, and log-derived evidence extraction. Exact formatting can
evolve, but output has a shape similar to this example (the names and identifiers are fake):

```text
GitHub smoke test passed
repository: example-owner/example-repository
run: 123456789 (failure)
failed jobs: 1
downloaded log bytes: 2048
failure context: 1 failed job, 2 evidence items
```

## Security notes

- Never commit a token or put a real token in documentation, examples, issue text, or MCP
  configuration that will be tracked.
- Never print tokens in terminal or CI logs. Be cautious with shell history and command tracing.
- Prefer environment variables supplied by a local secret manager or a securely configured MCP
  client.
- Scope a token to only the repositories and read permissions CIRelay needs.
- Prefer short expiration periods where practical, and remove tokens that are no longer used.
- If a token is exposed, revoke it immediately in GitHub, create a replacement, and rotate it
  anywhere it was configured. GitHub provides guidance for
  [deleting tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#deleting-a-personal-access-token).

## Troubleshooting

### `GITHUB_TOKEN is required` or `GITHUB_TOKEN` is missing

Set and export `GITHUB_TOKEN` in the same environment that launches the smoke test or MCP server.
Check only whether it is present—do not print its value:

```sh
test -n "$GITHUB_TOKEN" && echo 'GITHUB_TOKEN is set'
```

### `401 Unauthorized`

The token is missing, malformed, revoked, or expired. Confirm that the launching process receives
the environment variable. If necessary, create a replacement token; do not log the old value.

### `403 Forbidden`

The token may lack Actions or Pull requests read access, the repository may not be included in its
selected repository scope, or an organization approval, SSO, administrator, or API policy may be
blocking access. Review the token's resource owner, selected repositories, permissions, and
organization status.

### `404 Not Found`

Confirm the owner, repository, and workflow run ID. GitHub can also return not-found when the token
cannot see a private repository or requested resource, so check repository selection and
organization access before assuming the run was deleted.

### PR changed files are empty or missing

The workflow run may not be associated with a pull request. If it is, confirm that the token has
**Pull requests: Read**; that permission may have been intentionally omitted when changed-file
analysis was not required.

## Known limitations

- GitHub Actions is currently CIRelay's only implemented CI provider.
- The adapter currently retrieves first-page results rather than exhaustively paginating every
  endpoint.
- PR changed files are available only when GitHub associates the workflow run with a pull request
  and the token can read that pull request.
- The live smoke test requires network access and a user-supplied token and therefore remains an
  explicit local verification step, not normal CI.
