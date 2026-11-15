import type { RepositoryRef } from '@cirelay/core';
import type {
  DiagnosisInput,
  EvidenceItem,
  Hypothesis,
  InvestigationAction,
  InvestigationLimits,
  InvestigationPurpose,
  InvestigationState,
  Observation,
  StructuredDiagnosis,
} from './types.js';

/** Copy and deeply freeze inputs so callers cannot mutate an earlier snapshot. */
function snapshot<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  }
  freeze(copy);
  return copy;
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function text(value: string): boolean {
  return value.trim().length > 0;
}
function idle(state: InvestigationState): void {
  requireValue(!state.termination, 'Investigation is terminal');
  requireValue(!state.pending, 'An action is already pending');
}

/** Canonical JSON key order; array order retains its tool-input semantics. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  requireValue(
    value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)),
    'Expected JSON data',
  );
  return JSON.stringify(value);
}

export function createInvestigation(
  task: string,
  repository: Readonly<RepositoryRef>,
  limits: Partial<InvestigationLimits> = {},
  purpose: InvestigationPurpose = 'root-cause',
): InvestigationState {
  requireValue(text(task), 'Task must not be empty');
  requireValue(
    purpose === 'root-cause' || purpose === 'status-only',
    'Invalid investigation purpose',
  );
  requireValue(
    [repository.owner, repository.name].every(
      (v) => text(v) && !/[\s/]/.test(v),
    ),
    'Invalid repository',
  );
  const configured = {
    maxSteps: 8,
    maxNoProgressSteps: 2,
    maxSameAction: 2,
    ...limits,
  };
  for (const value of Object.values(configured)) {
    requireValue(
      Number.isSafeInteger(value) && value > 0,
      'Limits must be positive safe integers',
    );
  }
  return snapshot({
    task,
    purpose,
    repository,
    limits: configured,
    phase: 'resolving-run',
    evidence: [],
    hypotheses: [],
    openQuestions: [],
    history: [],
    noProgressSteps: 0,
  });
}

function validateReferences(
  state: InvestigationState,
  ids: readonly string[],
): void {
  requireValue(
    new Set(ids).size === ids.length,
    'Duplicate evidence reference',
  );
  const known = new Set(state.evidence.map((item) => item.id));
  requireValue(
    ids.every((id) => known.has(id)),
    'Unknown evidence reference',
  );
}

function validateHypotheses(
  state: InvestigationState,
  hypotheses: readonly Hypothesis[],
): void {
  requireValue(
    new Set(hypotheses.map((h) => h.id)).size === hypotheses.length,
    'Duplicate hypothesis ID',
  );
  for (const h of hypotheses) {
    requireValue(
      text(h.id) && text(h.statement),
      'Hypothesis ID and statement are required',
    );
    validateReferences(state, h.supportingEvidenceIds);
    validateReferences(state, h.contradictingEvidenceIds);
    requireValue(
      !h.supportingEvidenceIds.some((id) =>
        h.contradictingEvidenceIds.includes(id),
      ),
      'Evidence cannot support and contradict the same hypothesis',
    );
    requireValue(
      h.status !== 'supported' || h.supportingEvidenceIds.length > 0,
      'Supported hypothesis requires evidence',
    );
    requireValue(
      h.status !== 'rejected' || h.contradictingEvidenceIds.length > 0,
      'Rejected hypothesis requires evidence',
    );
  }
}

/** Hypothesis edits and question rewording never reset the progress counter. */
export function reviseHypotheses(
  state: InvestigationState,
  hypotheses: readonly Hypothesis[],
  openQuestions: readonly string[] = state.openQuestions,
): InvestigationState {
  idle(state);
  validateHypotheses(state, hypotheses);
  requireValue(openQuestions.every(text), 'Open questions must not be empty');
  return snapshot({ ...state, hypotheses, openQuestions });
}

