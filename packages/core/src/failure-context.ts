import { extractLogEvidence } from './logs.js';
import type {
  CiProvider,
  FailureContext,
  FailureEvidence,
  RunInput,
} from './types.js';

export async function buildFailureContext(
  provider: CiProvider,
  input: RunInput,
  now = () => new Date(),
): Promise<FailureContext> {
  const [run, jobs] = await Promise.all([
    provider.getRun(input),
    provider.listJobs(input),
  ]);
  const failed = jobs.filter(
    (job) => job.conclusion === 'failure' || job.conclusion === 'timed_out',
  );
  const failedJobs = await Promise.all(
    failed.map(async (job) => {
      const log = await provider.getJobLog({
        repository: input.repository,
        jobId: job.id,
      });
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
