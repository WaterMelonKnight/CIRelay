#!/usr/bin/env node
import { createGitHubActionsProvider } from '@cirelay/github';
import { serveStdio } from './server.js';

const token = process.env.GITHUB_TOKEN;
if (!token)
  throw new Error('GITHUB_TOKEN is required to access GitHub Actions');
await serveStdio(createGitHubActionsProvider(token));
