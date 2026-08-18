import { describe, expect, it } from 'vitest';
import type { CiProvider } from '@cirelay/core';
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
});
