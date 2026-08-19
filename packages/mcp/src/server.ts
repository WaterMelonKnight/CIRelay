import type { CiProvider } from '@cirelay/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CiToolHandlers } from './handlers.js';

const repositoryShape = {
  owner: z.string().min(1),
  repository: z.string().min(1),
};
const runSelectorShape = {
  runId: z.string().min(1).optional(),
  commitSha: z.string().min(1).optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  branch: z.string().min(1).optional(),
  conclusion: z
    .enum([
      'success',
      'failure',
      'cancelled',
      'skipped',
      'neutral',
      'timed_out',
      'action_required',
    ])
    .optional(),
  latest: z.boolean().optional(),
  limit: z.number().int().positive().max(100).optional(),
};
const output = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

export const TOOL_DESCRIPTIONS = {
  listCiRuns:
    'Preferred tool to resolve or explore a CI run when it is not already known; filter by run ID, PR, commit, branch, conclusion, or recency before investigating failures.',
  getCiStatus:
    'Answer quick CI state, pass/fail, or recent-status questions, optionally for a commit. For detailed failure investigation, continue with get_failure_context.',
  listFailedJobs:
    'List job-level failures when the CI run is already known and only failed-job information is needed. Prefer get_failure_context for a full investigation.',
  getJobLog:
    'Retrieve the complete raw CI job log as a final fallback only when structured FailureContext and targeted search_job_logs results are insufficient; do not fetch full logs by default.',
  searchJobLogs:
    'Targeted follow-up when get_failure_context evidence is insufficient or ambiguous. Search for narrow literal patterns derived from evidence or a concrete hypothesis; do not use first, and prefer this before get_job_log.',
  getFailureContext:
    'Primary tool for CI failure investigation: retrieve bounded, structured evidence including failed jobs, steps, and extracted relevant lines. Use before raw logs; stop if sufficient, otherwise follow up with targeted search_job_logs.',
} as const;

export function createMcpServer(provider: CiProvider): McpServer {
  const server = new McpServer({
    name: 'cirelay',
    version: '0.1.0-alpha.3',
  });
  const handlers = new CiToolHandlers(provider);
  server.tool(
    'list_ci_runs',
    TOOL_DESCRIPTIONS.listCiRuns,
    {
      ...repositoryShape,
      ...runSelectorShape,
    },
    async ({
      owner,
      repository,
      runId,
      commitSha,
      pullRequestNumber,
      branch,
      conclusion,
      latest,
      limit,
    }) =>
      output(
        await handlers.listCiRuns({
          repository: { owner, name: repository },
          ...(runId ? { runId } : {}),
          ...(commitSha ? { commitSha } : {}),
          ...(pullRequestNumber !== undefined ? { pullRequestNumber } : {}),
          ...(branch ? { branch } : {}),
          ...(conclusion ? { conclusion } : {}),
          ...(latest !== undefined ? { latest } : {}),
          ...(limit !== undefined ? { limit } : {}),
        }),
      ),
  );
  server.tool(
    'get_ci_status',
    TOOL_DESCRIPTIONS.getCiStatus,
    { ...repositoryShape, commitSha: z.string().optional() },
    async ({ owner, repository, commitSha }) =>
      output(
        await handlers.getCiStatus({ owner, name: repository }, commitSha),
      ),
  );
  server.tool(
    'list_failed_jobs',
    TOOL_DESCRIPTIONS.listFailedJobs,
    { ...repositoryShape, runId: z.string() },
    async ({ owner, repository, runId }) =>
      output(await handlers.listFailedJobs({ owner, name: repository }, runId)),
  );
  server.tool(
    'get_job_log',
    TOOL_DESCRIPTIONS.getJobLog,
    { ...repositoryShape, jobId: z.string() },
    async ({ owner, repository, jobId }) =>
      output(await handlers.getJobLog({ owner, name: repository }, jobId)),
  );
  server.tool(
    'search_job_logs',
    TOOL_DESCRIPTIONS.searchJobLogs,
    {
      ...repositoryShape,
      jobId: z.string().min(1),
      patterns: z.array(z.string().min(1).max(200)).min(1).max(20),
      excludePatterns: z.array(z.string().min(1).max(200)).max(20).optional(),
      contextBefore: z.number().int().min(0).max(20).optional(),
      contextAfter: z.number().int().min(0).max(20).optional(),
      maxMatches: z.number().int().min(1).max(100).optional(),
      sourcePolicy: z
        .enum(['prefer-cache', 'cache-only', 'refresh'])
        .default('prefer-cache'),
    },
    async ({
      owner,
      repository,
      jobId,
      patterns,
      excludePatterns,
      contextBefore,
      contextAfter,
      maxMatches,
      sourcePolicy,
    }) =>
      output(
        await handlers.searchJobLogs({
          repository: { owner, name: repository },
          jobId,
          patterns,
          ...(excludePatterns ? { excludePatterns } : {}),
          ...(contextBefore !== undefined ? { contextBefore } : {}),
          ...(contextAfter !== undefined ? { contextAfter } : {}),
          ...(maxMatches !== undefined ? { maxMatches } : {}),
          sourcePolicy,
        }),
      ),
  );
  server.tool(
    'get_failure_context',
    TOOL_DESCRIPTIONS.getFailureContext,
    {
      ...repositoryShape,
      ...runSelectorShape,
      sourcePolicy: z
        .enum(['prefer-cache', 'cache-only', 'refresh'])
        .default('prefer-cache')
        .describe(
          'prefer-cache reuses logs, cache-only forbids remote log access, and refresh reloads selected job logs',
        ),
      extractionProfile: z
        .enum(['generic', 'java-maven', 'java-spring', 'node-pnpm'])
        .optional()
        .describe('Deterministic framework-aware evidence extraction profile'),
    },
    async ({
      owner,
      repository,
      runId,
      commitSha,
      pullRequestNumber,
      branch,
      conclusion,
      latest,
      limit,
      sourcePolicy,
      extractionProfile,
    }) =>
      output(
        await handlers.getFailureContext(
          {
            repository: { owner, name: repository },
            ...(runId ? { runId } : {}),
            ...(commitSha ? { commitSha } : {}),
            ...(pullRequestNumber !== undefined ? { pullRequestNumber } : {}),
            ...(branch ? { branch } : {}),
            ...(conclusion ? { conclusion } : {}),
            ...(latest !== undefined ? { latest } : {}),
            ...(limit !== undefined ? { limit } : {}),
          },
          sourcePolicy,
          extractionProfile,
        ),
      ),
  );
  return server;
}

export async function serveStdio(provider: CiProvider): Promise<void> {
  await createMcpServer(provider).connect(new StdioServerTransport());
}
