import { describe, expect, it } from 'vitest';
import { GitHubActionsProvider, type GitHubRequester } from './index.js';

describe('GitHubActionsProvider', () => {
  it('maps GitHub runs and jobs without leaking API objects', async () => {
    const responses = new Map([
      [
        'GET /repos/{owner}/{repo}/actions/runs',
        {
          workflow_runs: [
            {
              id: 12,
              name: 'CI',
              head_sha: 'deadbeef',
              status: 'completed',
              conclusion: 'failure',
              created_at: '2025-01-01',
              updated_at: '2025-01-02',
              pull_requests: [],
            },
          ],
        },
      ],
      [
        'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
        {
          jobs: [
            {
              id: 15,
              name: 'test',
              status: 'completed',
              conclusion: 'failure',
              steps: [
                {
                  number: 2,
                  name: 'Test',
                  status: 'completed',
                  conclusion: 'failure',
                },
              ],
            },
          ],
        },
      ],
    ]);
    const client: GitHubRequester = {
      request: (route) => Promise.resolve({ data: responses.get(route) }),
    };
    const provider = new GitHubActionsProvider(client);
    const repository = { owner: 'watermelon', name: 'cirelay' };
    expect(await provider.listRuns({ repository })).toMatchObject([
      { id: '12', provider: 'github-actions', commit: { sha: 'deadbeef' } },
    ]);
    expect(await provider.listJobs({ repository, runId: '12' })).toMatchObject([
      { id: '15', runId: '12', steps: [{ name: 'Test' }] },
    ]);
  });
  it('accepts fixture log data', async () => {
    const provider = new GitHubActionsProvider({
      request: () => Promise.resolve({ data: 'Error: fixture failure' }),
    });
    await expect(
      provider.getJobLog({ repository: { owner: 'a', name: 'b' }, jobId: '1' }),
    ).resolves.toContain('fixture');
  });
});
