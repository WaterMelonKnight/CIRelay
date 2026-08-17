import { describe, expect, it } from 'vitest';
import {
  buildFailureContext,
  extractLogEvidence,
  type CiProvider,
  type CiRun,
} from './index.js';

const run: CiRun = {
  id: '7',
  provider: 'fixture',
  repository: { owner: 'acme', name: 'app' },
  name: 'CI',
  commit: { sha: 'abc' },
  status: 'completed',
  conclusion: 'failure',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:01:00Z',
};
const provider: CiProvider = {
  name: 'fixture',
  listRuns: () => Promise.resolve([run]),
  getRun: () => Promise.resolve(run),
  listJobs: () =>
    Promise.resolve([
      {
        id: '9',
        runId: '7',
        name: 'test',
        status: 'completed',
        conclusion: 'failure',
        steps: [
          {
            number: 1,
            name: 'vitest',
            status: 'completed',
            conclusion: 'failure',
          },
        ],
      },
    ]),
  getJobLog: () =>
    Promise.resolve('running tests\nError: expected true\n    at test.ts:4:2'),
};

describe('failure context', () => {
  it('collects deterministic evidence from failed jobs', async () => {
    const context = await buildFailureContext(
      provider,
      { repository: run.repository, runId: run.id },
      () => new Date('2025-02-01T00:00:00Z'),
    );
    expect(context.failedJobs).toHaveLength(1);
    expect(context.evidence.map((item) => item.kind)).toEqual([
      'failed-step',
      'error-line',
      'stack-trace',
    ]);
    expect(context.generatedAt).toBe('2025-02-01T00:00:00.000Z');
  });
  it('extracts errors and nearby log lines', () =>
    expect(
      extractLogEvidence('setup\nFAILURE: boom\ncleanup').errorLines,
    ).toEqual(['FAILURE: boom']));
});
