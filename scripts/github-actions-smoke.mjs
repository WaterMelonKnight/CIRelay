import process from 'node:process';

import { createGitHubActionsProvider } from '../packages/github/dist/index.js';
import { CiToolHandlers } from '../packages/mcp/dist/index.js';

const token = process.env.GITHUB_TOKEN;
if (!token) {
  throw new Error('GITHUB_TOKEN is required for the opt-in GitHub smoke test');
}

const repository = {
  owner: process.env.CIRELAY_SMOKE_OWNER ?? 'WaterMelonKnight',
  name: process.env.CIRELAY_SMOKE_REPO ?? 'CIRelay',
};
const runId = process.env.CIRELAY_SMOKE_RUN_ID ?? '32023569355';

const provider = createGitHubActionsProvider(token);
const handlers = new CiToolHandlers(provider);

const run = await provider.getRun({ repository, runId });
if (run.id !== runId || run.conclusion !== 'failure') {
  throw new Error(
    `Expected failed run ${runId}, received ${run.id} (${run.conclusion})`,
  );
}

const matchingRuns = await handlers.getCiStatus(repository, run.commit.sha);
if (!matchingRuns.some((candidate) => candidate.id === runId)) {
  throw new Error(`listRuns did not return run ${runId} for ${run.commit.sha}`);
}

const failedJobs = await handlers.listFailedJobs(repository, runId);
if (failedJobs.length === 0) {
  throw new Error(`No failed jobs found for run ${runId}`);
}

const log = await handlers.getJobLog(repository, failedJobs[0].id);
if (!log.trim()) {
  throw new Error(`Downloaded an empty log for job ${failedJobs[0].id}`);
}

const context = await handlers.getFailureContext(repository, runId);
if (context.failedJobs.length === 0 || context.evidence.length === 0) {
  throw new Error(
    `FailureContext for run ${runId} contained no failure evidence`,
  );
}
if (!context.evidence.some((item) => item.kind !== 'failed-step')) {
  throw new Error(
    `FailureContext for run ${runId} contained no log-derived evidence`,
  );
}

process.stdout.write(
  JSON.stringify(
    {
      repository: `${repository.owner}/${repository.name}`,
      runId: run.id,
      commitSha: run.commit.sha,
      failedJobs: context.failedJobs.length,
      downloadedLogCharacters: log.length,
      changedFiles: context.changedFiles.length,
      evidence: context.evidence.length,
      evidenceKinds: [...new Set(context.evidence.map((item) => item.kind))],
    },
    null,
    2,
  ) + '\n',
);
