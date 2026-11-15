import { createHash } from 'node:crypto';
import {
  RunResolutionError,
  type CiProvider,
  type CiRun,
  type RepositoryRef,
} from '@cirelay/core';
import { CiToolHandlers } from '@cirelay/mcp';
import type { InvestigationExecutor } from './controller.js';
import type { EvidenceItem, InvestigationState, Observation } from './types.js';

/** Stable content IDs omit timestamps, query order and action IDs. No extraction occurs here. */
function evidence(item: Omit<EvidenceItem, 'id'>): EvidenceItem {
  return {
    id: createHash('sha256').update(JSON.stringify(item)).digest('hex'),
    ...item,
  };
}
function sameRepository(
  a: Readonly<RepositoryRef>,
  b: Readonly<RepositoryRef>,
): boolean {
  return a.owner === b.owner && a.name === b.name;
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Create once per investigation; never share the handler/cache across investigations. */
export function createHandlerExecutor(
  provider: CiProvider,
  repository: Readonly<RepositoryRef>,
): InvestigationExecutor {
  const scope = { ...repository };
  const handlers = new CiToolHandlers(provider);
  let selected: CiRun | undefined;
  let jobs = new Map<string, { url?: string }>();
  function validateRun(run: CiRun): void {
    check(
      sameRepository(run.repository, scope) && run.provider === provider.name,
      'Provider returned a run outside the investigation repository/provider',
    );
    check(
      !selected ||
        (run.id === selected.id && run.commit.sha === selected.commit.sha),
      'Provider returned a different run',
    );
    check(
      run.status === 'completed' &&
        (run.conclusion === 'failure' || run.conclusion === 'timed_out'),
      'Selected run is no longer a completed failed CI run',
    );
  }
  return {
    async execute(state: InvestigationState): Promise<Observation> {
      check(state.pending, 'Executor requires an admitted action');
      const { actionId, action } = state.pending;
      const base = { actionId, evidence: [] };
      check(
        sameRepository(state.repository, scope),
        'Executor belongs to a different repository',
      );
      try {
        if (action.kind === 'list_ci_runs') {
          check(!selected, 'Executor session has already selected a run');
          const runs = await handlers.listCiRuns({
            ...action.query,
            repository: scope,
          });
          // Never silently select from an ambiguous query or substitute another run.
          if (runs.length !== 1)
            return {
              ...base,
              summary: 'Multiple CI runs matched',
              escalation: {
                reason: 'ambiguous-evidence',
                detail: 'Resolve one CI run explicitly or use latest',
              },
            };
          const run = runs[0]!;
          check(
            sameRepository(run.repository, scope) &&
              run.provider === provider.name,
            'Run provenance mismatch',
          );
          check(
            !action.query.runId || action.query.runId === run.id,
            'Run ID does not match the query',
          );
          if (
            run.status !== 'completed' ||
            (run.conclusion !== 'failure' && run.conclusion !== 'timed_out')
          ) {
            return {
              ...base,
              summary: 'No completed failed CI run matched',
              escalation: {
                reason: 'no-failed-run',
                detail: 'The selected run has not failed',
              },
            };
          }
          selected = structuredClone(run);
          return {
            actionId,
            summary: 'Resolved failed CI run',
            resolvedRunId: run.id,
            evidence: [
              evidence({
                source: 'run-resolution',
                message: `${run.name}: ${run.conclusion}`,
                provenance: {
                  provider: run.provider,
                  runId: run.id,
                  ...(run.url ? { url: run.url } : {}),
                },
              }),
            ],
          };
        }
        check(
          selected && state.runId === selected.id,
          'Executor run does not match the investigation',
        );
        if (action.kind === 'get_failure_context') {
          const context = await handlers.getFailureContext(
            { repository: scope, runId: selected.id },
            action.options.logSourcePolicy,
            action.options.extractionProfile,
          );
          validateRun(context.run);
          check(
            context.provider === provider.name &&
              sameRepository(context.repository, scope),
            'Failure context provenance mismatch',
          );
          const nextJobs = new Map(
            context.failedJobs.map(({ job }) => {
              check(
                job.runId === selected!.id,
                'Failure context job belongs to a different run',
              );
              return [
                job.id,
                { ...(job.url ? { url: job.url } : {}) },
              ] as const;
            }),
          );
          const items = context.evidence.map((item) => {
            check(
              !item.jobId || nextJobs.has(item.jobId),
              'Evidence belongs to an unknown job',
            );
            const url = item.jobId
              ? nextJobs.get(item.jobId)?.url
              : context.run.url;
            return evidence({
              source: 'failure-context',
              message: item.message,
              provenance: {
                provider: context.provider,
                runId: selected!.id,
                ...(item.jobId ? { jobId: item.jobId } : {}),
                ...(item.lineNumber !== undefined
                  ? { lineNumber: item.lineNumber }
                  : {}),
                ...(url ? { url } : {}),
              },
              ...(item.category ? { category: item.category } : {}),
            });
          });
          for (const { job } of context.failedJobs) {
            items.push(
              evidence({
                source: 'failure-context',
                message: `${job.name}: ${job.conclusion}`,
                provenance: {
                  provider: context.provider,
                  runId: selected.id,
                  jobId: job.id,
                  ...(job.url ? { url: job.url } : {}),
                },
              }),
            );
          }
          jobs = nextJobs;
          return {
            actionId,
            summary: `Collected failure context for ${jobs.size} failed jobs`,
            evidence: items,
          };
        }
        check(
          jobs.has(action.query.jobId),
          'Search job is not a failed job of the selected run',
        );
        const { patterns, excludePatterns, ...query } = action.query;
        const result = await handlers.searchJobLogs({
          ...query,
          repository: scope,
          patterns: [...patterns],
          ...(excludePatterns ? { excludePatterns: [...excludePatterns] } : {}),
        });
        check(
          sameRepository(result.repository, scope) &&
            result.jobId === action.query.jobId,
          'Search result provenance mismatch',
        );
        const url = jobs.get(result.jobId)?.url;
        return {
          actionId,
          summary: `Search returned ${result.matches.length} of ${result.matchCount} matches${result.truncated ? ' (truncated)' : ''}`,
          evidence: result.matches.map((match) =>
            evidence({
              source: 'log-search',
              message: match.line,
              provenance: {
                provider: provider.name,
                runId: selected!.id,
                jobId: result.jobId,
                lineNumber: match.lineNumber,
                ...(url ? { url } : {}),
              },
            }),
          ),
        };
      } catch (error) {
        if (
          error instanceof RunResolutionError &&
          (!error.cause ||
            (typeof error.cause === 'object' &&
              error.cause !== null &&
              'status' in error.cause &&
              error.cause.status === 404)) &&
          (error.code === 'no-matching-run' ||
            error.code === 'unsupported-capability')
        ) {
          return {
            ...base,
            summary: error.message,
            escalation: {
              reason:
                error.code === 'no-matching-run'
                  ? 'no-failed-run'
                  : 'unsupported-capability',
              detail: error.message,
            },
          };
        }
        throw error; // Controller records the error and consumes the admitted step.
      }
    },
  };
}
