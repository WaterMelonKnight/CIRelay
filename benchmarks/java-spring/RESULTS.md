# CIRelay eval — java-spring profile

Generated: 2026-11-20T05:40:59.225Z · samples: 5 · profile: `java-spring`

Logs are real `mvn -B -ntp test` output from a copy of FinStream, wrapped in the
GitHub Actions line format (timestamp prefix, `##[group]`, trailing `##[error]`),
because that is the shape the GitHub provider returns. Token counts use `gpt-tokenizer`.

| sample | raw tokens | compact tokens | cut | evidence | recall | missing |
| --- | --- | --- | --- | --- | --- | --- |
| 01-compile-error | 1532 | 1419 | 7.4% | 17 | 100% | — |
| 02-test-assertion | 17466 | 6931 | 60.3% | 64 | 100% | — |
| 03-dependency-resolution | 768 | 1028 | -33.9% | 10 | 100% | — |
| 04-spring-context | 99897 | 10834 | 89.2% | 97 | 100% | — |
| 05-runtime-npe | 17457 | 7308 | 58.1% | 65 | 100% | — |

**Total: 79.9% token reduction (compact, model-facing), evidence recall 10/10 (100%).**
