import { describe, expect, it, vi } from 'vitest';
import { GitHubActionsProvider } from './github-actions-provider.js';

const repository = { owner: 'water', name: 'relay' };
const notFound = () => Object.assign(new Error('not found'), { status: 404 });

describe('GitHub repository config source', () => {
  it('reads canonical config at the explicit commit SHA', async () => {
    const request = vi.fn(() =>
      Promise.resolve({
        data: {
          encoding: 'base64',
          content: Buffer.from(
            'version: 1\nextractionProfile: java-spring',
          ).toString('base64'),
        },
      }),
    );
    await expect(
      new GitHubActionsProvider({ request }).getConfig(repository, 'run-sha'),
    ).resolves.toMatchObject({ extractionProfile: 'java-spring' });
    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/contents/{path}',
      expect.objectContaining({ path: '.cirelay.yml', ref: 'run-sha' }),
    );
  });

  it('maps absent yml and yaml files to undefined', async () => {
    const request = vi.fn(() => Promise.reject(notFound()));
    await expect(
      new GitHubActionsProvider({ request }).getConfig(repository, 'sha'),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('surfaces malformed content as a typed config error without fallback', async () => {
    const request = vi.fn(() =>
      Promise.resolve({
        data: {
          encoding: 'base64',
          content: Buffer.from('version: 9').toString('base64'),
        },
      }),
    );
    await expect(
      new GitHubActionsProvider({ request }).getConfig(repository, 'sha'),
    ).rejects.toMatchObject({ code: 'unsupported-version' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
