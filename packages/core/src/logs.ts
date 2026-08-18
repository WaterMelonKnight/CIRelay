import {
  parseLogEvidence,
  type ExtractionProfileName,
  type ParsedEvidenceLine,
} from './extraction-profiles.js';

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
  maxLines = 80,
  profile: ExtractionProfileName = 'generic',
): ExtractedLogEvidence {
  const lines = log.split(/\r?\n/);
  const evidence = parseLogEvidence(log, profile);
  const errorIndexes = evidence.map(({ lineNumber }) => lineNumber - 1);
  const selected = new Set<number>();
  for (const index of errorIndexes) {
    for (
      let cursor = Math.max(0, index - 2);
      cursor <= Math.min(lines.length - 1, index + 4);
      cursor += 1
    )
      selected.add(cursor);
  }
  const excerpt = [...selected]
    .slice(0, maxLines)
    .map((index) => lines[index])
    .join('\n');
  return {
    excerpt,
    errorLines: evidence
      .filter(({ kind }) => kind === 'error-line')
      .map(({ message }) => message),
    stackTraceCandidates: [
      ...new Set([
        ...lines.filter((line) => STACK_PATTERN.test(line)),
        ...evidence
          .filter(({ kind }) => kind === 'stack-trace')
          .map(({ message }) => message),
      ]),
    ],
    evidence,
  };
}
