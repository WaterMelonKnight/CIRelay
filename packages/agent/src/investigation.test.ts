import { describe, expect, it } from 'vitest';
import {
  applyAction,
  applyObservation,
  buildStructuredDiagnosis,
  createInvestigation,
  reviseHypotheses,
} from './index.js';
import type {
  DiagnosisInput,
  EvidenceItem,
  Hypothesis,
  InvestigationState,
  ToolAction,
} from './index.js';

const repository = { owner: 'acme', name: 'app' };
const list: ToolAction = {
  kind: 'list_ci_runs',
  query: { latest: true, conclusion: 'failure' },
};
const context: ToolAction = { kind: 'get_failure_context', options: {} };
const search = (pattern: string): ToolAction => ({
  kind: 'search_job_logs',
  query: { jobId: 'job-1', patterns: [pattern] },
});
const fact: EvidenceItem = {
  id: 'e1',
  source: 'failure-context',
  message: 'lint: unsafe assignment',
  provenance: {
    provider: 'github-actions',
    runId: '42',
    jobId: 'job-1',
    lineNumber: 12,
  },
};
const hypothesis: Hypothesis = {
  id: 'h1',
  statement: 'Lint rejected the assignment',
  status: 'supported',
  supportingEvidenceIds: ['e1'],
  contradictingEvidenceIds: [],
};
const diagnosis: DiagnosisInput = {
  summary: 'Lint failed',
  inference: 'Static analysis failure',
  hypothesisId: 'h1',
  evidenceIds: ['e1'],
  nextAction: 'Inspect line 12',
  limitations: [],
};
function observe(
  state: InvestigationState,
  action: ToolAction,
  evidence: readonly EvidenceItem[] = [],
  resolvedRunId?: string,
) {
  const pending = applyAction(state, action);
  if (!pending.pending) throw Error('Expected dispatch');
  return applyObservation(pending, {
    actionId: pending.pending.actionId,
    summary: 'fixture observation',
    evidence,
    ...(resolvedRunId ? { resolvedRunId } : {}),
  });
}
function resolved(limits = {}) {
  return observe(
    createInvestigation('Investigate CI', repository, limits),
    list,
    [],
    '42',
  );
}
function gathered(limits = {}) {
  return observe(resolved(limits), context, [fact]);
}
function supported(limits = {}) {
  return reviseHypotheses(gathered(limits), [hypothesis]);
}

