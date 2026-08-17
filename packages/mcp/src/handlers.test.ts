import { describe, expect, it } from 'vitest';
import type { CiProvider } from '@cirelay/core';
import { CiToolHandlers } from './handlers.js';

const provider: CiProvider = {
  name: 'test',
  listRuns: async () => [],
  getRun: async () => {
    throw new Error('unused');
  },
  listJobs: async () => [
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
  ],
  getJobLog: async () => 'fixture',
};
describe('MCP handlers', () => {
  it('filters failed jobs through the provider abstraction', async () =>
    expect(
      await new CiToolHandlers(provider).listFailedJobs(
        { owner: 'a', name: 'b' },
        '2',
      ),
    ).toMatchObject([{ id: '3' }]));
});
