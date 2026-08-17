import { describe, expect, it } from 'vitest';
import { parseGitHubFailureEvent } from './events.js';

describe('webhook event boundary', () => {
  it('maps a workflow_run failure fixture', () =>
    expect(
      parseGitHubFailureEvent('workflow_run', {
        action: 'completed',
        repository: { name: 'cirelay', owner: { login: 'watermelon' } },
        workflow_run: {
          id: 42,
          conclusion: 'failure',
          updated_at: '2025-01-01T00:00:00Z',
        },
      }),
    ).toMatchObject({ type: 'ci.failure', runId: '42' }));
  it('ignores successful runs', () =>
    expect(
      parseGitHubFailureEvent('workflow_run', {
        action: 'completed',
        repository: { name: 'cirelay', owner: { login: 'watermelon' } },
        workflow_run: {
          id: 42,
          conclusion: 'success',
          updated_at: '2025-01-01T00:00:00Z',
        },
      }),
    ).toBeUndefined());
});
