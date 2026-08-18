import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { CiProvider, CiRun } from '@cirelay/core';
import { createMcpServer } from './server.js';

const repository = { owner: 'acme', name: 'app' };
const run: CiRun = {
  id: '7',
  provider: 'test',
  repository,
  name: 'CI',
  commit: { sha: 'head' },
  status: 'completed',
  conclusion: 'failure',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const provider: CiProvider = {
  name: 'test',
  listRuns: () => Promise.resolve([run]),
  getRun: () => Promise.resolve(run),
  listJobs: () => Promise.resolve([]),
  getJobLog: () => Promise.resolve(''),
};

async function connectedClient() {
  const server = createMcpServer(provider);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

describe('MCP server', () => {
  it('advertises query selectors without requiring runId', async () => {
    const { client, server } = await connectedClient();
    const tool = (await client.listTools()).tools.find(
      ({ name }) => name === 'get_failure_context',
    );

    expect(tool?.inputSchema.required).toEqual(['owner', 'repository']);
    expect(tool?.inputSchema.properties).toMatchObject({
      runId: {},
      commitSha: {},
      pullRequestNumber: {},
      branch: {},
      conclusion: {},
      latest: {},
      limit: {},
    });
    await Promise.all([client.close(), server.close()]);
  });

  it('accepts both the old runId call and a query-based call', async () => {
    const { client, server } = await connectedClient();
    const oldResult = await client.callTool({
      name: 'get_failure_context',
      arguments: { owner: 'acme', repository: 'app', runId: '7' },
    });
    const queryResult = await client.callTool({
      name: 'get_failure_context',
      arguments: {
        owner: 'acme',
        repository: 'app',
        commitSha: 'head',
        latest: true,
      },
    });

    expect(oldResult.isError).not.toBe(true);
    expect(queryResult.isError).not.toBe(true);
    await Promise.all([client.close(), server.close()]);
  });

  it('rejects malformed selector values at the MCP boundary', async () => {
    const { client, server } = await connectedClient();
    const result = await client.callTool({
      name: 'get_failure_context',
      arguments: {
        owner: 'acme',
        repository: 'app',
        pullRequestNumber: 0,
      },
    });

    expect(result.isError).toBe(true);
    await Promise.all([client.close(), server.close()]);
  });
});
