#!/usr/bin/env node
/**
 * CIRelay eval harness — java-spring profile.
 *
 * Feeds production-shaped GitHub Actions logs (real Maven output wrapped in the
 * Actions line format) through the provider-neutral core and reports:
 *   - token reduction: raw job log vs serialized FailureContext
 *   - evidence recall: does the context still contain the facts an agent needs
 *
 * Usage: node benchmarks/java-spring/run-benchmark.mjs [--json]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from 'gpt-tokenizer';
import {
  buildFailureContext,
  compactFailureContext,
} from '../../packages/core/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(here, 'samples');
const repository = { owner: 'WaterMelonKnight', name: 'FinStream' };
const commitSha = '0000000000000000000000000000000000000000';
const generatedAt = '2026-11-20T04:30:00.000Z';

class LocalLogProvider {
  name = 'local-fixture';
  constructor(log) {
    this.log = log;
  }
  async listRuns() {
    return [this.#run()];
  }
  async getRun() {
    return this.#run();
  }
  async listJobs() {
    return [this.#job()];
  }
  async getJobLog() {
    return this.log;
  }
  #run() {
    return {
      id: 'eval-run',
      provider: 'local-fixture',
      repository,
      name: 'CI',
      commit: { sha: commitSha },
      status: 'completed',
      conclusion: 'failure',
      createdAt: '2026-11-20T04:12:30.000Z',
      updatedAt: '2026-11-20T04:20:00.000Z',
    };
  }
  #job() {
    return {
      id: 'eval-job',
      runId: 'eval-run',
      name: 'build',
      status: 'completed',
      conclusion: 'failure',
      steps: [
        {
          number: 1,
          name: 'Run mvn -B -ntp test',
          status: 'completed',
          conclusion: 'failure',
        },
      ],
    };
  }
}

const tokens = (text) => encode(text).length;

async function evaluate(name) {
  const dir = path.join(samplesDir, name);
  const log = readFileSync(path.join(dir, 'job.log'), 'utf8');
  const expected = JSON.parse(
    readFileSync(path.join(dir, 'expected.json'), 'utf8'),
  );

  const context = await buildFailureContext(
    new LocalLogProvider(log),
    { repository, runId: 'eval-run' },
    { extractionProfile: 'java-spring', now: () => new Date(generatedAt) },
  );

  // The model-facing payload is the compact view (what get_failure_context returns);
  // the full object is kept for the API-level comparison.
  const serialized = JSON.stringify(compactFailureContext(context));
  const haystack = serialized;
  const hits = expected.mustInclude.filter((needle) =>
    haystack.includes(needle),
  );
  const missing = expected.mustInclude.filter(
    (needle) => !haystack.includes(needle),
  );

  const rawTokens = tokens(log);
  const contextTokens = tokens(serialized);
  const fullTokens = tokens(JSON.stringify(context));

  return {
    name,
    kind: expected.kind,
    rawChars: log.length,
    rawLines: log.split('\n').length,
    rawTokens,
    contextChars: serialized.length,
    contextTokens,
    fullTokens,
    reductionPct: Number((100 * (1 - contextTokens / rawTokens)).toFixed(1)),
    fullReductionPct: Number((100 * (1 - fullTokens / rawTokens)).toFixed(1)),
    evidenceCount: context.evidence.length,
    categories: [...new Set(context.evidence.map((e) => e.category))].sort(),
    recall: hits.length / expected.mustInclude.length,
    missing,
  };
}

const names = readdirSync(samplesDir)
  .filter((d) => !d.startsWith('.'))
  .sort();
const rows = [];
for (const name of names) rows.push(await evaluate(name));

let matched = 0;
let required = 0;
for (const r of rows) {
  const exp = JSON.parse(
    readFileSync(path.join(samplesDir, r.name, 'expected.json'), 'utf8'),
  );
  required += exp.mustInclude.length;
  matched += exp.mustInclude.length - r.missing.length;
}
const rawTokens = rows.reduce((sum, r) => sum + r.rawTokens, 0);
const contextTokens = rows.reduce((sum, r) => sum + r.contextTokens, 0);
const summary = {
  samples: rows.length,
  rawTokens,
  contextTokens,
  reductionPct: Number((100 * (1 - contextTokens / rawTokens)).toFixed(1)),
  recallPct: Number((100 * (matched / required)).toFixed(1)),
  matched,
  required,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  const pad = (v, n) => String(v).padEnd(n);
  console.log(
    'sample                     rawTok  ctxTok  cut%  evid  recall  missing',
  );
  for (const r of rows) {
    console.log(
      `${pad(r.name, 26)} ${pad(r.rawTokens, 7)} ${pad(r.contextTokens, 7)} ${pad(r.reductionPct, 5)} ${pad(r.evidenceCount, 5)} ${pad((r.recall * 100).toFixed(0) + '%', 7)} ${r.missing.join(', ') || '-'}`,
    );
  }
  console.log(
    `TOTAL: ${summary.reductionPct}% token cut, recall ${summary.matched}/${summary.required} (${summary.recallPct}%)`,
  );
}

if (process.argv.includes('--write-results')) {
  const lines = [
    '# CIRelay eval — java-spring profile',
    '',
    `Generated: ${new Date().toISOString()} · samples: ${summary.samples} · profile: \`java-spring\``,
    '',
    'Logs are real `mvn -B -ntp test` output from a copy of FinStream, wrapped in the',
    'GitHub Actions line format (timestamp prefix, `##[group]`, trailing `##[error]`),',
    'because that is the shape the GitHub provider returns. Token counts use `gpt-tokenizer`.',
    '',
    '| sample | raw tokens | compact tokens | cut | evidence | recall | missing |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.rawTokens} | ${r.contextTokens} | ${r.reductionPct}% | ${r.evidenceCount} | ${(r.recall * 100).toFixed(0)}% | ${r.missing.join(', ') || '—'} |`,
    ),
    '',
    `**Total: ${summary.reductionPct}% token reduction (compact, model-facing), evidence recall ${summary.matched}/${summary.required} (${summary.recallPct}%).**`,
    '',
  ];
  writeFileSync(path.join(here, 'RESULTS.md'), lines.join('\n'));
  writeFileSync(
    path.join(here, 'results.json'),
    JSON.stringify({ summary, rows }, null, 2) + '\n',
  );
  console.log('wrote RESULTS.md and results.json');
}
