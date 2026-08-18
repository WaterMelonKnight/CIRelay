import type {
  ChangedFile,
  CiConclusion,
  CiJob,
  CiProvider,
  CiRun,
  CiStatus,
  JobInput,
  ListRunsInput,
  PullRequestInput,
  PullRequestRef,
  RunInput,
} from '@cirelay/core';
import { Octokit } from 'octokit';

export interface GitHubRequester {
  request(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value as JsonObject;
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const id = (value: unknown): string => String(value);
const status = (value: unknown): CiStatus =>
  value === 'queued' || value === 'in_progress' || value === 'completed'
    ? value
    : 'unknown';
const changedFileStatuses = [
  'added',
  'modified',
  'removed',
  'renamed',
] as const;
const fileStatus = (
  value: unknown,
): (typeof changedFileStatuses)[number] | undefined =>
  changedFileStatuses.find((item) => item === value);
const conclusion = (value: unknown): CiConclusion | undefined => {
  const valid: CiConclusion[] = [
    'success',
    'failure',
    'cancelled',
    'skipped',
    'neutral',
    'timed_out',
    'action_required',
  ];
  return valid.find((item) => item === value);
};

export class GitHubActionsProvider implements CiProvider {
  readonly name = 'github-actions';
  constructor(private readonly client: GitHubRequester) {}

  async listRuns(input: ListRunsInput): Promise<CiRun[]> {
    const { data } = await this.client.request(
      'GET /repos/{owner}/{repo}/actions/runs',
      {
        owner: input.repository.owner,
        repo: input.repository.name,
        ...(input.commitSha ? { head_sha: input.commitSha } : {}),
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.conclusion && input.conclusion !== 'unknown'
          ? { status: input.conclusion }
          : {}),
        per_page: input.limit ?? 30,
      },
    );
    return array(object(data).workflow_runs).map((item) =>
      this.mapRun(object(item), input.repository),
    );
  }

  async getPullRequest(input: PullRequestInput): Promise<PullRequestRef> {
    const { data } = await this.client.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      {
        owner: input.repository.owner,
        repo: input.repository.name,
        pull_number: input.pullRequestNumber,
      },
    );
    const pull = object(data);
    return {
      number: Number(pull.number),
      headSha: text(object(pull.head).sha),
      ...(text(object(pull.base).sha)
        ? { baseSha: text(object(pull.base).sha) }
        : {}),
    };
  }

  async getRun(input: RunInput): Promise<CiRun> {
    const { data } = await this.client.request(
      'GET /repos/{owner}/{repo}/actions/runs/{run_id}',
      {
        owner: input.repository.owner,
        repo: input.repository.name,
        run_id: input.runId,
      },
    );
    return this.mapRun(object(data), input.repository);
  }

  async listJobs(input: RunInput): Promise<CiJob[]> {
    const { data } = await this.client.request(
      'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
      {
        owner: input.repository.owner,
        repo: input.repository.name,
        run_id: input.runId,
        filter: 'all',
        per_page: 100,
      },
    );
    return array(object(data).jobs).map((value) =>
      this.mapJob(object(value), input.runId),
    );
  }

  async getJobLog(input: JobInput): Promise<string> {
    const { data } = await this.client.request(
      'GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs',
      {
        owner: input.repository.owner,
        repo: input.repository.name,
        job_id: input.jobId,
      },
    );
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
    }
    throw new Error('GitHub returned an unsupported job log response');
  }

  async getPullRequestDiff(input: PullRequestInput): Promise<ChangedFile[]> {
    const { data } = await this.client.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
      {
        owner: input.repository.owner,
        repo: input.repository.name,
        pull_number: input.pullRequestNumber,
        per_page: 100,
      },
    );
    return array(data).map((value) => {
      const file = object(value);
      const mappedStatus = fileStatus(file.status);
      return {
        path: text(file.filename),
        ...(mappedStatus ? { status: mappedStatus } : {}),
        ...(typeof file.patch === 'string' ? { patch: file.patch } : {}),
      };
    });
  }

  private mapRun(
    run: JsonObject,
    repository: ListRunsInput['repository'],
  ): CiRun {
    const pulls = array(run.pull_requests);
    const firstPull = pulls[0] ? object(pulls[0]) : undefined;
    const mappedConclusion = conclusion(run.conclusion);
    return {
      id: id(run.id),
      provider: this.name,
      repository,
      name: text(run.name, 'GitHub Actions'),
      commit: { sha: text(run.head_sha) },
      ...(firstPull
        ? {
            pullRequest: {
              number: Number(firstPull.number),
              headSha: text(object(firstPull.head).sha, text(run.head_sha)),
              baseSha: text(object(firstPull.base).sha),
            },
          }
        : {}),
      status: status(run.status),
      ...(mappedConclusion ? { conclusion: mappedConclusion } : {}),
      ...(typeof run.html_url === 'string' ? { url: run.html_url } : {}),
      createdAt: text(run.created_at),
      updatedAt: text(run.updated_at),
    };
  }

  private mapJob(job: JsonObject, runId: string): CiJob {
    const mappedConclusion = conclusion(job.conclusion);
    return {
      id: id(job.id),
      runId,
      name: text(job.name),
      status: status(job.status),
      ...(mappedConclusion ? { conclusion: mappedConclusion } : {}),
      ...(typeof job.html_url === 'string' ? { url: job.html_url } : {}),
      steps: array(job.steps).map((value) => {
        const step = object(value);
        const stepConclusion = conclusion(step.conclusion);
        return {
          number: Number(step.number),
          name: text(step.name),
          status: status(step.status),
          ...(stepConclusion ? { conclusion: stepConclusion } : {}),
          ...(typeof step.started_at === 'string'
            ? { startedAt: step.started_at }
            : {}),
          ...(typeof step.completed_at === 'string'
            ? { completedAt: step.completed_at }
            : {}),
        };
      }),
    };
  }
}

export function createGitHubActionsProvider(
  token: string,
): GitHubActionsProvider {
  const octokit = new Octokit({ auth: token });
  return new GitHubActionsProvider({
    request: (route, parameters) => octokit.request(route, parameters),
  });
}
