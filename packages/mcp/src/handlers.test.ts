import { describe, expect, it, vi } from 'vitest';
import type { CiProvider, CiRun } from '@cirelay/core';
import { CiToolHandlers } from './handlers.js';

const provider: CiProvider = {
  name: 'test',
  listRuns: () => Promise.resolve([]),
  getRun: () => Promise.reject(new Error('unused')),
  listJobs: () =>
    Promise.resolve([
      {
        id: '1',
        runId: '2',
        name: 'ok',
        status: 'completed',
        conclusion: 'success',
        steps: [],
      },
      {
        id: '3',
        runId: '2',
        name: 'bad',
        status: 'completed',
        conclusion: 'failure',
        steps: [],
      },
    ]),
  getJobLog: () => Promise.resolve('fixture'),
};
const repository = { owner: 'a', name: 'b' };
const failedRun = (id: string, sha: string, createdAt: string): CiRun => ({
  id,
  provider: 'test',
  repository,
  name: 'CI',
  commit: { sha },
  status: 'completed',
  conclusion: 'failure',
  createdAt,
  updatedAt: createdAt,
});

function contextProvider(runs: CiRun[]): CiProvider {
  return {
    ...provider,
    listRuns: () => Promise.resolve(runs),
    getRun: ({ runId }) => {
      const run = runs.find(({ id }) => id === runId);
      return run ? Promise.resolve(run) : Promise.reject(new Error('missing'));
    },
    listJobs: ({ runId }) =>
      Promise.resolve([
        {
          id: `job-${runId}`,
          runId,
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
    getJobLog: () => Promise.resolve('Error: failed\n    at test.ts:1:1'),
  };
}
describe('MCP handlers', () => {
  it('filters failed jobs through the provider abstraction', async () =>
    expect(
      await new CiToolHandlers(provider).listFailedJobs(
        { owner: 'a', name: 'b' },
        '2',
      ),
    ).toMatchObject([{ id: '3' }]));

  it('exposes provider-neutral run queries', async () => {
    const queriedProvider: CiProvider = {
      ...provider,
      listRuns: () =>
        Promise.resolve([
          {
            id: '7',
            provider: 'test',
            repository: { owner: 'a', name: 'b' },
            name: 'CI',
            commit: { sha: 'head' },
            status: 'completed',
            conclusion: 'failure',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ]),
    };
    await expect(
      new CiToolHandlers(queriedProvider).listCiRuns({
        repository: { owner: 'a', name: 'b' },
        branch: 'main',
        latest: true,
      }),
    ).resolves.toMatchObject([{ id: '7' }]);
  });

  it('keeps explicit run ID failure context on the direct lookup path', async () => {
    const run = failedRun('7', 'head', '2026-01-01T00:00:00Z');
    let listCalls = 0;
    const directProvider = {
      ...contextProvider([run]),
      listRuns: () => {
        listCalls += 1;
        return Promise.resolve([run]);
      },
    };

    await expect(
      new CiToolHandlers(directProvider).getFailureContext({
        repository,
        runId: '7',
      }),
    ).resolves.toMatchObject({ run: { id: '7' }, failedJobs: [{ job: {} }] });
    expect(listCalls).toBe(0);
  });

  it('accepts source policy for failure-context log retrieval', async () => {
    const run = failedRun('7', 'head', '2026-01-01T00:00:00Z');
    const getJobLog = vi.fn(() => Promise.resolve('Error: fresh'));
    const policyProvider = { ...contextProvider([run]), getJobLog };
    const handlers = new CiToolHandlers(policyProvider);
    const query = { repository, runId: '7' };

    await handlers.getFailureContext(query);
    await handlers.getFailureContext(query, 'refresh');
    expect(getJobLog).toHaveBeenCalledTimes(2);
  });

  it('shares raw-log cache between failure context and runtime searches', async () => {
    const run = failedRun('7', 'head', '2026-01-01T00:00:00Z');
    const getJobLog = vi.fn(() => Promise.resolve('Error: postgres failed'));
    const handlers = new CiToolHandlers({
      ...contextProvider([run]),
      getJobLog,
    });
    await handlers.getFailureContext({ repository, runId: '7' });
    await expect(
      handlers.searchJobLogs({
        repository,
        jobId: 'job-7',
        patterns: ['postgres'],
        sourcePolicy: 'cache-only',
      }),
    ).resolves.toMatchObject({ matchCount: 1 });
    expect(getJobLog).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['commit SHA', { commitSha: 'head', latest: true }],
    ['branch', { branch: 'main', latest: true }],
  ])('builds failure context selected by %s', async (_name, selector) => {
    const run = failedRun('7', 'head', '2026-01-01T00:00:00Z');
    await expect(
      new CiToolHandlers(contextProvider([run])).getFailureContext({
        repository,
        ...selector,
      }),
    ).resolves.toMatchObject({
      commitSha: 'head',
      failedJobs: [{ job: { id: 'job-7' } }],
      evidence: [
        { kind: 'failed-step' },
        { kind: 'error-line' },
        { kind: 'stack-trace' },
      ],
    });
  });

  it('resolves the latest failed PR run and preserves PR metadata and changed files', async () => {
    const oldRun = failedRun('6', 'head', '2025-01-01T00:00:00Z');
    const latestRun = failedRun('7', 'head', '2026-01-01T00:00:00Z');
    const queryProvider: CiProvider = {
      ...contextProvider([oldRun, latestRun]),
      getPullRequest: () =>
        Promise.resolve({ number: 42, headSha: 'head', baseSha: 'base' }),
      getPullRequestDiff: () =>
        Promise.resolve([{ path: 'src/failure.ts', status: 'modified' }]),
    };

    await expect(
      new CiToolHandlers(queryProvider).getFailureContext({
        repository,
        pullRequestNumber: 42,
        conclusion: 'failure',
        latest: true,
      }),
    ).resolves.toMatchObject({
      run: { id: '7' },
      pullRequest: { number: 42, headSha: 'head' },
      changedFiles: [{ path: 'src/failure.ts' }],
      failedJobs: [{ job: { id: 'job-7' } }],
      evidence: [
        { kind: 'failed-step' },
        { kind: 'error-line' },
        { kind: 'stack-trace' },
      ],
    });
  });

  it.each([
    [
      'ambiguous query',
      [
        failedRun('6', 'a', '2025-01-01T00:00:00Z'),
        failedRun('7', 'b', '2026-01-01T00:00:00Z'),
      ],
      'multiple-matching-runs',
    ],
    ['no matching run', [], 'no-matching-run'],
  ])('preserves the %s domain error', async (_name, runs, code) => {
    await expect(
      new CiToolHandlers(contextProvider(runs)).getFailureContext({
        repository,
      }),
    ).rejects.toMatchObject({ code });
  });

  it('rejects invalid selector combinations through core validation', async () => {
    await expect(
      new CiToolHandlers(contextProvider([])).getFailureContext({
        repository,
        runId: '7',
        branch: 'main',
      }),
    ).rejects.toMatchObject({ code: 'invalid-query' });
  });
});
