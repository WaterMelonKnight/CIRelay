# GitHub Actions provider

This guide configures CIRelay's current local/MCP pull mode for GitHub Actions.

## Supported capabilities

### Current

CIRelay accepts a repository and an explicit workflow run ID. It can retrieve the
workflow run, filter listed runs by commit SHA, retrieve failed jobs, download and
decode job logs, and construct a provider-neutral `FailureContext` with log-derived
evidence. When GitHub associates the run with a pull request, CIRelay can also
retrieve that pull request's changed files.

### Future roadmap, not implemented

The future query layer may locate runs by pull request number, branch, workflow,
latest failed CI, time range, or status/conclusion filters. Future log extraction
may add framework-specific parsers, custom user log rules, `.cirelay.yml`, failure
fingerprints, diff correlation, and suspected-file ranking. None of these features
is available today.

## Authentication method

For current local/MCP pull-mode usage, prefer a fine-grained personal access token:

1. In GitHub, open **Profile picture → Settings → Developer settings → Personal
   access tokens → Fine-grained tokens → Generate new token**.
2. Choose a short expiration.
3. Under **Repository access**, choose **Only select repositories**.
4. Select only the repositories CIRelay needs to inspect.
5. Configure the repository permissions below and generate the token.

Provide the token through `GITHUB_TOKEN`. This example contains a placeholder, not
a real token:

```sh
export GITHUB_TOKEN='<your-token>'
```

To avoid putting the value in shell history, it can instead be read silently:

```sh
read -rsp 'GitHub token: ' GITHUB_TOKEN && echo
export GITHUB_TOKEN
```

## Minimum permissions

For a fine-grained token, configure repository permissions as follows:

- **Actions: Read** — required for workflow runs, jobs, and logs.
- **Pull requests: Read** — required when pull-request changed-file analysis is
  desired.
- **Contents: Read** — a conservative read-only baseline that may be useful for a
  generally usable repository token, but it is **not currently strictly required**
  by CIRelay's actual GitHub API requests.

Normal pull-mode usage does not require write permissions.

## Configuration variables

| Variable               | Required        | Meaning                                | Default            |
| ---------------------- | --------------- | -------------------------------------- | ------------------ |
| `GITHUB_TOKEN`         | Yes             | GitHub credential used by the provider | None               |
| `CIRELAY_SMOKE_OWNER`  | Smoke test only | Repository owner                       | `WaterMelonKnight` |
| `CIRELAY_SMOKE_REPO`   | Smoke test only | Repository name                        | `CIRelay`          |
| `CIRELAY_SMOKE_RUN_ID` | Smoke test only | Explicit workflow run ID               | `32023569355`      |

The smoke-test override variables do not configure the MCP tools; MCP requests
provide their repository and run/job identifiers as tool arguments.

## Quick verification command

From a built checkout, run:

```sh
pnpm smoke:github
```

By default, this checks only `WaterMelonKnight/CIRelay` run `32023569355`. To use
another historical run:

```sh
CIRELAY_SMOKE_OWNER=your-owner \
CIRELAY_SMOKE_REPO=your-repository \
CIRELAY_SMOKE_RUN_ID=123456789 \
pnpm smoke:github
```

This is deliberately an opt-in live check, separate from the network-independent
test suite. Success verifies workflow-run retrieval, commit-SHA-filtered run
listing, failed-job retrieval, job-log download, log decoding, `FailureContext`
construction, and log-derived evidence extraction. It does not scan all
repositories or every historical CI run: it targets one repository and one
explicit workflow run ID.

After verification, start the MCP stdio server with:

```sh
pnpm --filter @cirelay/mcp exec cirelay-mcp
```

## Real dogfood result

CIRelay successfully ran the live smoke test against historical failed GitHub
Actions run `32023569355` in `WaterMelonKnight/CIRelay`. The actual summary was:

```json
{
  "repository": "WaterMelonKnight/CIRelay",
  "runId": "32023569355",
  "commitSha": "eaab6ab457672fd3d55df343557dc2385e265ec7",
  "failedJobs": 1,
  "downloadedLogCharacters": 21145,
  "changedFiles": 0,
  "evidence": 4,
  "evidenceKinds": ["failed-step", "error-line"]
}
```

In short, 21,145 characters of real CI log were reduced into a small structured
`FailureContext` containing `failed-step` and `error-line` evidence. This result
demonstrates retrieval and deterministic evidence extraction; it does not claim
semantic root-cause diagnosis or a precise token compression ratio.

## Security notes

- Never commit real tokens or place them in README files, examples, or command
  arguments that may be retained.
- Never print tokens in logs. CIRelay's smoke script does not print or persist the
  token.
- Pass the token with the `GITHUB_TOKEN` environment variable.
- Prefer a short expiration and scope the token to only required repositories.
- Revoke and rotate a token immediately if it is exposed.

## Troubleshooting

### Missing `GITHUB_TOKEN`

Export `GITHUB_TOKEN` in the same shell that starts the smoke test or MCP server.
Use the placeholder or silent-input examples above; do not paste a real token into
documentation.

### `401 Unauthorized`

The token is missing, invalid, or expired. Confirm the environment variable is set,
then generate or rotate the token if needed.

### `403 Forbidden`

The token may have insufficient permissions, the repository may not be selected,
or an organization may require approval, SSO authorization, or an administrator's
policy exception.

### `404 Not Found`

Check the repository owner, repository name, and run ID. GitHub may also return
this when the token cannot see the requested resource.

### No pull-request changed files

The workflow run may not be associated with a pull request, or the token may lack
**Pull requests: Read**. A zero-file result does not prevent log-derived evidence
from being constructed.

## Known limitations

- Run selection requires one repository and an explicit run ID; broader query
  filters are not implemented.
- Run, job, and pull-request-file API reads use their current first-page behavior.
- Evidence extraction is deterministic and generic rather than framework-specific.
- Authentication uses a caller-provided token; CIRelay does not yet provide a
  GitHub App authentication flow.
