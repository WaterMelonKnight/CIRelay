import type { CiProvider } from '@cirelay/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CiToolHandlers } from './handlers.js';

const repositoryShape = {
  owner: z.string().min(1),
  repository: z.string().min(1),
};
const output = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

export function createMcpServer(provider: CiProvider): McpServer {
  const server = new McpServer({ name: 'cirelay', version: '0.1.0' });
  const handlers = new CiToolHandlers(provider);
  server.tool(
    'get_ci_status',
    'List recent CI runs, optionally for a commit',
    { ...repositoryShape, commitSha: z.string().optional() },
    async ({ owner, repository, commitSha }) =>
      output(
        await handlers.getCiStatus({ owner, name: repository }, commitSha),
      ),
  );
  server.tool(
    'list_failed_jobs',
    'List failed jobs for a CI run',
    { ...repositoryShape, runId: z.string() },
    async ({ owner, repository, runId }) =>
      output(await handlers.listFailedJobs({ owner, name: repository }, runId)),
  );
  server.tool(
    'get_job_log',
    'Get the raw log for a CI job',
    { ...repositoryShape, jobId: z.string() },
    async ({ owner, repository, jobId }) =>
      output(await handlers.getJobLog({ owner, name: repository }, jobId)),
  );
  server.tool(
    'get_failure_context',
    'Build deterministic structured failure context',
    { ...repositoryShape, runId: z.string() },
    async ({ owner, repository, runId }) =>
      output(
        await handlers.getFailureContext({ owner, name: repository }, runId),
      ),
  );
  return server;
}

export async function serveStdio(provider: CiProvider): Promise<void> {
  await createMcpServer(provider).connect(new StdioServerTransport());
}