function validateDiagnosis(
  state: InvestigationState,
  diagnosis: DiagnosisInput,
): void {
  requireValue(
    state.runId && state.evidence.length,
    'Completion requires a resolved run and evidence',
  );
  requireValue(state.openQuestions.length === 0, 'Blocking questions remain');
  requireValue(
    [diagnosis.summary, diagnosis.inference, diagnosis.nextAction].every(text),
    'Diagnosis text is required',
  );
  requireValue(
    diagnosis.limitations.every(text),
    'Limitations must not be empty',
  );
  validateHypotheses(state, state.hypotheses);
  validateReferences(state, diagnosis.evidenceIds);
  const selected = state.hypotheses.find(
    (h) => h.id === diagnosis.hypothesisId,
  );
  requireValue(
    selected?.status === 'supported',
    'Diagnosis requires a supported hypothesis',
  );
  requireValue(
    state.hypotheses.filter((h) => h.status !== 'rejected').length === 1 &&
      selected.contradictingEvidenceIds.length === 0,
    'Evidence remains ambiguous',
  );
  requireValue(
    diagnosis.evidenceIds.length > 0 &&
      selected.supportingEvidenceIds.every((id) =>
        diagnosis.evidenceIds.includes(id),
      ),
    'Diagnosis must cite its hypothesis evidence',
  );
  if (state.purpose === 'root-cause') {
    requireValue(
      state.evidence.some(
        (item) =>
          item.source === 'failure-context' &&
          item.provenance.runId === state.runId,
      ),
      'Root-cause completion requires failure-context evidence from the selected run',
    );
    requireValue(
      state.evidence.some(
        (item) =>
          item.source !== 'run-resolution' &&
          item.provenance.runId === state.runId &&
          selected.supportingEvidenceIds.includes(item.id),
      ),
      'Root-cause hypothesis requires diagnostic evidence',
    );
  }
}

/** Returns a pending action for a future executor, or terminates before dispatch. */
export function applyAction(
  state: InvestigationState,
  action: InvestigationAction,
): InvestigationState {
  idle(state);
  if (action.kind === 'stop') {
    validateDiagnosis(state, action.diagnosis);
    return snapshot({
      ...state,
      phase: 'completed',
      diagnosis: action.diagnosis,
      termination: {
        status: 'completed',
        reason: 'sufficient-evidence',
        detail: action.diagnosis.summary,
      },
    });
  }
  if (action.kind === 'escalate') {
    requireValue(text(action.detail), 'Escalation detail is required');
    return snapshot({
      ...state,
      phase: 'escalated',
      termination: {
        status: 'escalated',
        reason: action.reason,
        detail: action.detail,
      },
    });
  }
  if (state.history.length >= state.limits.maxSteps) {
    return applyAction(state, {
      kind: 'escalate',
      reason: 'step-budget-exhausted',
      detail: 'No tool steps remain',
    });
  }
  requireValue(
    action.kind === 'list_ci_runs' ? !state.runId : !!state.runId,
    'Resolve exactly one run before gathering evidence',
  );
  requireValue(
    action.kind !== 'search_job_logs' || state.phase === 'investigating',
    'Collect failure context before searching logs',
  );
  const signature = canonical(action);
  if (
    state.history.filter((record) => record.signature === signature).length >=
    state.limits.maxSameAction
  ) {
    return applyAction(state, {
      kind: 'escalate',
      reason: 'repeated-action',
      detail: 'Action signature execution limit reached',
    });
  }
  return snapshot({
    ...state,
    pending: {
      actionId: `step-${state.history.length + 1}`,
      action,
      signature,
    },
  });
}

function validateEvidence(
  item: EvidenceItem,
  runId: string,
  source: EvidenceItem['source'],
): void {
  requireValue(
    text(item.id) && text(item.message) && text(item.provenance.provider),
    'Evidence ID, message and provider are required',
  );
  requireValue(
    item.source === source && item.provenance.runId === runId,
    'Evidence provenance does not match the action/run',
  );
  if (item.provenance.jobId !== undefined)
    requireValue(text(item.provenance.jobId), 'Empty job ID');
  if (item.provenance.lineNumber !== undefined) {
    requireValue(
      item.provenance.jobId &&
        Number.isSafeInteger(item.provenance.lineNumber) &&
        item.provenance.lineNumber > 0,
      'Log line requires a job ID and positive line number',
    );
  }
}

