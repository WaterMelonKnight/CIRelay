import {
  buildFailureContext,
  resolveRuns,
  type CiRunQuery,
  type CiProvider,
  type RepositoryRef,
} from '@cirelay/core';

export class CiToolHandlers {
  constructor(private readonly provider: CiProvider) {}
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
  async getFailureContext(repository: RepositoryRef, runId: string) {
    return buildFailureContext(this.provider, { repository, runId });
  }
}
