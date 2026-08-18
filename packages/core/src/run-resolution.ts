import type { CiProvider, CiRun, CiRunQuery, PullRequestRef } from './types.js';

export type RunResolutionErrorCode =
  | 'invalid-query'
  | 'no-matching-run'
  | 'multiple-matching-runs'
  | 'unsupported-capability';

export class RunResolutionError extends Error {
  constructor(
    readonly code: RunResolutionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RunResolutionError';
  }
}

function validateQuery(query: CiRunQuery): void {
  const selectors = [
    query.commitSha,
    query.pullRequestNumber,
    query.branch,
  ].filter((value) => value !== undefined);
  if (query.runId && selectors.length > 0) {
    throw new RunResolutionError(
      'invalid-query',
      'runId cannot be combined with commitSha, pullRequestNumber, or branch',
    );
  }
  if (selectors.length > 1) {
    throw new RunResolutionError(
      'invalid-query',
      'Only one of commitSha, pullRequestNumber, or branch may be supplied',
    );
  }
  if (
    query.pullRequestNumber !== undefined &&
    (!Number.isInteger(query.pullRequestNumber) || query.pullRequestNumber < 1)
  ) {
    throw new RunResolutionError(
      'invalid-query',
      'pullRequestNumber must be a positive integer',
    );
  }
  if (query.conclusion === 'unknown') {
    throw new RunResolutionError(
      'invalid-query',
      'unknown is not a supported conclusion query filter',
    );
  }
  if (
    query.limit !== undefined &&
    (!Number.isInteger(query.limit) || query.limit < 1)
  ) {
    throw new RunResolutionError(
      'invalid-query',
      'limit must be a positive integer',
    );
  }
}

/** Newest first by createdAt, then updatedAt and id for deterministic ties. */
function newestFirst(left: CiRun, right: CiRun): number {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}

function matchingConclusion(runs: CiRun[], query: CiRunQuery): CiRun[] {
  return query.conclusion
    ? runs.filter((run) => run.conclusion === query.conclusion)
    : runs;
}

export async function resolveRuns(
  provider: CiProvider,
  query: CiRunQuery,
): Promise<CiRun[]> {
  validateQuery(query);
  let runs: CiRun[];
  let pullRequest: PullRequestRef | undefined;

  if (query.runId) {
    try {
      runs = [
        await provider.getRun({
          repository: query.repository,
          runId: query.runId,
        }),
      ];
    } catch (cause) {
      throw new RunResolutionError(
        'no-matching-run',
        `CI run ${query.runId} could not be resolved`,
        { cause },
      );
    }
  } else {
    let commitSha = query.commitSha;
    if (query.pullRequestNumber !== undefined) {
      if (!provider.getPullRequest) {
        throw new RunResolutionError(
          'unsupported-capability',
          `${provider.name} cannot resolve pull requests`,
        );
      }
      try {
        pullRequest = await provider.getPullRequest({
          repository: query.repository,
          pullRequestNumber: query.pullRequestNumber,
        });
      } catch (cause) {
        throw new RunResolutionError(
          'no-matching-run',
          `Pull request #${query.pullRequestNumber} could not be resolved`,
          { cause },
        );
      }
      commitSha = pullRequest.headSha;
    }
    runs = await provider.listRuns({
      repository: query.repository,
      ...(commitSha ? { commitSha } : {}),
      ...(query.branch ? { branch: query.branch } : {}),
      ...(query.conclusion ? { conclusion: query.conclusion } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });
  }

  runs = matchingConclusion(runs, query).map((run) =>
    pullRequest ? { ...run, pullRequest } : run,
  );
  runs.sort(newestFirst);
  if (query.latest) runs = runs.slice(0, 1);
  if (runs.length === 0) {
    throw new RunResolutionError(
      'no-matching-run',
      'No CI runs matched the query',
    );
  }
  return runs;
}

export async function resolveSingleRun(
  provider: CiProvider,
  query: CiRunQuery,
): Promise<CiRun> {
  const runs = await resolveRuns(provider, query);
  if (runs.length !== 1) {
    throw new RunResolutionError(
      'multiple-matching-runs',
      `Expected one CI run, but ${runs.length} runs matched`,
    );
  }
  return runs[0]!;
}
