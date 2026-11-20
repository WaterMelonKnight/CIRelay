# CIRelay eval — java-spring profile

Generated: 2026-11-20T05:11:14.424Z · samples: 5 · profile: `java-spring`

Logs are real `mvn -B -ntp test` output from a copy of FinStream, wrapped in the
GitHub Actions line format (timestamp prefix, `##[group]`, trailing `##[error]`),
because that is the shape the GitHub provider returns. Token counts use `gpt-tokenizer`.

| sample | raw tokens | context tokens | cut | evidence | recall | missing |
| --- | --- | --- | --- | --- | --- | --- |
| 01-compile-error | 1532 | 1700 | -11% | 17 | 100% | — |
| 02-test-assertion | 17466 | 9171 | 47.5% | 64 | 100% | — |
| 03-dependency-resolution | 768 | 1225 | -59.5% | 10 | 100% | — |
| 04-spring-context | 99897 | 16378 | 83.6% | 97 | 100% | — |
| 05-runtime-npe | 17457 | 9657 | 44.7% | 65 | 100% | — |

**Total: 72.2% token reduction, evidence recall 10/10 (100%).**
