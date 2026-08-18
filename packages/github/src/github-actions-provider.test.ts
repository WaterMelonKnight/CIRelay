import { describe, expect, it, vi } from 'vitest';
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

  it.each([
    ['ArrayBuffer', new TextEncoder().encode('Error: array buffer').buffer],
    ['Buffer', Buffer.from('Error: node buffer')],
    [
      'offset typed array',
      new Uint8Array(
        new TextEncoder().encode('xxError: typed arrayxx').buffer,
        2,
        18,
      ),
    ],
  ])('decodes %s log responses', async (_name, data) => {
    const provider = new GitHubActionsProvider({
      request: () => Promise.resolve({ data }),
    });
    await expect(
      provider.getJobLog({ repository: { owner: 'a', name: 'b' }, jobId: '1' }),
    ).resolves.toMatch(/^Error:/);
  });

  it('maps pull request metadata from a workflow run payload', async () => {
    const provider = new GitHubActionsProvider({
      request: () =>
        Promise.resolve({
          data: {
            id: 12,
            name: 'CI',
            head_sha: 'run-head',
            status: 'completed',
            conclusion: 'failure',
            created_at: '2025-01-01',
            updated_at: '2025-01-02',
            pull_requests: [
              {
                number: 42,
                head: { sha: 'pr-head' },
                base: { sha: 'pr-base' },
              },
            ],
          },
        }),
    });
    await expect(
      provider.getRun({ repository: { owner: 'a', name: 'b' }, runId: '12' }),
    ).resolves.toMatchObject({
      pullRequest: { number: 42, headSha: 'pr-head', baseSha: 'pr-base' },
    });
  });

  it('uses GitHub server-side branch and conclusion filters', async () => {
    const request = vi.fn().mockResolvedValue({ data: { workflow_runs: [] } });
    const provider = new GitHubActionsProvider({ request });
    await provider.listRuns({
      repository: { owner: 'a', name: 'b' },
      branch: 'feature/foo',
      conclusion: 'failure',
      limit: 5,
    });
    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/actions/runs',
      expect.objectContaining({
        branch: 'feature/foo',
        status: 'failure',
        per_page: 5,
      }),
    );
  });

  it('resolves pull request head and base SHAs from the pull endpoint', async () => {
    const request = vi.fn().mockResolvedValue({
      data: { number: 42, head: { sha: 'head' }, base: { sha: 'base' } },
    });
    const provider = new GitHubActionsProvider({ request });
    await expect(
      provider.getPullRequest({
        repository: { owner: 'a', name: 'b' },
        pullRequestNumber: 42,
      }),
    ).resolves.toEqual({ number: 42, headSha: 'head', baseSha: 'base' });
    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      expect.objectContaining({ pull_number: 42 }),
    );
  });
});
