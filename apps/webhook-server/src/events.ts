import type { CiFailureEvent } from '@cirelay/core';
import { z } from 'zod';

const payloadSchema = z.object({
  action: z.string(),
  repository: z.object({
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
  workflow_run: z
    .object({
      id: z.number(),
      conclusion: z.string().nullable(),
      updated_at: z.string(),
    })
    .optional(),
  workflow_job: z
    .object({
      id: z.number(),
      run_id: z.number(),
      conclusion: z.string().nullable(),
      completed_at: z.string().nullable(),
    })
    .optional(),
});

export function parseGitHubFailureEvent(
  eventName: string,
  body: unknown,
): CiFailureEvent | undefined {
  const payload = payloadSchema.parse(body);
  const repository = {
    owner: payload.repository.owner.login,
    name: payload.repository.name,
  };
  if (
    eventName === 'workflow_run' &&
    payload.workflow_run?.conclusion === 'failure'
  )
    return {
      type: 'ci.failure',
      provider: 'github-actions',
      repository,
      runId: String(payload.workflow_run.id),
      occurredAt: payload.workflow_run.updated_at,
    };
  if (
    eventName === 'workflow_job' &&
    payload.workflow_job?.conclusion === 'failure'
  )
    return {
      type: 'ci.failure',
      provider: 'github-actions',
      repository,
      runId: String(payload.workflow_job.run_id),
      jobId: String(payload.workflow_job.id),
      occurredAt:
        payload.workflow_job.completed_at ?? new Date(0).toISOString(),
    };
  return undefined;
}

export interface FailureEventHandler {
  handle(event: CiFailureEvent): Promise<void>;
}
