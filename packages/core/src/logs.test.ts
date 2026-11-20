import { describe, expect, it } from 'vitest';
import { extractLogEvidence, stripActionsLogPrefix } from './logs.js';

const PREFIXED = [
  '2026-11-20T04:12:33.1234567Z ##[group]Run mvn -B -ntp test',
  '2026-11-20T04:12:33.2234567Z [ERROR] /repo/src/main/java/App.java:[5,23] cannot find symbol',
  '2026-11-20T04:12:33.3234567Z java.lang.NullPointerException: boom',
  '2026-11-20T04:12:33.4234567Z \tat com.example.App.run(App.java:12)',
  '2026-11-20T04:12:33.5234567Z ##[error]Process completed with exit code 1.',
].join('\n');

describe('stripActionsLogPrefix', () => {
  it('removes the timestamp prefix without changing line count', () => {
    const stripped = stripActionsLogPrefix(PREFIXED);
    expect(stripped.split('\n')).toHaveLength(5);
    expect(stripped.split('\n')[1]).toBe(
      '[ERROR] /repo/src/main/java/App.java:[5,23] cannot find symbol',
    );
  });

  it('leaves logs without a prefix untouched', () => {
    const plain =
      '[ERROR] BUILD FAILURE\n\tat com.example.App.run(App.java:12)';
    expect(stripActionsLogPrefix(plain)).toBe(plain);
  });
});

describe('extractLogEvidence', () => {
  it('finds Java stack-trace lines in GitHub Actions logs', () => {
    const result = extractLogEvidence(PREFIXED, { profile: 'java-spring' });
    const messages = result.evidence.map(({ message }) => message);
    expect(messages).toContain('java.lang.NullPointerException: boom');
    expect(messages).toContain('\tat com.example.App.run(App.java:12)');
    expect(result.stackTraceCandidates).toContain(
      '\tat com.example.App.run(App.java:12)',
    );
  });

  it('reports line numbers that still match the raw log', () => {
    const result = extractLogEvidence(PREFIXED, { profile: 'java-spring' });
    const compile = result.evidence.find(({ message }) =>
      message.includes('cannot find symbol'),
    );
    expect(compile?.lineNumber).toBe(2);
  });
});
