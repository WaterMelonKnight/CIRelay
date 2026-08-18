import type { CiProvider, JobInput, RepositoryRef } from './types.js';

/** Controls where a raw job log is retrieved from. */
export type LogSourcePolicy = 'prefer-cache' | 'cache-only' | 'refresh';

/** Identifies the provider retrieval unit without depending on a provider API. */
export interface JobLogCacheKey {
  provider: string;
  repository: RepositoryRef;
  jobId: string;
}

export interface JobLogCache {
  get(key: JobLogCacheKey): Promise<string | undefined>;
  set(key: JobLogCacheKey, value: string): Promise<void>;
  delete?(key: JobLogCacheKey): Promise<void>;
}

export class LogSourceError extends Error {
  readonly code: 'cache-miss';

  constructor(code: 'cache-miss', message: string) {
    super(message);
    this.name = 'LogSourceError';
    this.code = code;
  }
}

function serializeKey(key: JobLogCacheKey): string {
  return JSON.stringify([
    key.provider,
    key.repository.owner,
    key.repository.name,
    key.jobId,
  ]);
}

/** Ephemeral, process-local storage for raw job logs. */
export class MemoryJobLogCache implements JobLogCache {
  private readonly entries = new Map<string, string>();

  get(key: JobLogCacheKey): Promise<string | undefined> {
    return Promise.resolve(this.entries.get(serializeKey(key)));
  }

  set(key: JobLogCacheKey, value: string): Promise<void> {
    this.entries.set(serializeKey(key), value);
    return Promise.resolve();
  }

  delete(key: JobLogCacheKey): Promise<void> {
    this.entries.delete(serializeKey(key));
    return Promise.resolve();
  }
}

export interface LogSource {
  getJobLog(
    input: JobInput,
    options?: { policy?: LogSourcePolicy },
  ): Promise<string>;
}

/** Applies cache/freshness policy while leaving remote transport to CiProvider. */
export class CachedLogSource implements LogSource {
  constructor(
    private readonly provider: CiProvider,
    private readonly cache: JobLogCache,
  ) {}

  async getJobLog(
    input: JobInput,
    options: { policy?: LogSourcePolicy } = {},
  ): Promise<string> {
    const policy = options.policy ?? 'prefer-cache';
    const key: JobLogCacheKey = {
      provider: this.provider.name,
      repository: input.repository,
      jobId: input.jobId,
    };

    if (policy !== 'refresh') {
      const cached = await this.cache.get(key);
      if (cached !== undefined) return cached;
      if (policy === 'cache-only') {
        throw new LogSourceError(
          'cache-miss',
          `No cached raw log exists for ${key.provider}:${key.repository.owner}/${key.repository.name}:${key.jobId}`,
        );
      }
    }

    const log = await this.provider.getJobLog(input);
    await this.cache.set(key, log);
    return log;
  }
}
