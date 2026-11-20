import { extractLogEvidence } from './logs.js';
import type { ExtractionProfileName } from './extraction-profiles.js';
import type {
  CiProvider,
  FailureContext,
  FailedJobContext,
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
import {
  resolveExtractionOptions,
  type ExtractionOptions,
  type RepositoryConfigSource,
} from './config.js';

export interface BuildFailureContextOptions {
  logSourcePolicy?: LogSourcePolicy;
  logSource?: LogSource;
  now?: () => Date;
  extractionProfile?: ExtractionProfileName;
  extractionOptions?: Partial<ExtractionOptions>;
  repositoryConfigSource?: RepositoryConfigSource;
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
  const repositoryConfig = options.repositoryConfigSource
    ? await options.repositoryConfigSource.getConfig(
        run.repository,
        run.commit.sha,
      )
    : undefined;
  const extractionOptions = resolveExtractionOptions({
    ...(repositoryConfig ? { repositoryConfig } : {}),
    invocationOptions: {
      ...options.extractionOptions,
      ...(options.extractionProfile
        ? { profile: options.extractionProfile }
        : {}),
    },
  });
  const failed = jobs.filter(
    (job) => job.conclusion === 'failure' || job.conclusion === 'timed_out',
  );
  const parsedFailedJobs = await Promise.all(
    failed.map(async (job) => {
      const log = await logSource.getJobLog(
        { repository: input.repository, jobId: job.id },
        options.logSourcePolicy ? { policy: options.logSourcePolicy } : {},
      );
      const parsed = extractLogEvidence(log, extractionOptions);
      return {
        job,
        failedSteps: job.steps.filter((step) => step.conclusion === 'failure'),
        logExcerpt: parsed.excerpt,
        errorLines: parsed.errorLines,
        stackTraceCandidates: parsed.stackTraceCandidates,
        parsedEvidence: parsed.evidence,
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
  const evidence: FailureEvidence[] = parsedFailedJobs.flatMap(
    ({ job, failedSteps, parsedEvidence }) => [
      ...failedSteps.map((step) => ({
        kind: 'failed-step' as const,
        message: step.name,
        jobId: job.id,
        stepName: step.name,
      })),
      ...parsedEvidence.map(
        ({ kind, message, lineNumber, parser, category }) => ({
          kind,
          message,
          jobId: job.id,
          lineNumber,
          parser,
          category,
        }),
      ),
    ],
  );
  const failedJobs = parsedFailedJobs.map(
    ({ job, failedSteps, logExcerpt, errorLines, stackTraceCandidates }) => ({
      job,
      failedSteps,
      logExcerpt,
      errorLines,
      stackTraceCandidates,
    }),
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

/**
 * Model-facing view of a FailureContext.
 *
 * The full object repeats the same log text up to three times: `errorLines` and
 * `stackTraceCandidates` are projections of `evidence`, and `logExcerpt` usually
 * contains the evidence lines again. That is cheap on disk and expensive in a
 * model's context window, which is the whole point of CIRelay.
 *
 * This view drops the derivable duplicates and keeps `logExcerpt` only when it
 * carries context lines that evidence does not already contain.
 */
export type CompactFailedJobContext = Omit<
  FailedJobContext,
  'errorLines' | 'stackTraceCandidates' | 'logExcerpt'
> & { logExcerpt?: string };

export type CompactFailureContext = Omit<FailureContext, 'failedJobs'> & {
  failedJobs: CompactFailedJobContext[];
};

export function compactFailureContext(
  context: FailureContext,
): CompactFailureContext {
  const evidenceMessages = new Set(
    context.evidence.map((item) => item.message),
  );
  const failedJobs = context.failedJobs.map((job): CompactFailedJobContext => {
    const excerptLines = job.logExcerpt
      ? job.logExcerpt.split('\n').filter((line) => line.trim().length > 0)
      : [];
    const excerptIsCovered = excerptLines.every((line) =>
      evidenceMessages.has(line),
    );
    const compact: CompactFailedJobContext = {
      job: job.job,
      failedSteps: job.failedSteps,
    };
    if (job.logExcerpt && !excerptIsCovered)
      compact.logExcerpt = job.logExcerpt;
    return compact;
  });
  return { ...context, failedJobs };
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
