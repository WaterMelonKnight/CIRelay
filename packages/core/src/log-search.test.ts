import { describe, expect, it, vi } from 'vitest';
import {
  CachedLogSource,
  LogSourceError,
  MemoryJobLogCache,
} from './log-source.js';
import { LogSearchError, searchJobLog } from './log-search.js';
import type { CiProvider } from './types.js';

const repository = { owner: 'acme', name: 'app' };
const unused = () => Promise.reject(new Error('unused'));

function setup(log: string) {
  const getJobLog = vi.fn(() => Promise.resolve(log));
  const provider: CiProvider = {
    name: 'fixture',
    listRuns: unused,
    getRun: unused,
    listJobs: unused,
    getJobLog,
  };
  return {
    getJobLog,
    source: new CachedLogSource(provider, new MemoryJobLogCache()),
  };
}

describe('searchJobLog', () => {
  it('matches literals case-insensitively with OR semantics and preserves text', async () => {
    const { source } = setup(
      'ready\nPostgreSQL unavailable\nconnection REFUSED\ndone',
    );
    const result = await searchJobLog(source, {
      repository,
      jobId: '123',
      patterns: ['postgres', 'connection refused'],
      contextBefore: 0,
      contextAfter: 0,
    });

    expect(result.matches).toMatchObject([
      {
        lineNumber: 2,
        line: 'PostgreSQL unavailable',
        matchedPatterns: ['postgres'],
      },
      {
        lineNumber: 3,
        line: 'connection REFUSED',
        matchedPatterns: ['connection refused'],
      },
    ]);
    expect(result.matchCount).toBe(2);
  });

  it('returns no matches without leaking the raw log', async () => {
    const { source } = setup('secret value');
    await expect(
      searchJobLog(source, { repository, jobId: '1', patterns: ['missing'] }),
    ).resolves.toMatchObject({ matches: [], matchCount: 0, truncated: false });
  });

  it('returns bounded context around matches', async () => {
    const { source } = setup('one\ntwo\nERROR\nfour\nfive');
    const result = await searchJobLog(source, {
      repository,
      jobId: '1',
      patterns: ['error'],
      contextBefore: 1,
      contextAfter: 2,
    });
    expect(result.matches[0]?.context).toEqual({
      startLine: 2,
      lines: ['two', 'ERROR', 'four', 'five'],
    });
  });

  it('keeps overlapping matches individually bounded', async () => {
    const { source } = setup('hit\nhit\nhit\nhit\nhit');
    const result = await searchJobLog(source, {
      repository,
      jobId: '1',
      patterns: ['hit'],
      contextBefore: 2,
      contextAfter: 2,
      maxMatches: 2,
    });
    expect(result.matches).toHaveLength(2);
    expect(
      result.matches.every(({ context }) => context.lines.length <= 5),
    ).toBe(true);
    expect(result).toMatchObject({ matchCount: 5, truncated: true });
  });

  it('suppresses candidate lines containing exclusion literals', async () => {
    const { source } = setup(
      'warning: Known harmless warning\ntimeout: real failure',
    );
    const result = await searchJobLog(source, {
      repository,
      jobId: '1',
      patterns: ['warning', 'timeout'],
      excludePatterns: ['known harmless warning'],
      contextBefore: 0,
      contextAfter: 0,
    });
    expect(result.matches).toMatchObject([
      { lineNumber: 2, line: 'timeout: real failure' },
    ]);
  });

  it('truncates deterministically at maxMatches', async () => {
    const { source } = setup('error 1\nerror 2\nerror 3');
    const result = await searchJobLog(source, {
      repository,
      jobId: '1',
      patterns: ['error'],
      maxMatches: 2,
    });
    expect(result.matches.map(({ lineNumber }) => lineNumber)).toEqual([1, 2]);
    expect(result).toMatchObject({ matchCount: 3, truncated: true });
  });

  it('reuses one cached raw log for different prefer-cache searches', async () => {
    const { source, getJobLog } = setup('postgres\nport 5432');
    await searchJobLog(source, {
      repository,
      jobId: '1',
      patterns: ['postgres'],
    });
    await searchJobLog(source, { repository, jobId: '1', patterns: ['5432'] });
    expect(getJobLog).toHaveBeenCalledTimes(1);
  });

  it('supports cache-only hits and typed cache misses', async () => {
    const { source, getJobLog } = setup('postgres');
    await searchJobLog(source, {
      repository,
      jobId: '1',
      patterns: ['postgres'],
    });
    await expect(
      searchJobLog(source, {
        repository,
        jobId: '1',
        patterns: ['postgres'],
        sourcePolicy: 'cache-only',
      }),
    ).resolves.toMatchObject({ matchCount: 1, sourcePolicy: 'cache-only' });
    await expect(
      searchJobLog(source, {
        repository,
        jobId: 'missing',
        patterns: ['postgres'],
        sourcePolicy: 'cache-only',
      }),
    ).rejects.toBeInstanceOf(LogSourceError);
    expect(getJobLog).toHaveBeenCalledTimes(1);
  });

  it('refresh forces provider retrieval', async () => {
    const { source, getJobLog } = setup('postgres');
    await searchJobLog(source, {
      repository,
      jobId: '1',
      patterns: ['postgres'],
    });
    await searchJobLog(source, {
      repository,
      jobId: '1',
      patterns: ['postgres'],
      sourcePolicy: 'refresh',
    });
    expect(getJobLog).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ patterns: [] }, 'patterns'],
    [{ patterns: ['x'], contextBefore: 21 }, 'contextBefore'],
    [{ patterns: ['x'], contextAfter: -1 }, 'contextAfter'],
    [{ patterns: ['x'], maxMatches: 101 }, 'maxMatches'],
    [{ patterns: Array.from({ length: 21 }, () => 'x') }, 'patterns'],
  ])('rejects invalid bounded input %#', async (partial, message) => {
    const { source, getJobLog } = setup('unused');
    await expect(
      searchJobLog(source, { repository, jobId: '1', ...partial }),
    ).rejects.toThrow(message);
    expect(getJobLog).not.toHaveBeenCalled();
  });

  it('exports a typed invalid-search error', () => {
    expect(new LogSearchError('bad')).toMatchObject({
      code: 'invalid-log-search',
    });
  });
});
