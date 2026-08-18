import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractLogEvidence,
  getExtractionProfile,
  parseLogEvidence,
} from './index.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/logs/${name}`, import.meta.url), 'utf8');

const categories = (
  name: string,
  profile: Parameters<typeof parseLogEvidence>[1],
) => parseLogEvidence(fixture(name), profile).map(({ category }) => category);

describe('deterministic extraction profiles', () => {
  it('keeps generic extraction as the default', () => {
    expect(extractLogEvidence(fixture('generic-error.txt')).errorLines).toEqual(
      ['fatal: validation crashed'],
    );
    expect(getExtractionProfile().name).toBe('generic');
  });

  it('recognizes Maven compilation and build failures', () => {
    const found = categories('maven-compilation-error.txt', 'java-maven');
    expect(found).toContain('compile-error');
    expect(found).toContain('build-failure');
  });

  it('recognizes Surefire test failures and Java cause chains', () => {
    const evidence = parseLogEvidence(
      fixture('maven-test-failure.txt'),
      'java-maven',
    );
    expect(evidence.map(({ category }) => category)).toContain('test-failure');
    expect(
      evidence.some(({ message }) => message.startsWith('Caused by:')),
    ).toBe(true);
    expect(
      evidence.some(({ message }) => message.trimStart().startsWith('at ')),
    ).toBe(true);
  });

  it('recognizes Spring context and bean failures', () => {
    const evidence = parseLogEvidence(
      fixture('spring-context-failure.txt'),
      'java-spring',
    );
    expect(
      evidence.filter(({ category }) => category === 'application-context'),
    ).toHaveLength(4);
  });

  it('recognizes pnpm, npm lifecycle, and TypeScript failures', () => {
    const found = categories('pnpm-error.txt', 'node-pnpm');
    expect(
      found.filter((category) => category === 'package-manager'),
    ).toHaveLength(3);
    expect(found).toContain('compile-error');
  });

  it('recognizes Jest/Vitest-style test failures', () => {
    expect(categories('node-test-failure.txt', 'node-pnpm')).toContain(
      'test-failure',
    );
  });

  it('composes generic evidence, deduplicates overlaps, and orders by line', () => {
    const evidence = parseLogEvidence(
      'panic: generic\nBUILD FAILURE\nCaused by: boom',
      'java-spring',
    );
    expect(evidence.some(({ parser }) => parser === 'generic')).toBe(true);
    expect(evidence.map(({ lineNumber }) => lineNumber)).toEqual([1, 2, 3]);
    expect(
      new Set(
        evidence.map(({ lineNumber, message }) => `${lineNumber}:${message}`),
      ).size,
    ).toBe(evidence.length);
  });
});