describe('bounded investigation foundation', () => {
  it('records executor errors without leaving an unfinishable pending action', () => {
    const pending = applyAction(resolved(), context);
    const failed = applyObservation(pending, {
      actionId: 'step-2',
      summary: 'Request failed',
      error: 'Provider unavailable',
      evidence: [],
    });
    expect(failed.pending).toBeUndefined();
    expect(failed.history).toHaveLength(2);
    expect(failed.termination?.reason).toBe('tool-error');
    expect(buildStructuredDiagnosis(failed).diagnosis).toBeUndefined();
    expect(() =>
      applyObservation(pending, {
        actionId: 'step-2',
        summary: 'Invalid',
        error: 'Provider unavailable',
        evidence: [fact],
      }),
    ).toThrow('Tool errors cannot');
  });

  it('progresses deterministically and stops on sufficient context without search', () => {
    const initial = createInvestigation('Investigate CI', repository);
    const state = supported();
    const complete = applyAction(state, { kind: 'stop', diagnosis });
    expect(initial.phase).toBe('resolving-run');
    expect(resolved().phase).toBe('gathering-context');
    expect(state.phase).toBe('investigating');
    expect(complete.history.map((h) => h.action.kind)).toEqual([
      'list_ci_runs',
      'get_failure_context',
    ]);
    expect(complete.termination).toMatchObject({
      status: 'completed',
      reason: 'sufficient-evidence',
    });
    expect(buildStructuredDiagnosis(complete)).toMatchObject({
      runId: '42',
      observedEvidence: [fact],
      diagnosis,
    });
    expect(applyAction(supported(), { kind: 'stop', diagnosis })).toEqual(
      complete,
    );
  });

  it('deduplicates same-batch evidence and identical facts under new IDs without progress', () => {
    const first = observe(resolved(), context, [
      fact,
      fact,
      { ...fact, id: 'alias' },
    ]);
    const second = observe(first, context, [{ ...fact, id: 'another-alias' }]);
    expect(second.evidence).toEqual([fact]);
    expect(second.history.at(-1)).toMatchObject({
      evidenceAdded: 0,
      madeProgress: false,
    });
    expect(second.noProgressSteps).toBe(1);
    expect(() =>
      reviseHypotheses(second, [
        { ...hypothesis, supportingEvidenceIds: ['alias'] },
      ]),
    ).toThrow('Unknown evidence');
  });

  it('rejects conflicting evidence IDs atomically, including conflicts in one batch', () => {
    const pending = applyAction(resolved(), context);
    const observation = {
      actionId: 'step-2',
      summary: 'conflict',
      evidence: [fact, { ...fact, message: 'different' }],
    };
    expect(() => applyObservation(pending, observation)).toThrow(
      'Conflicting evidence',
    );
    expect(pending.evidence).toEqual([]);
    expect(pending.pending?.actionId).toBe('step-2');
  });

  it('defensively copies and deeply freezes caller data and prior states', () => {
    const input = { ...repository };
    const initial = createInvestigation('Task', input);
    input.name = 'changed';
    expect(initial.repository.name).toBe('app');
    const state = gathered();
    expect(Object.isFrozen(state.evidence[0]?.provenance)).toBe(true);
    expect(() =>
      Object.assign(state.evidence[0]?.provenance ?? {}, { runId: 'bad' }),
    ).toThrow();
    expect(initial.history).toEqual([]);
  });

  it('validates hypothesis IDs, evidence references, status and contradictory citations', () => {
    const state = gathered();
    expect(() => reviseHypotheses(state, [hypothesis, hypothesis])).toThrow(
      'Duplicate hypothesis',
    );
    expect(() => reviseHypotheses(state, [{ ...hypothesis, id: '' }])).toThrow(
      'required',
    );
    expect(() =>
      reviseHypotheses(state, [
        { ...hypothesis, supportingEvidenceIds: ['missing'] },
      ]),
    ).toThrow('Unknown evidence');
    expect(() =>
      reviseHypotheses(state, [{ ...hypothesis, supportingEvidenceIds: [] }]),
    ).toThrow('requires evidence');
    expect(() =>
      reviseHypotheses(state, [
        { ...hypothesis, contradictingEvidenceIds: ['e1'] },
      ]),
    ).toThrow('support and contradict');
    expect(() =>
      reviseHypotheses(state, [
        { ...hypothesis, supportingEvidenceIds: ['e1', 'e1'] },
      ]),
    ).toThrow('Duplicate evidence');
    expect(() =>
      reviseHypotheses(state, [{ ...hypothesis, status: 'rejected' }]),
    ).toThrow('requires evidence');
  });

  it('enforces the budget before dispatch but permits a diagnosis from the final observation', () => {
    const state = supported({ maxSteps: 2 });
    expect(state.history).toHaveLength(2);
    expect(applyAction(state, search('error')).termination?.reason).toBe(
      'step-budget-exhausted',
    );
    expect(applyAction(state, { kind: 'stop', diagnosis }).phase).toBe(
      'completed',
    );
    expect(state.pending).toBeUndefined();
  });

  it('blocks identical action signatures despite object-key order changes', () => {
    const state = observe(
      createInvestigation('Task', repository, { maxSameAction: 1 }),
      list,
    );
    const retry = applyAction(state, {
      kind: 'list_ci_runs',
      query: { conclusion: 'failure', latest: true },
    });
    expect(retry.termination?.reason).toBe('repeated-action');
    expect(retry.history).toHaveLength(1);
    expect(retry.pending).toBeUndefined();
  });

  it('counts repeated signatures across intervening actions', () => {
    let state = gathered({ maxSameAction: 1, maxNoProgressSteps: 8 });
    state = observe(state, search('first'));
    state = observe(state, search('second'));
    expect(applyAction(state, search('first')).termination?.reason).toBe(
      'repeated-action',
    );
  });

  it('escalates on no progress, even with changing actions or rewritten hypotheses', () => {
    const state = observe(gathered(), search('first'));
    const revised = reviseHypotheses(state, [
      { ...hypothesis, statement: 'Reworded inference' },
    ]);
    const stopped = observe(revised, search('second'));
    expect(stopped.termination?.reason).toBe('no-progress');
    expect(stopped.noProgressSteps).toBe(2);
    expect(buildStructuredDiagnosis(stopped).diagnosis).toBeUndefined();
  });

  it('resets no-progress only on a new run or evidence', () => {
    const state = observe(gathered(), search('none'));
    const next = observe(state, search('timeout'), [
      { ...fact, id: 'e2', source: 'log-search', message: 'timeout' },
    ]);
    expect(next.noProgressSteps).toBe(0);
    expect(next.evidence).toHaveLength(2);
  });

  it('rejects ambiguous completion and preserves ambiguity on explicit escalation', () => {
    const state = reviseHypotheses(gathered(), [
      hypothesis,
      { ...hypothesis, id: 'h2', status: 'open' },
    ]);
    expect(() => applyAction(state, { kind: 'stop', diagnosis })).toThrow(
      'ambiguous',
    );
    const escalated = applyAction(state, {
      kind: 'escalate',
      reason: 'ambiguous-evidence',
      detail: 'Two explanations remain',
    });
    expect(buildStructuredDiagnosis(escalated)).toMatchObject({
      termination: { reason: 'ambiguous-evidence' },
      hypotheses: state.hypotheses,
    });
  });

  it('requires no blocking questions and validates diagnosis references and selected hypothesis', () => {
    const state = supported();
    expect(() =>
      applyAction(reviseHypotheses(state, [hypothesis], ['Which cause?']), {
        kind: 'stop',
        diagnosis,
      }),
    ).toThrow('Blocking questions');
    expect(() =>
      applyAction(state, {
        kind: 'stop',
        diagnosis: { ...diagnosis, evidenceIds: ['unknown'] },
      }),
    ).toThrow('Unknown evidence');
    expect(() =>
      applyAction(state, {
        kind: 'stop',
        diagnosis: { ...diagnosis, evidenceIds: [] },
      }),
    ).toThrow('must cite');
    expect(() =>
      applyAction(state, {
        kind: 'stop',
        diagnosis: { ...diagnosis, hypothesisId: 'missing' },
      }),
    ).toThrow('supported hypothesis');
    expect(() => applyAction(resolved(), { kind: 'stop', diagnosis })).toThrow(
      'resolved run and evidence',
    );
    expect(() => buildStructuredDiagnosis(state)).toThrow('terminal state');
  });

  it('rejects terminal transitions and observations, including a second termination', () => {
    const terminal = applyAction(supported(), { kind: 'stop', diagnosis });
    expect(() =>
      applyAction(terminal, {
        kind: 'escalate',
        reason: 'tool-error',
        detail: 'late',
      }),
    ).toThrow('terminal');
    expect(() => reviseHypotheses(terminal, [])).toThrow('terminal');
    expect(() =>
      applyObservation(terminal, {
        actionId: 'step-3',
        summary: 'late',
        evidence: [],
      }),
    ).toThrow('pending');
  });

  it('correlates one observation to one action and enforces retrieval order/run isolation', () => {
    const initial = createInvestigation('Task', repository);
    expect(() => applyAction(initial, context)).toThrow('Resolve');
    expect(() => applyAction(resolved(), search('x'))).toThrow(
      'failure context',
    );
    const pending = applyAction(resolved(), context);
    expect(() => applyAction(pending, context)).toThrow('pending');
    expect(() =>
      applyObservation(pending, {
        actionId: 'wrong',
        summary: 'bad',
        evidence: [],
      }),
    ).toThrow('match');
    expect(() =>
      applyObservation(pending, {
        actionId: 'step-2',
        summary: 'bad',
        evidence: [],
        resolvedRunId: '43',
      }),
    ).toThrow('Only run resolution');
    expect(() =>
      observe(resolved(), context, [
        { ...fact, provenance: { ...fact.provenance, runId: '43' } },
      ]),
    ).toThrow('provenance');
    expect(() =>
      observe(resolved(), context, [{ ...fact, source: 'log-search' }]),
    ).toThrow('provenance');
    expect(() =>
      observe(gathered(), search('x'), [
        {
          ...fact,
          source: 'log-search',
          provenance: { ...fact.provenance, jobId: 'other' },
        },
      ]),
    ).toThrow('job');
    expect(() =>
      observe(resolved(), context, [
        { ...fact, provenance: { ...fact.provenance, lineNumber: 0 } },
      ]),
    ).toThrow('line');
    expect(() => applyAction(resolved(), list)).toThrow('Resolve');
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid budget %s', (value) => {
    expect(() =>
      createInvestigation('Task', repository, { maxSteps: value }),
    ).toThrow('positive safe integers');
  });

  it('rejects empty tasks and malformed repository references', () => {
    expect(() => createInvestigation(' ', repository)).toThrow('Task');
    expect(() =>
      createInvestigation('Task', { ...repository, owner: '' }),
    ).toThrow('repository');
    expect(() =>
      createInvestigation('Task', { ...repository, name: 'a/b' }),
    ).toThrow('repository');
  });
});
