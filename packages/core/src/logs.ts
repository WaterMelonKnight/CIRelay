const ERROR_PATTERN =
  /(?:\berror\b|\bfatal\b|\bexception\b|\bfailed\b|\bpanic\b)/i;
const STACK_PATTERN =
  /^\s*(?:at\s+.+|File\s+".+",\s+line\s+\d+|Caused by:|[A-Za-z_$][\w.$]*(?:Error|Exception):)/;

export interface ExtractedLogEvidence {
  excerpt: string;
  errorLines: string[];
  stackTraceCandidates: string[];
}

export function extractLogEvidence(
  log: string,
  maxLines = 80,
): ExtractedLogEvidence {
  const lines = log.split(/\r?\n/);
  const errorIndexes = lines.flatMap((line, index) =>
    ERROR_PATTERN.test(line) ? [index] : [],
  );
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
    errorLines: errorIndexes
      .map((index) => lines[index])
      .filter((line): line is string => line !== undefined),
    stackTraceCandidates: lines.filter((line) => STACK_PATTERN.test(line)),
  };
}
