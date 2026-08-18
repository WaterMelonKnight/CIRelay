import type { LogSource, LogSourcePolicy } from './log-source.js';
import type { RepositoryRef } from './types.js';

export const JOB_LOG_SEARCH_LIMITS = {
  patternCount: 20,
  patternLength: 200,
  contextLines: 20,
  maxMatches: 100,
} as const;

export interface JobLogSearchQuery {
  repository: RepositoryRef;
  jobId: string;
  patterns: string[];
  excludePatterns?: string[];
  contextBefore?: number;
  contextAfter?: number;
  maxMatches?: number;
  sourcePolicy?: LogSourcePolicy;
}

export interface JobLogMatch {
  lineNumber: number;
  line: string;
  matchedPatterns: string[];
  context: {
    startLine: number;
    lines: string[];
  };
}

export interface JobLogSearchResult {
  repository: RepositoryRef;
  jobId: string;
  sourcePolicy: LogSourcePolicy;
  matches: JobLogMatch[];
  matchCount: number;
  truncated: boolean;
}

export class LogSearchError extends Error {
  readonly code = 'invalid-log-search';

  constructor(message: string) {
    super(message);
    this.name = 'LogSearchError';
  }
}

function boundedInteger(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new LogSearchError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
}

function validatePatterns(name: string, patterns: string[]): void {
  if (patterns.length > JOB_LOG_SEARCH_LIMITS.patternCount) {
    throw new LogSearchError(
      `${name} cannot contain more than ${JOB_LOG_SEARCH_LIMITS.patternCount} values`,
    );
  }
  if (
    patterns.some(
      (pattern) =>
        pattern.length === 0 ||
        pattern.length > JOB_LOG_SEARCH_LIMITS.patternLength,
    )
  ) {
    throw new LogSearchError(
      `${name} values must contain 1-${JOB_LOG_SEARCH_LIMITS.patternLength} characters`,
    );
  }
}

/** Searches one raw CI job log using deterministic, case-insensitive literals. */
export async function searchJobLog(
  logSource: LogSource,
  query: JobLogSearchQuery,
): Promise<JobLogSearchResult> {
  if (!query.repository.owner || !query.repository.name || !query.jobId) {
    throw new LogSearchError(
      'repository owner, repository name, and jobId are required',
    );
  }
  if (query.patterns.length === 0) {
    throw new LogSearchError('patterns must contain at least one value');
  }
  validatePatterns('patterns', query.patterns);
  const excludePatterns = query.excludePatterns ?? [];
  validatePatterns('excludePatterns', excludePatterns);

  const contextBefore = query.contextBefore ?? 2;
  const contextAfter = query.contextAfter ?? 4;
  const maxMatches = query.maxMatches ?? 20;
  boundedInteger(
    'contextBefore',
    contextBefore,
    0,
    JOB_LOG_SEARCH_LIMITS.contextLines,
  );
  boundedInteger(
    'contextAfter',
    contextAfter,
    0,
    JOB_LOG_SEARCH_LIMITS.contextLines,
  );
  boundedInteger('maxMatches', maxMatches, 1, JOB_LOG_SEARCH_LIMITS.maxMatches);

  const sourcePolicy = query.sourcePolicy ?? 'prefer-cache';
  const rawLog = await logSource.getJobLog(
    { repository: query.repository, jobId: query.jobId },
    { policy: sourcePolicy },
  );
  const lines = rawLog.split(/\r?\n/);
  const normalizedExclusions = excludePatterns.map((pattern) =>
    pattern.toLowerCase(),
  );
  const matches: JobLogMatch[] = [];
  let matchCount = 0;

  for (const [index, line] of lines.entries()) {
    const normalizedLine = line.toLowerCase();
    if (
      normalizedExclusions.some((pattern) => normalizedLine.includes(pattern))
    )
      continue;
    const matchedPatterns = query.patterns.filter((pattern) =>
      normalizedLine.includes(pattern.toLowerCase()),
    );
    if (matchedPatterns.length === 0) continue;
    matchCount += 1;
    if (matches.length < maxMatches) {
      const start = Math.max(0, index - contextBefore);
      const end = Math.min(lines.length, index + contextAfter + 1);
      matches.push({
        lineNumber: index + 1,
        line,
        matchedPatterns,
        context: { startLine: start + 1, lines: lines.slice(start, end) },
      });
    }
  }

  return {
    repository: query.repository,
    jobId: query.jobId,
    sourcePolicy,
    matches,
    matchCount,
    truncated: matchCount > matches.length,
  };
}
