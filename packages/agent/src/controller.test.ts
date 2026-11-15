import { describe, expect, it, vi } from 'vitest';
import type { CiJob, CiProvider, CiRun } from '@cirelay/core';
import {
  applyAction,
  applyObservation,
  createHandlerExecutor,
  createInvestigation,
  runInvestigation,
  type InvestigationDecision,
  type InvestigationPlanner,
  type InvestigationState,
} from './index.js';

const repository = { owner: 'acme', name: 'app' };
const run: CiRun = {
  id: '42',
  provider: 'fixture',
  repository,
  name: 'CI',
  commit: { sha: 'abc' },
  status: 'completed',
  conclusion: 'failure',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  url: 'https://example.test/runs/42',
};
const job: CiJob = {
  id: '7',
  runId: '42',
  name: 'build',
  status: 'completed',
  conclusion: 'failure',
  url: 'https://example.test/jobs/7',
  steps: [
    { number: 1, name: 'compile', status: 'completed', conclusion: 'failure' },
  ],
};
const list: InvestigationDecision = {
  action: {
    kind: 'list_ci_runs',
    query: { latest: true, conclusion: 'failure' },
  },
};
const context: InvestigationDecision = {
  action: { kind: 'get_failure_context', options: {} },
};
const search = (pattern = 'service=db'): InvestigationDecision => ({
  action: {
    kind: 'search_job_logs',
    query: { jobId: '7', patterns: [pattern] },
  },
});
function fixture(log = 'ERROR: compilation failed\nhint: service=db\n') {
  return {
    name: 'fixture',
    listRuns: vi.fn(() => Promise.resolve([structuredClone(run)])),
    getRun: vi.fn(() => Promise.resolve(structuredClone(run))),
    listJobs: vi.fn(() => Promise.resolve([structuredClone(job)])),
    getJobLog: vi.fn(() => Promise.resolve(log)),
  } satisfies CiProvider;
}
function stop(
  state: InvestigationState,
  source = 'failure-context',
): InvestigationDecision {
  const fact = state.evidence.find((e) => e.source === source);
  if (!fact) throw Error('Fixture expected evidence');
  return {
    hypotheses: [
      {
        id: 'h1',
        statement: 'Fixture inference',
        status: 'supported',
        supportingEvidenceIds: [fact.id],
        contradictingEvidenceIds: [],
      },
    ],
    openQuestions: [],
    action: {
      kind: 'stop',
      diagnosis: {
        summary: 'Build failed',
        inference: 'Fixture inference',
        hypothesisId: 'h1',
        evidenceIds: [fact.id],
        nextAction: 'Inspect build configuration',
        limitations: [],
      },
    },
  };
}
function script(
  decisions: ((state: InvestigationState) => InvestigationDecision)[],
) {
  let index = 0;
  return {
    plan: vi.fn((state: InvestigationState) => {
      const decide = decisions[index++];
      if (!decide) throw Error('Unexpected planning turn');
      return decide(state);
    }),
  };
}
async function execute(
  planner: InvestigationPlanner,
  provider: CiProvider = fixture(),
  limits = {},
) {
  return runInvestigation(
    createInvestigation('Investigate', repository, limits),
    planner,
    createHandlerExecutor(provider, repository),
  );
}

