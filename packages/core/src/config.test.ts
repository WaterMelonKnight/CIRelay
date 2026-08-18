import { describe, expect, it } from 'vitest';
import {
  CONFIG_LIMITS,
  parseCiRelayConfig,
  resolveExtractionOptions,
} from './config.js';
import { extractLogEvidence } from './logs.js';

describe('repository configuration', () => {
  it('parses minimal and framework-aware YAML', () => {
    expect(parseCiRelayConfig('version: 1')).toEqual({ version: 1 });
    expect(
      parseCiRelayConfig(`version: 1
extractionProfile: java-spring
logExtraction:
  include: ["PAY-"]
  exclude: ["harmless"]
  context: { before: 3, after: 6 }
  maxExcerptLines: 100`),
    ).toMatchObject({
      extractionProfile: 'java-spring',
      logExtraction: { include: ['PAY-'], context: { before: 3, after: 6 } },
    });
  });

  it.each([
    ['unsupported version', 'version: 2', 'unsupported-version'],
    ['profile', 'version: 1\nextractionProfile: magic', 'invalid-config'],
    [
      'include count',
      `version: 1\nlogExtraction:\n  include:\n${'    - x\n'.repeat(CONFIG_LIMITS.patterns + 1)}`,
      'invalid-config',
    ],
    [
      'exclude length',
      `version: 1\nlogExtraction:\n  exclude: ["${'x'.repeat(CONFIG_LIMITS.patternLength + 1)}"]`,
      'invalid-config',
    ],
    [
      'context',
      `version: 1\nlogExtraction:\n  context: { before: -1 }`,
      'invalid-config',
    ],
    [
      'excerpt',
      `version: 1\nlogExtraction:\n  maxExcerptLines: 0`,
      'invalid-config',
    ],
    ['malformed YAML', 'version: [', 'invalid-config'],
  ])('rejects invalid %s with a typed error', (_name, yaml, code) => {
    try {
      parseCiRelayConfig(yaml);
      throw new Error('expected configuration rejection');
    } catch (error) {
      expect(error).toMatchObject({ name: 'CiRelayConfigError', code });
    }
  });

  it('composes defaults, repository policy, then invocation options', () => {
    const repositoryConfig = parseCiRelayConfig(
      'version: 1\nextractionProfile: java-spring\nlogExtraction:\n  context: { before: 7 }',
    );
    expect(resolveExtractionOptions({ repositoryConfig })).toMatchObject({
      profile: 'java-spring',
      contextBefore: 7,
      contextAfter: 4,
      maxExcerptLines: 80,
    });
    expect(
      resolveExtractionOptions({
        repositoryConfig,
        invocationOptions: { profile: 'node-pnpm' },
      }).profile,
    ).toBe('node-pnpm');
  });

  it('adds literal evidence, suppresses excluded candidates, and applies excerpt options', () => {
    const log = [
      'zero',
      'before',
      'PAY-123 connection refused',
      'after',
      'Known harmless warning ERROR',
    ].join('\n');
    const result = extractLogEvidence(log, {
      includePatterns: ['PAY-'],
      excludePatterns: ['Known harmless warning'],
      contextBefore: 1,
      contextAfter: 0,
      maxExcerptLines: 2,
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({
        lineNumber: 3,
        parser: 'repository-config',
        category: 'repository-rule',
      }),
    ]);
    expect(result.excerpt).toBe('before\nPAY-123 connection refused');
    expect(result.errorLines).not.toContain('Known harmless warning ERROR');
  });
});
