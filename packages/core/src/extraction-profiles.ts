export type ExtractionProfileName =
  'generic' | 'java-maven' | 'java-spring' | 'node-pnpm';

export type EvidenceCategory =
  | 'generic-error'
  | 'stack-trace'
  | 'compile-error'
  | 'test-failure'
  | 'build-failure'
  | 'application-context'
  | 'package-manager';

export interface ParsedEvidenceLine {
  lineNumber: number;
  message: string;
  kind: 'error-line' | 'stack-trace';
  parser: string;
  category: EvidenceCategory;
}

export interface LogEvidenceParser {
  readonly name: string;
  parse(log: string): ParsedEvidenceLine[];
}

export interface ExtractionProfile {
  readonly name: ExtractionProfileName;
  readonly parsers: readonly LogEvidenceParser[];
}

function patternParser(
  name: string,
  patterns: readonly {
    pattern: RegExp;
    category: EvidenceCategory;
    kind?: ParsedEvidenceLine['kind'];
  }[],
): LogEvidenceParser {
  return {
    name,
    parse(log) {
      return log.split(/\r?\n/).flatMap((message, index) => {
        const match = patterns.find(({ pattern }) => pattern.test(message));
        return match
          ? [
              {
                lineNumber: index + 1,
                message,
                kind: match.kind ?? 'error-line',
                parser: name,
                category: match.category,
              },
            ]
          : [];
      });
    },
  };
}

const generic = patternParser('generic', [
  {
    pattern:
      /(?:\berror\b|\bfatal\b|\bexception\b|\bfail(?:ed|ures?|s)?\b|\bpanic\b)/i,
    category: 'generic-error',
  },
  {
    pattern:
      /^\s*(?:at\s+.+|File\s+".+",\s+line\s+\d+|Caused by:|[A-Za-z_$][\w.$]*(?:Error|Exception):)/,
    category: 'stack-trace',
    kind: 'stack-trace',
  },
]);

const java = patternParser('java', [
  {
    pattern:
      /^\s*(?:[\w.$]+(?:Error|Exception)(?::|$)|Caused by:|at\s+[\w.$]+\([^)]*\))/,
    category: 'stack-trace',
    kind: 'stack-trace',
  },
  {
    pattern:
      /\.java:\[?\d+(?:,\d+)?\]?\s*(?::|\b).*\b(?:error|cannot find symbol)\b/i,
    category: 'compile-error',
  },
]);

const maven = patternParser('maven', [
  {
    pattern:
      /(?:COMPILATION ERROR|\[ERROR\].*(?:compilation|cannot find symbol))/,
    category: 'compile-error',
  },
  {
    pattern:
      /(?:Tests run:.*(?:Failures: [1-9]|Errors: [1-9])|There are test failures|surefire|failsafe).*?(?:failure|error|Failures: [1-9]|Errors: [1-9])/i,
    category: 'test-failure',
  },
  {
    pattern: /(?:\[ERROR\]|BUILD FAILURE|Failed to execute goal)/,
    category: 'build-failure',
  },
]);

const spring = patternParser('spring', [
  {
    pattern:
      /(?:BeanCreationException|UnsatisfiedDependencyException|BeanCurrentlyInCreationException|NoSuchBeanDefinitionException|Failed to load ApplicationContext|Application run failed|ApplicationContext failure|BindException|configuration binding failure)/i,
    category: 'application-context',
  },
  {
    pattern: /^\s*Caused by:/,
    category: 'application-context',
    kind: 'stack-trace',
  },
]);

const node = patternParser('node', [
  {
    pattern: /(?:error TS\d+:|\.tsx?\(\d+,\d+\): error TS\d+:)/i,
    category: 'compile-error',
  },
  {
    pattern:
      /(?:FAIL\s+.*\.(?:test|spec)|Tests?:\s+\d+ failed|Test Files?\s+\d+ failed|\b(?:Jest|Vitest).*failed)/i,
    category: 'test-failure',
  },
  {
    pattern: /(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)/,
    category: 'package-manager',
  },
  {
    pattern: /^\s*at\s+(?:async\s+)?[\w.<>{}()[\]/:-]+/,
    category: 'stack-trace',
    kind: 'stack-trace',
  },
]);

const pnpm = patternParser('pnpm', [
  {
    pattern:
      /(?:npm ERR!|ERR_PNPM_[A-Z_]+|ELIFECYCLE|Command failed with exit code|lifecycle.*(?:fail|error))/i,
    category: 'package-manager',
  },
]);

const profiles: Record<ExtractionProfileName, ExtractionProfile> = {
  generic: { name: 'generic', parsers: [generic] },
  'java-maven': { name: 'java-maven', parsers: [maven, java, generic] },
  'java-spring': {
    name: 'java-spring',
    parsers: [spring, maven, java, generic],
  },
  'node-pnpm': { name: 'node-pnpm', parsers: [pnpm, node, generic] },
};

export function getExtractionProfile(name: ExtractionProfileName = 'generic') {
  return profiles[name];
}

export function parseLogEvidence(
  log: string,
  profileName: ExtractionProfileName = 'generic',
) {
  const matches = getExtractionProfile(profileName).parsers.flatMap((parser) =>
    parser.parse(log),
  );
  const unique = new Map<string, ParsedEvidenceLine>();
  for (const match of matches) {
    const key = `${match.lineNumber}\0${match.message}`;
    if (!unique.has(key)) unique.set(key, match);
  }
  return [...unique.values()].sort((a, b) => a.lineNumber - b.lineNumber);
}