describe('investigation execution loop with real handlers and fixture provider', () => {
  it.each(['failure', 'success', undefined] as const)(
    'completes explicit status-only checks (%s) without logs',
    async (conclusion) => {
      const provider = fixture();
      const { conclusion: _conclusion, ...activeRun } = run;
      void _conclusion;
      provider.listRuns.mockResolvedValue([
        conclusion
          ? { ...run, conclusion }
          : { ...activeRun, status: 'in_progress' },
      ]);
      const initial = createInvestigation(
        'Check CI status',
        repository,
        { maxSteps: 1 },
        'status-only',
      );
      const result = await runInvestigation(
        initial,
        script([
          () => ({ action: { kind: 'list_ci_runs', query: { latest: true } } }),
          (state) => {
            const decision = stop(state, 'run-resolution');
            if (decision.action.kind !== 'stop') throw Error('Expected stop');
            return {
              ...decision,
              action: {
                ...decision.action,
                diagnosis: {
                  ...decision.action.diagnosis,
                  summary: state.evidence[0]!.message,
                  inference: 'Run status only; no root cause determined',
                  nextAction: 'No diagnostic action requested',
                },
              },
            };
          },
        ]),
        createHandlerExecutor(provider, repository),
      );
      expect(result.termination?.status).toBe('completed');
      expect(result.purpose).toBe('status-only');
      expect(result.history).toHaveLength(1);
      expect(provider.listJobs).not.toHaveBeenCalled();
      expect(provider.getJobLog).not.toHaveBeenCalled();
    },
  );

  it('still rejects a run-only root-cause hypothesis after unrelated context was collected', async () => {
    const result = await execute(
      script([
        () => list,
        () => context,
        (state) => stop(state, 'run-resolution'),
      ]),
    );
    expect(result.termination?.reason).toBe('planner-error');
    expect(result.termination?.detail).toContain('diagnostic evidence');
    expect(result.diagnosis).toBeUndefined();
  });

  it('rejects root-cause completion supported only by run-resolution evidence', async () => {
    const provider = fixture();
    const result = await execute(
      script([() => list, (state) => stop(state, 'run-resolution')]),
      provider,
    );
    expect(result.termination?.reason).toBe('planner-error');
    expect(result.diagnosis).toBeUndefined();
    expect(result.history).toHaveLength(1);
    expect(provider.listJobs).not.toHaveBeenCalled();
    expect(provider.getJobLog).not.toHaveBeenCalled();
  });

  it('distinguishes an exact-run 404 from an authorization failure', async () => {
    const provider = fixture();
    provider.getRun.mockRejectedValue(
      Object.assign(Error('Not found'), { status: 404 }),
    );
    const result = await execute(
      script([
        () => ({
          action: { kind: 'list_ci_runs', query: { runId: 'missing' } },
        }),
      ]),
      provider,
    );
    expect(result.termination?.reason).toBe('no-failed-run');
    expect(provider.getJobLog).not.toHaveBeenCalled();
  });

  it('preserves failed-job identity even when core finds no extractable lines or steps', async () => {
    const provider = fixture('quiet output');
    provider.listJobs.mockResolvedValue([{ ...job, steps: [] }]);
    const result = await execute(
      script([() => list, () => context, (state) => stop(state)]),
      provider,
    );
    expect(result.termination?.status).toBe('completed');
    expect(
      result.evidence.find((e) => e.source === 'failure-context'),
    ).toMatchObject({
      message: 'build: failure',
      provenance: { runId: '42', jobId: '7', url: job.url },
    });
  });

  it('completes on failure context without searching or contacting a model', async () => {
    const provider = fixture();
    const result = await execute(
      script([() => list, () => context, (s) => stop(s)]),
      provider,
    );
    expect(result.termination?.reason).toBe('sufficient-evidence');
    expect(result.history.map((h) => h.action.kind)).toEqual([
      'list_ci_runs',
      'get_failure_context',
    ]);
    expect(provider.getJobLog).toHaveBeenCalledTimes(1);
    const line = result.evidence.find(
      (e) => e.message === 'ERROR: compilation failed',
    );
    expect(line?.provenance).toEqual({
      provider: 'fixture',
      runId: '42',
      jobId: '7',
      lineNumber: 1,
      url: job.url,
    });
  });

  it('searches when context is insufficient and reuses the context raw-log cache', async () => {
    const provider = fixture();
    const planner = script([
      () => list,
      () => context,
      () => ({ ...search(), openQuestions: ['Which service?'] }),
      (s) => stop(s, 'log-search'),
    ]);
    const result = await execute(planner, provider);
    expect(result.termination?.status).toBe('completed');
    expect(result.history).toHaveLength(3);
    expect(provider.getJobLog).toHaveBeenCalledTimes(1);
    expect(
      result.evidence.find((e) => e.source === 'log-search'),
    ).toMatchObject({
      message: 'hint: service=db',
      provenance: {
        provider: 'fixture',
        runId: '42',
        jobId: '7',
        lineNumber: 2,
        url: job.url,
      },
    });
    expect(result.openQuestions).toEqual([]);
    const replay = await execute(
      script([
        () => list,
        () => context,
        () => search(),
        (s) => stop(s, 'log-search'),
      ]),
      fixture(),
    );
    expect(replay.evidence).toEqual(result.evidence); // IDs and facts omit wall-clock metadata.
  });

  it('escalates ambiguous evidence rather than fabricating a successful diagnosis', async () => {
    const result = await execute(
      script([
        () => list,
        () => context,
        () => search(),
        () => ({
          openQuestions: ['Which dependency?'],
          action: {
            kind: 'escalate',
            reason: 'ambiguous-evidence',
            detail: 'Two causes remain',
          },
        }),
      ]),
    );
    expect(result.termination?.reason).toBe('ambiguous-evidence');
    expect(result.diagnosis).toBeUndefined();
    expect(result.openQuestions).toEqual(['Which dependency?']);
  });

  it('rejects ambiguous run selection without fetching job logs', async () => {
    const provider = fixture();
    provider.listRuns.mockResolvedValue([run, { ...run, id: '43' }]);
    const result = await execute(
      script([() => ({ action: { kind: 'list_ci_runs', query: {} } })]),
      provider,
    );
    expect(result.termination?.reason).toBe('ambiguous-evidence');
    expect(provider.getJobLog).not.toHaveBeenCalled();
  });

  it('handles no matching failed runs as a typed terminal observation', async () => {
    const provider = fixture();
    provider.listRuns.mockResolvedValue([]);
    const result = await execute(script([() => list]), provider);
    expect(result.termination?.reason).toBe('no-failed-run');
    expect(result.history).toHaveLength(1);
    expect(result.pending).toBeUndefined();
  });

  it.each(['success', 'cancelled'] as const)(
    'does not investigate a %s run',
    async (conclusion) => {
      const provider = fixture();
      provider.listRuns.mockResolvedValue([{ ...run, conclusion }]);
      const result = await execute(
        script([
          () => ({ action: { kind: 'list_ci_runs', query: { latest: true } } }),
        ]),
        provider,
      );
      expect(result.termination?.reason).toBe('no-failed-run');
      expect(provider.listJobs).not.toHaveBeenCalled();
    },
  );

  it.each(['list', 'context', 'log'] as const)(
    'records %s provider errors and stops',
    async (location) => {
      const provider = fixture();
      if (location === 'list')
        provider.listRuns.mockRejectedValue(Error('Unavailable'));
      if (location === 'context')
        provider.getRun.mockRejectedValue(Error('Unavailable'));
      if (location === 'log')
        provider.getJobLog.mockRejectedValue(Error('Unavailable'));
      const result = await execute(
        script([() => list, () => context]),
        provider,
      );
      expect(result.termination?.reason).toBe('tool-error');
      expect(result.history.at(-1)?.observation.error).toBe('Unavailable');
      expect(result.pending).toBeUndefined();
    },
  );

  it('does not misclassify an exact-run authorization failure as missing CI', async () => {
    const provider = fixture();
    provider.getRun.mockRejectedValue(Error('Access denied'));
    const result = await execute(
      script([
        () => ({ action: { kind: 'list_ci_runs', query: { runId: '42' } } }),
      ]),
      provider,
    );
    expect(result.termination?.reason).toBe('tool-error');
  });

  it('preserves unsupported provider capability as an explicit reason', async () => {
    const result = await execute(
      script([
        () => ({
          action: { kind: 'list_ci_runs', query: { pullRequestNumber: 5 } },
        }),
      ]),
    );
    expect(result.termination?.reason).toBe('unsupported-capability');
  });

  it('enforces budget before the next dispatch while allowing a final planning decision', async () => {
    const provider = fixture();
    const planner = script([() => list, () => context]);
    const result = await execute(planner, provider, { maxSteps: 1 });
    expect(result.termination?.reason).toBe('step-budget-exhausted');
    expect(result.history).toHaveLength(1);
    expect(provider.getRun).not.toHaveBeenCalled();
    expect(planner.plan).toHaveBeenCalledTimes(2);
  });

  it('enforces repeated actions before dispatch and no-progress after observations', async () => {
    const provider = fixture();
    const result = await execute(
      script([() => list, () => context, () => context]),
      provider,
      { maxSameAction: 1 },
    );
    expect(result.termination?.reason).toBe('repeated-action');
    expect(provider.getRun).toHaveBeenCalledTimes(1);
    const stalled = await execute(
      script([
        () => list,
        () => context,
        () => search('no-match-1'),
        () => search('no-match-2'),
      ]),
    );
    expect(stalled.termination?.reason).toBe('no-progress');
    expect(stalled.history).toHaveLength(4);
  });

  it('rejects foreign runs, jobs and repositories and never records their evidence', async () => {
    const foreignRun = fixture();
    foreignRun.getRun.mockResolvedValue({ ...run, id: 'other' });
    const first = await execute(
      script([() => list, () => context]),
      foreignRun,
    );
    expect(first.termination?.reason).toBe('tool-error');
    expect(first.evidence.every((e) => e.source === 'run-resolution')).toBe(
      true,
    );
    const foreignJob = fixture();
    foreignJob.listJobs.mockResolvedValue([{ ...job, runId: 'other' }]);
    const second = await execute(
      script([() => list, () => context]),
      foreignJob,
    );
    expect(second.termination?.reason).toBe('tool-error');
    const foreignRepo = fixture();
    foreignRepo.listRuns.mockResolvedValue([
      { ...run, repository: { owner: 'other', name: 'app' } },
    ]);
    const third = await execute(script([() => list]), foreignRepo);
    expect(third.termination?.reason).toBe('tool-error');
    expect(third.evidence).toEqual([]);
  });

  it('blocks searching a job not present in the selected run context', async () => {
    const provider = fixture();
    const result = await execute(
      script([
        () => list,
        () => context,
        () => ({
          action: {
            kind: 'search_job_logs',
            query: { jobId: 'foreign-job', patterns: ['error'] },
          },
        }),
      ]),
      provider,
    );
    expect(result.termination?.reason).toBe('tool-error');
    expect(provider.getJobLog).toHaveBeenCalledTimes(1);
  });

  it('reports planner exceptions and invalid diagnoses without executing extra tools', async () => {
    const provider = fixture();
    const result = await execute(
      {
        plan: () => {
          throw Error('Planner failed');
        },
      },
      provider,
    );
    expect(result.termination?.reason).toBe('planner-error');
    expect(result.history).toEqual([]);
    expect(provider.listRuns).not.toHaveBeenCalled();
    const invalid = await execute(
      script([
        () => list,
        () => context,
        (state) => {
          const decision = stop(state);
          if (decision.action.kind !== 'stop') throw Error('Expected stop');
          return {
            ...decision,
            action: {
              ...decision.action,
              diagnosis: {
                ...decision.action.diagnosis,
                evidenceIds: ['invented'],
              },
            },
          };
        },
      ]),
    );
    expect(invalid.termination?.reason).toBe('planner-error');
    expect(invalid.diagnosis).toBeUndefined();
  });

  it('rejects malformed executor observations as tool errors', async () => {
    const result = await runInvestigation(
      createInvestigation('Task', repository),
      script([() => list]),
      {
        execute: () => ({
          actionId: 'wrong',
          summary: 'Bad response',
          evidence: [],
        }),
      },
    );
    expect(result.termination?.reason).toBe('tool-error');
    expect(result.history).toHaveLength(1);
  });

  it('keeps independent investigation sessions from sharing cached logs', async () => {
    const provider = fixture();
    for (let i = 0; i < 2; i++) {
      await execute(
        script([
          () => list,
          () => context,
          () => search(),
          (s) => stop(s, 'log-search'),
        ]),
        provider,
      );
    }
    expect(provider.getJobLog).toHaveBeenCalledTimes(2);
  });

  it('never replans a terminal state and rejects a pending controller input', async () => {
    const initial = createInvestigation('Task', repository);
    const planner = script([]);
    const executor = createHandlerExecutor(fixture(), repository);
    const terminal = applyAction(initial, {
      kind: 'escalate',
      reason: 'ambiguous-evidence',
      detail: 'No answer',
    });
    expect(await runInvestigation(terminal, planner, executor)).toBe(terminal);
    expect(planner.plan).not.toHaveBeenCalled();
    await expect(
      runInvestigation(applyAction(initial, list.action), planner, executor),
    ).rejects.toThrow('pending');
    expect(() =>
      applyObservation(initial, {
        actionId: 'x',
        summary: 'Unexpected',
        evidence: [],
      }),
    ).toThrow();
  });
});
