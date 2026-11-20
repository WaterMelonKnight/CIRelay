# java-spring eval

A five-sample harness that measures the two things CIRelay claims:
**token reduction** (how much of a CI log never reaches the model) and
**evidence recall** (whether the failure facts an agent needs survive the reduction).

## Why these logs

Every `job.log` is real `mvn -B -ntp test` output from a copy of
[FinStream](https://github.com/WaterMelonKnight/FinStream), wrapped in the
GitHub Actions line format (`2026-…Z ` timestamp prefix per line, `##[group]`,
trailing `##[error]Process completed with exit code 1.`). That wrapping matters:
the GitHub provider returns logs exactly in that shape, and anchored parsers
have to cope with the prefix.

| sample                   | what breaks                                         | why it matters                       |
| ------------------------ | --------------------------------------------------- | ------------------------------------ |
| 01-compile-error         | one undeclared enum constant                        | the classic "did not compile" case   |
| 02-test-assertion        | one inverted AssertJ expectation                    | surefire noise + failing method name |
| 03-dependency-resolution | a dependency that does not exist                    | fails before compiling, short log    |
| 04-spring-context        | `@SpringBootTest` against an unreachable datasource | 2.7k lines / 227 KB of stack traces  |
| 05-runtime-npe           | `NullPointerException` inside a test                | exception header + frames            |

## Run it

```sh
pnpm -r --sort build
node benchmarks/java-spring/run-benchmark.mjs            # table
node benchmarks/java-spring/run-benchmark.mjs --json     # machine readable
node benchmarks/java-spring/run-benchmark.mjs --write-results
```

`RESULTS.md` and `results.json` are regenerated from the samples; they are not hand-written.

## What the harness found

Running the baseline (before the fixes in this branch) produced
`66.9% token cut, 9/10 evidence recall`:

1. **Stack traces were silently dropped.** GitHub prefixes every log line with an
   RFC3339 timestamp. Patterns anchored with `^\s*` (`java`, `generic`, and the
   `STACK_PATTERN` used for `stackTraceCandidates`) never matched, so
   `NullPointerException` disappeared from the context. Fix: strip the prefix
   before parsing, keeping one line per input line so reported line numbers still
   refer to the raw log (`stripActionsLogPrefix`).
2. **Evidence was unbounded, then inverted the reduction.** Once stack traces were
   captured, stack-heavy samples ballooned (04 reached 514 evidence entries,
   context ≈ 51k tokens). Frames now cap at 12 per job while exception headers and
   `Caused by:` lines are always kept.

After both fixes: `72.2% token cut, 10/10 evidence recall`.

3. **The same text was stored up to three times.** `errorLines` and
   `stackTraceCandidates` are projections of `evidence`, and `logExcerpt` usually
   repeats the evidence lines. `compactFailureContext()` (now what
   `get_failure_context` returns) drops the derivable duplicates and keeps the
   excerpt only when it carries context lines that evidence does not. Model-facing
   cut: **79.9%**.

## Known limitations

- **Very short logs still inflate.** 01 is now +7% (it was −11% before the compact
  view), but 03 (`−34%`, a 19-line dependency-resolution log) is still net-negative:
  below roughly 1k tokens the envelope costs more than the log. There is no
  reduction to be had at that size — use the raw log.
- **Synthetic CI, real Maven.** No GitHub Actions run was triggered; the wrapper is
  byte-shaped like Actions output but the run IDs are local fixtures.
- **One repository.** All samples come from FinStream's stack; more languages and
  repos would be needed before quoting these numbers as general.
- Token counts use `gpt-tokenizer` (cl100k) and are estimates, not provider billing.
