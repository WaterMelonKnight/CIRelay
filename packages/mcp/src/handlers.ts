import {
  buildFailureContext,
  buildFailureContextForQuery,
  resolveRuns,
  type CiRunQuery,
  type CiProvider,
  type RepositoryRef,
  type LogSourcePolicy,
  type JobLogSearchQuery,
  CachedLogSource,
  MemoryJobLogCache,
  searchJobLog,
} from '@cirelay/core';

export class CiToolHandlers {
  private readonly logSource;

  constructor(private readonly provider: CiProvider) {
    this.logSource = new CachedLogSource(provider, new MemoryJobLogCache());
  }
  async getCiStatus(repository: RepositoryRef, commitSha?: string) {
    return this.provider.listRuns({
      repository,
      ...(commitSha ? { commitSha } : {}),
      limit: 20,
    });
  }
  async listCiRuns(query: CiRunQuery) {
    return resolveRuns(this.provider, query);
  }
  async listFailedJobs(repository: RepositoryRef, runId: string) {
    return (await this.provider.listJobs({ repository, runId })).filter(
      (job) => job.conclusion === 'failure' || job.conclusion === 'timed_out',
    );
  }
  async getJobLog(repository: RepositoryRef, jobId: string) {
    return this.provider.getJobLog({ repository, jobId });
  }
  async getFailureContext(
    query: CiRunQuery,
    sourcePolicy: LogSourcePolicy = 'prefer-cache',
  ) {
    if (
      query.runId &&
      query.commitSha === undefined &&
      query.pullRequestNumber === undefined &&
      query.branch === undefined
    ) {
      return buildFailureContext(
        this.provider,
        { repository: query.repository, runId: query.runId },
        { logSourcePolicy: sourcePolicy, logSource: this.logSource },
      );
    }
    return buildFailureContextForQuery(this.provider, query, {
      logSourcePolicy: sourcePolicy,
      logSource: this.logSource,
    });
  }

  async searchJobLogs(query: JobLogSearchQuery) {
    return searchJobLog(this.logSource, query);
  }
}
