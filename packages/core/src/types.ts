export interface RepositoryRef {
  owner: string;
  name: string;
}

export interface PullRequestRef {
  number: number;
  headSha: string;
  baseSha?: string;
}

export interface CommitRef {
  sha: string;
  message?: string;
}

export type CiConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'neutral'
  | 'timed_out'
  | 'action_required'
  | 'unknown';
export type CiStatus = 'queued' | 'in_progress' | 'completed' | 'unknown';

export interface CiStep {
  number: number;
  name: string;
  status: CiStatus;
  conclusion?: CiConclusion;
  startedAt?: string;
  completedAt?: string;
}

export interface CiJob {
  id: string;
  runId: string;
  name: string;
  status: CiStatus;
  conclusion?: CiConclusion;
  url?: string;
  steps: CiStep[];
}

export interface CiRun {
  id: string;
  provider: string;
  repository: RepositoryRef;
  name: string;
  commit: CommitRef;
  pullRequest?: PullRequestRef;
  status: CiStatus;
  conclusion?: CiConclusion;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangedFile {
  path: string;
  status?: 'added' | 'modified' | 'removed' | 'renamed';
  patch?: string;
}

export interface ListRunsInput {
  repository: RepositoryRef;
  commitSha?: string;
  limit?: number;
}
export interface RunInput {
  repository: RepositoryRef;
  runId: string;
}
export interface JobInput {
  repository: RepositoryRef;
  jobId: string;
}
export interface PullRequestInput {
  repository: RepositoryRef;
  pullRequestNumber: number;
}

export interface CiProvider {
  readonly name: string;
  listRuns(input: ListRunsInput): Promise<CiRun[]>;
  getRun(input: RunInput): Promise<CiRun>;
  listJobs(input: RunInput): Promise<CiJob[]>;
  getJobLog(input: JobInput): Promise<string>;
  getPullRequestDiff?(input: PullRequestInput): Promise<ChangedFile[]>;
}

export interface FailureEvidence {
  kind: 'error-line' | 'stack-trace' | 'log-excerpt' | 'failed-step';
  message: string;
  jobId?: string;
  stepName?: string;
  lineNumber?: number;
}

export interface FailedJobContext {
  job: CiJob;
  failedSteps: CiStep[];
  logExcerpt?: string;
  errorLines: string[];
  stackTraceCandidates: string[];
}

export interface FailureContext {
  provider: string;
  repository: RepositoryRef;
  commitSha: string;
  pullRequest?: PullRequestRef;
  run: CiRun;
  failedJobs: FailedJobContext[];
  changedFiles: ChangedFile[];
  evidence: FailureEvidence[];
  generatedAt: string;
}

export interface CiFailureEvent {
  type: 'ci.failure';
  provider: string;
  repository: RepositoryRef;
  runId: string;
  jobId?: string;
  occurredAt: string;
}
