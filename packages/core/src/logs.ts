import {
  parseLogEvidence,
  type ExtractionProfileName,
  type ParsedEvidenceLine,
} from './extraction-profiles.js';
import type { ExtractionOptions } from './config.js';

const STACK_PATTERN =
  /^\s*(?:at\s+.+|File\s+".+",\s+line\s+\d+|Caused by:|[A-Za-z_$][\w.$]*(?:Error|Exception):)/;

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
  const lines = log.split(/\r?\n/);
  const excluded = (line: string) =>
    options.excludePatterns.some((pattern) => line.includes(pattern));
  const builtIn = parseLogEvidence(log, options.profile).filter(
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
  const evidence = [
    ...new Map(
      [...builtIn, ...included].map((item) => [
        `${item.lineNumber}\0${item.message}`,
        item,
      ]),
    ).values(),
  ].sort((a, b) => a.lineNumber - b.lineNumber);
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
    stackTraceCandidates: [
      ...new Set([
        ...lines.filter((line) => STACK_PATTERN.test(line) && !excluded(line)),
        ...evidence
          .filter(({ kind }) => kind === 'stack-trace')
          .map(({ message }) => message),
      ]),
    ],
    evidence,
  };
}
