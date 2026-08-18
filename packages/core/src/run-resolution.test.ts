import { describe, expect, it, vi } from 'vitest';
import type { CiProvider, CiRun } from './types.js';
import {
  resolveRuns,
  resolveSingleRun,
  RunResolutionError,
} from './run-resolution.js';

const repository = { owner: 'watermelon', name: 'cirelay' };
const run = (
  id: string,
  createdAt: string,
  conclusion: CiRun['conclusion'] = 'failure',
): CiRun => ({
  id,
  provider: 'fixture',
  repository,
  name: 'CI',
  commit: { sha: 'head' },
  status: 'completed',
  conclusion,
  createdAt,
  updatedAt: createdAt,
});
const provider = (runs: CiRun[] = []): CiProvider => {
  const listRuns = vi.fn().mockResolvedValue(runs);
  return {
    name: 'fixture',
    listRuns,
    getRun: vi.fn().mockResolvedValue(run('exact', '2026-01-01T00:00:00Z')),
    listJobs: vi.fn().mockResolvedValue([]),
    getJobLog: vi.fn().mockResolvedValue(''),
  };
};

describe('run resolution', () => {
  it('retrieves an explicit run without listing repository runs', async () => {
    const fixture = provider();
    await expect(
      resolveRuns(fixture, { repository, runId: 'exact' }),
    ).resolves.toMatchObject([{ id: 'exact' }]);
    // The fixture method is a Vitest spy and does not use `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(fixture.listRuns).not.toHaveBeenCalled();
  });

  it('passes commit and branch selectors to the provider', async () => {
    const fixture = provider([run('1', '2026-01-01T00:00:00Z')]);
    await resolveRuns(fixture, { repository, commitSha: 'abc' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(fixture.listRuns).toHaveBeenLastCalledWith({
      repository,
      commitSha: 'abc',
    });
    await resolveRuns(fixture, { repository, branch: 'feature/foo' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(fixture.listRuns).toHaveBeenLastCalledWith({
      repository,
      branch: 'feature/foo',
    });
  });

  it('resolves a PR head, selects the latest failure, and attaches PR metadata', async () => {
    const fixture = provider([
      run('older', '2026-01-01T00:00:00Z'),
      run('success', '2026-01-03T00:00:00Z', 'success'),
      run('newer', '2026-01-02T00:00:00Z'),
    ]);
    fixture.getPullRequest = vi.fn().mockResolvedValue({
      number: 42,
      headSha: 'pr-head',
      baseSha: 'base',
    });
    await expect(
      resolveRuns(fixture, {
        repository,
        pullRequestNumber: 42,
        conclusion: 'failure',
        latest: true,
      }),
    ).resolves.toMatchObject([{ id: 'newer', pullRequest: { number: 42 } }]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(fixture.listRuns).toHaveBeenCalledWith({
      repository,
      commitSha: 'pr-head',
      conclusion: 'failure',
    });
  });

  it('reports no matches and ambiguous single-run requests', async () => {
    await expect(resolveRuns(provider(), { repository })).rejects.toMatchObject(
      {
        code: 'no-matching-run',
      },
    );
    await expect(
      resolveSingleRun(
        provider([
          run('1', '2026-01-01T00:00:00Z'),
          run('2', '2026-01-02T00:00:00Z'),
        ]),
        { repository },
      ),
    ).rejects.toMatchObject({ code: 'multiple-matching-runs' });
  });

  it('rejects ambiguous selectors with a domain error', async () => {
    await expect(
      resolveRuns(provider(), { repository, commitSha: 'a', branch: 'main' }),
    ).rejects.toBeInstanceOf(RunResolutionError);
  });
});