/** Atomically validates and commits one observation; failures leave state intact. */
export function applyObservation(
  state: InvestigationState,
  observation: Observation,
): InvestigationState {
  requireValue(!state.termination && state.pending, 'No active pending action');
  const pending = state.pending;
  requireValue(
    observation.actionId === pending.actionId,
    'Observation does not match pending action',
  );
  requireValue(text(observation.summary), 'Observation summary is required');
  if (observation.error !== undefined || observation.escalation !== undefined) {
    requireValue(
      (observation.error === undefined || text(observation.error)) &&
        (observation.escalation === undefined ||
          text(observation.escalation.detail)) &&
        !(observation.error && observation.escalation) &&
        observation.evidence.length === 0 &&
        observation.resolvedRunId === undefined,
      'Tool errors cannot introduce evidence or resolve a run',
    );
    const { pending: _pending, ...rest } = state;
    void _pending;
    return snapshot({
      ...rest,
      phase: 'escalated',
      history: [
        ...state.history,
        { ...pending, observation, evidenceAdded: 0, madeProgress: false },
      ],
      noProgressSteps: state.noProgressSteps + 1,
      termination: {
        status: 'escalated',
        reason: observation.escalation?.reason ?? 'tool-error',
        detail:
          observation.escalation?.detail ?? observation.error ?? 'Tool failed',
      },
    });
  }

  requireValue(
    observation.resolvedRunId === undefined ||
      (pending.action.kind === 'list_ci_runs' &&
        text(observation.resolvedRunId)),
    'Only run resolution can select a run',
  );
  const runId = state.runId ?? observation.resolvedRunId;
  requireValue(
    runId || observation.evidence.length === 0,
    'Evidence requires a resolved run',
  );
  const source =
    pending.action.kind === 'list_ci_runs'
      ? 'run-resolution'
      : pending.action.kind === 'get_failure_context'
        ? 'failure-context'
        : 'log-search';
  const evidence = [...state.evidence];
  for (const item of observation.evidence) {
    validateEvidence(item, runId ?? '', source);
    if (pending.action.kind === 'search_job_logs') {
      requireValue(
        item.provenance.jobId === pending.action.query.jobId,
        'Evidence job does not match search',
      );
    }
    const existing = evidence.find((e) => e.id === item.id);
    requireValue(
      !existing || canonical(existing) === canonical(item),
      'Conflicting evidence ID',
    );
    const duplicate = evidence.some(
      (e) => canonical({ ...e, id: '' }) === canonical({ ...item, id: '' }),
    );
    // Retain canonical IDs; callers must cite the ledger, not discarded aliases.
    if (!duplicate) evidence.push(item);
  }
  const evidenceAdded = evidence.length - state.evidence.length;
  const madeProgress = evidenceAdded > 0 || (!state.runId && !!runId);
  const { pending: _pending, ...rest } = state;
  void _pending;
  const next: InvestigationState = {
    ...rest,
    ...(runId ? { runId } : {}),
    evidence,
    phase:
      pending.action.kind === 'list_ci_runs'
        ? runId
          ? 'gathering-context'
          : 'resolving-run'
        : 'investigating',
    noProgressSteps: madeProgress ? 0 : state.noProgressSteps + 1,
    history: [
      ...state.history,
      { ...pending, observation, evidenceAdded, madeProgress },
    ],
  };
  if (next.noProgressSteps >= next.limits.maxNoProgressSteps) {
    return applyAction(next, {
      kind: 'escalate',
      reason: 'no-progress',
      detail: 'Consecutive observations added no evidence or run resolution',
    });
  }
  return snapshot(next);
}

export function buildStructuredDiagnosis(
  state: InvestigationState,
): StructuredDiagnosis {
  requireValue(
    state.termination,
    'Structured diagnosis requires terminal state',
  );
  if (state.diagnosis) validateDiagnosis(state, state.diagnosis);
  return snapshot({
    purpose: state.purpose,
    task: state.task,
    repository: state.repository,
    ...(state.runId ? { runId: state.runId } : {}),
    termination: state.termination,
    observedEvidence: state.evidence,
    hypotheses: state.hypotheses,
    openQuestions: state.openQuestions,
    ...(state.diagnosis ? { diagnosis: state.diagnosis } : {}),
  });
}
