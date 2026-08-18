import { describe, expect, it, vi } from 'vitest';
import {
  CachedLogSource,
  LogSourceError,
  MemoryJobLogCache,
  type CiProvider,
  type JobLogCacheKey,
} from './index.js';

function provider(getJobLog: () => Promise<string>): CiProvider {
  return {
    name: 'fixture',
    listRuns: () => Promise.resolve([]),
    getRun: () => Promise.reject(new Error('unused')),
    listJobs: () => Promise.resolve([]),
    getJobLog,
  };
}

const input = {
  repository: { owner: 'acme', name: 'app' },
  jobId: '9',
};
const key: JobLogCacheKey = {
  provider: 'fixture',
  repository: input.repository,
  jobId: input.jobId,
};

describe('CachedLogSource', () => {
  it('fetches and caches a prefer-cache miss, then reuses the hit', async () => {
    const getJobLog = vi.fn(() => Promise.resolve('remote'));
    const cache = new MemoryJobLogCache();
    const source = new CachedLogSource(provider(getJobLog), cache);

    await expect(source.getJobLog(input)).resolves.toBe('remote');
    await expect(source.getJobLog(input)).resolves.toBe('remote');
    await expect(cache.get(key)).resolves.toBe('remote');
    expect(getJobLog).toHaveBeenCalledTimes(1);
  });

  it('returns a cache-only hit without remote access', async () => {
    const getJobLog = vi.fn(() => Promise.resolve('remote'));
    const cache = new MemoryJobLogCache();
    await cache.set(key, 'cached');

    await expect(
      new CachedLogSource(provider(getJobLog), cache).getJobLog(input, {
        policy: 'cache-only',
      }),
    ).resolves.toBe('cached');
    expect(getJobLog).not.toHaveBeenCalled();
  });

  it('raises a typed cache miss without remote access', async () => {
    const getJobLog = vi.fn(() => Promise.resolve('remote'));
    const source = new CachedLogSource(
      provider(getJobLog),
      new MemoryJobLogCache(),
    );

    const error = await source
      .getJobLog(input, { policy: 'cache-only' })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(LogSourceError);
    expect(error).toMatchObject({ code: 'cache-miss' });
    expect(getJobLog).not.toHaveBeenCalled();
  });

  it('always refreshes and overwrites cached data', async () => {
    const getJobLog = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('fresh-1')
      .mockResolvedValueOnce('fresh-2');
    const cache = new MemoryJobLogCache();
    await cache.set(key, 'stale');
    const source = new CachedLogSource(provider(getJobLog), cache);

    await expect(source.getJobLog(input, { policy: 'refresh' })).resolves.toBe(
      'fresh-1',
    );
    await expect(source.getJobLog(input, { policy: 'refresh' })).resolves.toBe(
      'fresh-2',
    );
    await expect(cache.get(key)).resolves.toBe('fresh-2');
    expect(getJobLog).toHaveBeenCalledTimes(2);
  });

  it('does not collide across providers, repositories, or jobs', async () => {
    const cache = new MemoryJobLogCache();
    const keys: JobLogCacheKey[] = [
      key,
      { ...key, provider: 'other' },
      { ...key, repository: { owner: 'acme', name: 'other' } },
      { ...key, jobId: '10' },
    ];
    await Promise.all(keys.map((item, index) => cache.set(item, `${index}`)));

    await expect(
      Promise.all(keys.map((item) => cache.get(item))),
    ).resolves.toEqual(['0', '1', '2', '3']);
  });
});
