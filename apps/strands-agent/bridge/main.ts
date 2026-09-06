#!/usr/bin/env node
import { createGitHubActionsProvider } from '@cirelay/github';
import { CiToolHandlers } from '@cirelay/mcp';

interface Request {
  operation: 'list_ci_runs' | 'get_failure_context';
  arguments: {
    repository: { owner: string; name: string };
    runId?: string;
    conclusion?: 'failure';
    latest?: boolean;
    limit?: number;
  };
}

const readStdin = async (): Promise<string> => {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += String(chunk);
  return input;
};

const token = process.env.GITHUB_TOKEN;
if (!token)
  throw new Error('GITHUB_TOKEN is required to access GitHub Actions');

const request = JSON.parse(await readStdin()) as Request;
const handlers = new CiToolHandlers(createGitHubActionsProvider(token));
let result: unknown;

if (request.operation === 'list_ci_runs') {
  result = await handlers.listCiRuns(request.arguments);
} else if (request.operation === 'get_failure_context') {
  result = await handlers.getFailureContext(request.arguments);
} else {
  throw new Error('Unsupported CIRelay bridge operation');
}

process.stdout.write(JSON.stringify(result));
