import { extractLogEvidence } from './logs.js';
import type {
  CiProvider,
  FailureContext,
  FailureEvidence,
  RunInput,
  CiRunQuery,
} from './types.js';
import { resolveSingleRun } from './run-resolution.js';
import {
  CachedLogSource,
  MemoryJobLogCache,
  type LogSource,
  type LogSourcePolicy,
} from './log-source.js';

export interface BuildFailureContextOptions {
  logSourcePolicy?: LogSourcePolicy;
  logSource?: LogSource;
  now?: () => Date;
}

const defaultLogSources = new WeakMap<CiProvider, LogSource>();

function getDefaultLogSource(provider: CiProvider): LogSource {
  const existing = defaultLogSources.get(provider);
  if (existing) return existing;
  const source = new CachedLogSource(provider, new MemoryJobLogCache());
  defaultLogSources.set(provider, source);
  return source;
}

function normalizeOptions(
  nowOrOptions: (() => Date) | BuildFailureContextOptions | undefined,
): BuildFailureContextOptions {
  return typeof nowOrOptions === 'function'
    ? { now: nowOrOptions }
    : (nowOrOptions ?? {});
}

export async function buildFailureContext(
  provider: CiProvider,
  input: RunInput,
  nowOrOptions: (() => Date) | BuildFailureContextOptions = {},
): Promise<FailureContext> {
  const options = normalizeOptions(nowOrOptions);
  const now = options.now ?? (() => new Date());
  const logSource = options.logSource ?? getDefaultLogSource(provider);
  const [run, jobs] = await Promise.all([
    provider.getRun(input),
    provider.listJobs(input),
  ]);
  const failed = jobs.filter(
    (job) => job.conclusion === 'failure' || job.conclusion === 'timed_out',
  );
  const failedJobs = await Promise.all(
    failed.map(async (job) => {
      const log = await logSource.getJobLog(
        { repository: input.repository, jobId: job.id },
        options.logSourcePolicy ? { policy: options.logSourcePolicy } : {},
      );
      const parsed = extractLogEvidence(log);
      return {
        job,
        failedSteps: job.steps.filter((step) => step.conclusion === 'failure'),
        logExcerpt: parsed.excerpt,
        errorLines: parsed.errorLines,
        stackTraceCandidates: parsed.stackTraceCandidates,
      };
    }),
  );
  const changedFiles =
    run.pullRequest && provider.getPullRequestDiff
      ? await provider.getPullRequestDiff({
          repository: input.repository,
          pullRequestNumber: run.pullRequest.number,
        })
      : [];
  const evidence: FailureEvidence[] = failedJobs.flatMap(
    ({ job, failedSteps, errorLines, stackTraceCandidates }) => [
      ...failedSteps.map((step) => ({
        kind: 'failed-step' as const,
        message: step.name,
        jobId: job.id,
        stepName: step.name,
      })),
      ...errorLines.map((message) => ({
        kind: 'error-line' as const,
        message,
        jobId: job.id,
      })),
      ...stackTraceCandidates.map((message) => ({
        kind: 'stack-trace' as const,
        message,
        jobId: job.id,
      })),
    ],
  );
  return {
    provider: provider.name,
    repository: run.repository,
    commitSha: run.commit.sha,
    ...(run.pullRequest ? { pullRequest: run.pullRequest } : {}),
    run,
    failedJobs,
    changedFiles,
    evidence,
    generatedAt: now().toISOString(),
  };
}

export async function buildFailureContextForQuery(
  provider: CiProvider,
  query: CiRunQuery,
  nowOrOptions: (() => Date) | BuildFailureContextOptions = {},
): Promise<FailureContext> {
  const options = normalizeOptions(nowOrOptions);
  const run = await resolveSingleRun(provider, query);
  const context = await buildFailureContext(
    provider,
    { repository: query.repository, runId: run.id },
    options,
  );
  if (!run.pullRequest || context.pullRequest) return context;
  const changedFiles = provider.getPullRequestDiff
    ? await provider.getPullRequestDiff({
        repository: query.repository,
        pullRequestNumber: run.pullRequest.number,
      })
    : [];
  return { ...context, pullRequest: run.pullRequest, changedFiles };
}
