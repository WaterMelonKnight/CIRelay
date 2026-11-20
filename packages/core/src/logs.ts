import {
  parseLogEvidence,
  type ExtractionProfileName,
  type ParsedEvidenceLine,
} from './extraction-profiles.js';
import type { ExtractionOptions } from './config.js';

const STACK_PATTERN =
  /^\s*(?:at\s+.+|File\s+".+",\s+line\s+\d+|Caused by:|[A-Za-z_$][\w.$]*(?:Error|Exception):)/;

/**
 * GitHub's Actions log endpoints return every line prefixed with an RFC3339 UTC
 * timestamp (e.g. `2026-11-20T04:12:33.1234567Z `). Anchored evidence patterns
 * such as `^\s*at ...` never match that shape, so stack traces and exception
 * headers are silently dropped. Stripping the prefix keeps one line per input
 * line, so reported line numbers still refer to the original log.
 */
/**
 * Stack frames are the single largest source of duplicate evidence: a failing
 * surefire/Spring test emits dozens of frames, and each one becomes an evidence
 * entry plus a stack candidate. The contract calls these "candidates", so the
 * list is capped; order is preserved because evidence is sorted by line number.
 */
const DEFAULT_MAX_STACK_CANDIDATES = 12;

const STACK_FRAME = /^\s*(?:at\s|File\s+".+",\s*line\s+\d+)/;

function capStackCandidates<T>(
  items: T[],
  messageOf: (item: T) => string,
): T[] {
  let frames = 0;
  return items.filter((item) => {
    if (!STACK_FRAME.test(messageOf(item))) return true;
    frames += 1;
    return frames <= DEFAULT_MAX_STACK_CANDIDATES;
  });
}

const ACTIONS_LOG_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;

export function stripActionsLogPrefix(log: string): string {
  return log
    .split(/\r?\n/)
    .map((line) => line.replace(ACTIONS_LOG_PREFIX, ''))
    .join('\n');
}

export interface ExtractedLogEvidence {
  excerpt: string;
  errorLines: string[];
  stackTraceCandidates: string[];
  evidence: ParsedEvidenceLine[];
}

export function extractLogEvidence(
  log: string,
  maxLinesOrOptions: number | Partial<ExtractionOptions> = 80,
  profile: ExtractionProfileName = 'generic',
): ExtractedLogEvidence {
  const options =
    typeof maxLinesOrOptions === 'number'
      ? {
          profile,
          maxExcerptLines: maxLinesOrOptions,
          contextBefore: 2,
          contextAfter: 4,
          includePatterns: [],
          excludePatterns: [],
        }
      : {
          profile: maxLinesOrOptions.profile ?? 'generic',
          maxExcerptLines: maxLinesOrOptions.maxExcerptLines ?? 80,
          contextBefore: maxLinesOrOptions.contextBefore ?? 2,
          contextAfter: maxLinesOrOptions.contextAfter ?? 4,
          includePatterns: maxLinesOrOptions.includePatterns ?? [],
          excludePatterns: maxLinesOrOptions.excludePatterns ?? [],
        };
  const normalized = stripActionsLogPrefix(log);
  const lines = normalized.split(/\r?\n/);
  const excluded = (line: string) =>
    options.excludePatterns.some((pattern) => line.includes(pattern));
  const builtIn = parseLogEvidence(normalized, options.profile).filter(
    ({ message }) => !excluded(message),
  );
  const included: ParsedEvidenceLine[] = lines.flatMap((message, index) =>
    !excluded(message) &&
    options.includePatterns.some((pattern) => message.includes(pattern))
      ? [
          {
            lineNumber: index + 1,
            message,
            kind: 'error-line',
            parser: 'repository-config',
            category: 'repository-rule',
          },
        ]
      : [],
  );
  const deduped = [
    ...new Map(
      [...builtIn, ...included].map((item) => [
        `${item.lineNumber}\0${item.message}`,
        item,
      ]),
    ).values(),
  ].sort((a, b) => a.lineNumber - b.lineNumber);
  const evidence = capStackCandidates(deduped, (item) => item.message);
  const errorIndexes = evidence.map(({ lineNumber }) => lineNumber - 1);
  const selected = new Set<number>();
  for (const index of errorIndexes) {
    for (
      let cursor = Math.max(0, index - options.contextBefore);
      cursor <= Math.min(lines.length - 1, index + options.contextAfter);
      cursor += 1
    )
      selected.add(cursor);
  }
  const excerpt = [...selected]
    .slice(0, options.maxExcerptLines)
    .map((index) => lines[index])
    .join('\n');
  return {
    excerpt,
    errorLines: evidence
      .filter(({ kind }) => kind === 'error-line')
      .map(({ message }) => message),
    stackTraceCandidates: capStackCandidates(
      [
        ...new Set([
          ...lines.filter(
            (line) => STACK_PATTERN.test(line) && !excluded(line),
          ),
          ...evidence
            .filter(({ kind }) => kind === 'stack-trace')
            .map(({ message }) => message),
        ]),
      ],
      (line) => line,
    ),
    evidence,
  };
}
