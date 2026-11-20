import { describe, expect, it, vi } from 'vitest';
import {
  buildFailureContext,
  buildFailureContextForQuery,
  compactFailureContext,
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
  it('retrieves through an injected log source', async () => {
    const getJobLog = vi.fn(() => Promise.resolve('Error: injected'));
    await buildFailureContext(
      provider,
      { repository: run.repository, runId: run.id },
      { logSource: { getJobLog }, logSourcePolicy: 'refresh' },
    );
    expect(getJobLog).toHaveBeenCalledWith(
      { repository: run.repository, jobId: '9' },
      { policy: 'refresh' },
    );
  });

  it('reuses raw job logs on repeated default builds', async () => {
    const getJobLog = vi.fn(() => Promise.resolve('Error: once'));
    const repeatProvider = { ...provider, getJobLog };
    const input = { repository: run.repository, runId: run.id };
    await buildFailureContext(repeatProvider, input);
    await buildFailureContext(repeatProvider, input);
    expect(getJobLog).toHaveBeenCalledTimes(1);
  });
  it('extracts errors and nearby log lines', () =>
    expect(
      extractLogEvidence('setup\nFAILURE: boom\ncleanup').errorLines,
    ).toEqual(['FAILURE: boom']));

  it('preserves query-resolved PR metadata for changed-file lookup', async () => {
    const queryProvider: CiProvider = {
      ...provider,
      getPullRequest: () =>
        Promise.resolve({ number: 42, headSha: 'abc', baseSha: 'base' }),
      getPullRequestDiff: () =>
        Promise.resolve([{ path: 'src/failure.ts', status: 'modified' }]),
    };
    await expect(
      buildFailureContextForQuery(queryProvider, {
        repository: run.repository,
        pullRequestNumber: 42,
        latest: true,
      }),
    ).resolves.toMatchObject({
      pullRequest: { number: 42, headSha: 'abc' },
      changedFiles: [{ path: 'src/failure.ts' }],
    });
  });
});

describe('compactFailureContext', () => {
  const base = (overrides: Record<string, unknown> = {}) =>
    ({
      provider: 'test',
      repository: { owner: 'o', name: 'n' },
      commitSha: 'abc',
      run: {
        id: '1',
        provider: 'test',
        repository: { owner: 'o', name: 'n' },
        name: 'CI',
        commit: { sha: 'abc' },
        status: 'completed',
        conclusion: 'failure',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      failedJobs: [
        {
          job: {
            id: 'j',
            runId: '1',
            name: 'build',
            status: 'completed',
            conclusion: 'failure',
            steps: [],
          },
          failedSteps: [],
          logExcerpt: '[ERROR] boom',
          errorLines: ['[ERROR] boom'],
          stackTraceCandidates: ['at A.b(A.java:1)'],
          ...overrides,
        },
      ],
      changedFiles: [],
      evidence: [
        {
          kind: 'error-line',
          message: '[ERROR] boom',
          jobId: 'j',
          lineNumber: 1,
          parser: 'maven',
          category: 'build-failure',
        },
        {
          kind: 'stack-trace',
          message: 'at A.b(A.java:1)',
          jobId: 'j',
          lineNumber: 2,
          parser: 'java',
          category: 'stack-trace',
        },
      ],
      generatedAt: '2026-01-01T00:00:00Z',
    }) as unknown as Parameters<typeof compactFailureContext>[0];

  it('drops the arrays that evidence already carries', () => {
    const compact = compactFailureContext(base());
    expect(compact.failedJobs[0]).not.toHaveProperty('errorLines');
    expect(compact.failedJobs[0]).not.toHaveProperty('stackTraceCandidates');
  });

  it('drops the excerpt when every line is already in evidence', () => {
    const compact = compactFailureContext(base());
    expect(compact.failedJobs[0]).not.toHaveProperty('logExcerpt');
  });

  it('keeps the excerpt when it has context lines evidence does not carry', () => {
    const compact = compactFailureContext(
      base({ logExcerpt: '[INFO] setup\\n[ERROR] boom\\n[INFO] cleanup' }),
    );
    expect(compact.failedJobs.at(0)?.logExcerpt).toBe(
      '[INFO] setup\\n[ERROR] boom\\n[INFO] cleanup',
    );
  });
});
