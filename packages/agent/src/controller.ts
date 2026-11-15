import {
  applyAction,
  applyObservation,
  reviseHypotheses,
} from './investigation.js';
import type {
  Hypothesis,
  InvestigationAction,
  InvestigationState,
  Observation,
} from './types.js';

export interface InvestigationDecision {
  readonly action: InvestigationAction;
  readonly hypotheses?: readonly Hypothesis[];
  readonly openQuestions?: readonly string[];
}

/** Trusted application interface; future model JSON must be validated separately. */
export interface InvestigationPlanner {
  plan(
    state: InvestigationState,
  ): InvestigationDecision | Promise<InvestigationDecision>;
}

export interface InvestigationExecutor {
  /** Receives only a frozen snapshot containing one admitted pending action. */
  execute(state: InvestigationState): Observation | Promise<Observation>;
}

function message(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Unknown failure';
}

/** Each planning decision must dispatch a tool or terminate; no unbounded revise-only turns. */
export async function runInvestigation(
  initial: InvestigationState,
  planner: InvestigationPlanner,
  executor: InvestigationExecutor,
): Promise<InvestigationState> {
  if (initial.pending)
    throw new Error('Cannot start controller with a pending action');
  let state = initial;
  while (!state.termination) {
    try {
      const decision = await planner.plan(state);
      const revised = reviseHypotheses(
        state,
        decision.hypotheses ?? state.hypotheses,
        decision.openQuestions ?? state.openQuestions,
      );
      state = applyAction(revised, decision.action);
    } catch (error) {
      return applyAction(state, {
        kind: 'escalate',
        reason: 'planner-error',
        detail: message(error),
      });
    }
    if (!state.pending) continue; // A stop decision or pre-dispatch guard terminated.
    const pending = state.pending;
    try {
      state = applyObservation(state, await executor.execute(state));
    } catch (error) {
      state = applyObservation(state, {
        actionId: pending.actionId,
        summary: 'Executor failed',
        error: message(error),
        evidence: [],
      });
    }
  }
  return state;
}
