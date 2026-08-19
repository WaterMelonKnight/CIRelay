export const TOOL_DESCRIPTIONS = {
  listCiRuns:
    'Preferred tool to resolve or explore a CI run when it is not already known; filter by run ID, PR, commit, branch, conclusion, or recency, then use get_failure_context for failure diagnosis.',
  getCiStatus:
    'Check CI state quickly for pass/fail or recent-status questions, optionally for a commit. For detailed failure diagnosis, continue with get_failure_context.',
  listFailedJobs:
    'List job-level failures when the CI run is already known and only failed-job information is needed. Prefer get_failure_context for full failure diagnosis.',
  getJobLog:
    'Retrieve a complete raw CI job log only as a final fallback when structured FailureContext and targeted search_job_logs results are insufficient; do not fetch full logs by default.',
  searchJobLogs:
    'Targeted follow-up when get_failure_context evidence is insufficient or ambiguous. Search for narrow literal patterns derived from evidence or a concrete hypothesis; do not use as the first investigation step, and prefer it before get_job_log.',
  getFailureContext:
    'Primary diagnostic tool for CI failures. Retrieves deterministic, bounded structured evidence including failed jobs and steps and extracted relevant evidence. Use before raw logs; stop if sufficient, otherwise use search_job_logs for targeted follow-up.',
} as const;
