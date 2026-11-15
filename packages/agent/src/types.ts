import type {
  BuildFailureContextOptions,
  CiRunQuery,
  FailureEvidence,
  JobLogSearchQuery,
  RepositoryRef,
} from '@cirelay/core';

export interface InvestigationLimits {
  readonly maxSteps: number;
  readonly maxNoProgressSteps: number;
  /** Maximum executions of a signature across the entire investigation. */
  readonly maxSameAction: number;
}

export type ToolAction =
  | {
      readonly kind: 'list_ci_runs';
      readonly query: Readonly<Omit<CiRunQuery, 'repository'>>;
    }
  | {
      readonly kind: 'get_failure_context';
      readonly options: Readonly<
        Pick<
          BuildFailureContextOptions,
          'logSourcePolicy' | 'extractionProfile'
        >
      >;
    }
  | {
      readonly kind: 'search_job_logs';
      readonly query: Readonly<
        Omit<JobLogSearchQuery, 'repository' | 'patterns' | 'excludePatterns'>
      > & {
        readonly patterns: readonly string[];
        readonly excludePatterns?: readonly string[];
      };
    };

export type EscalationReason =
  | 'step-budget-exhausted'
  | 'repeated-action'
  | 'no-progress'
  | 'ambiguous-evidence'
  | 'no-failed-run'
  | 'tool-error'
  | 'planner-error'
  | 'unsupported-capability';

export interface DiagnosisInput {
  readonly summary: string;
  /** An interpretation, kept separate from the observed facts. */
  readonly inference: string;
  readonly hypothesisId: string;
  readonly evidenceIds: readonly string[];
  readonly nextAction: string;
  readonly limitations: readonly string[];
}

export type InvestigationAction =
  | ToolAction
  | { readonly kind: 'stop'; readonly diagnosis: DiagnosisInput }
  | {
      readonly kind: 'escalate';
      readonly reason: EscalationReason;
      readonly detail: string;
    };

export interface EvidenceItem {
  readonly id: string;
  readonly source: 'run-resolution' | 'failure-context' | 'log-search';
  readonly message: string;
  readonly provenance: {
    readonly provider: string;
    readonly runId: string;
    readonly jobId?: string;
    readonly lineNumber?: number;
    readonly url?: string;
  };
  readonly category?: FailureEvidence['category'];
}

export interface Hypothesis {
  readonly id: string;
  readonly statement: string;
  readonly status: 'open' | 'supported' | 'rejected';
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
}

export interface Observation {
  /** Correlates the result to exactly one pending action. */
  readonly actionId: string;
  readonly summary: string;
  /** Executor failures consume a step and terminate with tool-error. */
  readonly error?: string;
  /** Known executor outcomes that cannot produce a successful diagnosis. */
  readonly escalation?: {
    readonly reason: EscalationReason;
    readonly detail: string;
  };
  readonly resolvedRunId?: string;
  readonly evidence: readonly EvidenceItem[];
}

export interface ActionRecord {
  readonly actionId: string;
  readonly action: ToolAction;
  readonly signature: string;
  readonly observation: Observation;
  readonly evidenceAdded: number;
  readonly madeProgress: boolean;
}

export type Termination =
  | {
      readonly status: 'completed';
      readonly reason: 'sufficient-evidence';
      readonly detail: string;
    }
  | {
      readonly status: 'escalated';
      readonly reason: EscalationReason;
      readonly detail: string;
    };

export interface InvestigationState {
  readonly task: string;
  readonly repository: Readonly<RepositoryRef>;
  readonly phase:
    | 'resolving-run'
    | 'gathering-context'
    | 'investigating'
    | 'completed'
    | 'escalated';
  readonly limits: InvestigationLimits;
  readonly runId?: string;
  readonly evidence: readonly EvidenceItem[];
  readonly hypotheses: readonly Hypothesis[];
  readonly openQuestions: readonly string[];
  readonly history: readonly ActionRecord[];
  readonly noProgressSteps: number;
  readonly pending?: {
    readonly actionId: string;
    readonly action: ToolAction;
    readonly signature: string;
  };
  readonly termination?: Termination;
  readonly diagnosis?: DiagnosisInput;
}

export interface StructuredDiagnosis {
  readonly task: string;
  readonly repository: Readonly<RepositoryRef>;
  readonly runId?: string;
  readonly termination: Termination;
  readonly observedEvidence: readonly EvidenceItem[];
  readonly hypotheses: readonly Hypothesis[];
  readonly openQuestions: readonly string[];
  /** Absent on escalation: uncertainty must not become a successful diagnosis. */
  readonly diagnosis?: DiagnosisInput;
}
