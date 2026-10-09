# Runner report

Write the report to `$DD_OUT/report.md` and also return the same text as your final message. A shell heredoc of the whole report breaks on quoting, and the Write tool may refuse report files in a subagent; if so, write it with the editor tool to a scratch file under `$DD_WORK` and `cp` it to `$DD_OUT/report.md`. If every way fails, say so in Deviations; the coordinator then saves the returned text before the merge. `scripts/run.mjs merge` parses the header bullets, the Results table, the `### D…` defect blocks and the Observations and Deviations sections, so keep the format exactly:

```markdown
# Drydock regression report — runner <A|B>

- Date/time (start, end):
- Commit: <git rev-parse HEAD>; working tree: <modified files from E3>; diff sha256: <value>
- Server: <preview of $DD_DIST | vite dev>, <url>
- Node <v>, playwright-core <v>, Edge <v>, WebGL renderer <string>
- Test data: game <yes/no>, workshop <n blueprints, n mod folders>, local <n>, cloud <n gzipped>, fixture mod <id or none>
- Other activity on the machine that may matter: <other runner, a developer server, none>

## Summary
PASS n · FAIL n · BLOCKED n · SKIP n

## Results
| Step | Result | Evidence | Notes |
|---|---|---|---|
| E1 | PASS | logs/env.txt | |
| S1 | PASS | logs/S1-vitest.txt | 3 gzip tests passed; game assets suite ran |
| G3 | FAIL | logs/G3.json, shots/G3-*.png | pair "P Foo": rowsEqual false (see D2) |
| O8 | SKIP | — | manual: folder drag and drop cannot be scripted |
| ... | | | |

## Defects
### D1 <short title>
- Severity: blocker | major | minor | cosmetic
- Step(s): <ids>
- Repro:
  1. <exact action, starting from a fresh profile or a stated state>
  2. ...
- Expected: <criterion from the step>
- Actual: <observed value, toast text, console error>
- Evidence: <paths>
- Frequency: always | n of m attempts
- Suspected stale step: yes | no  (yes when the app behaves sensibly and the step's selector, text or expectation looks outdated)

## Observations
Things that are not defects but worth knowing (timings, the cloud-folder note from L4, warnings in the console, values close to a limit).

## Deviations
Any place where the step files could not be followed literally and what was done instead.
```

Rules:

- Every step id from E1 to Z4 appears exactly once, in the execution order from steps-setup.md, plus the F rows from `focus.md`.
- Result values: PASS (executed, every criterion met, evidence recorded), FAIL (executed, at least one criterion not met; at least one defect), BLOCKED (could not be executed because of an earlier failure or a harness/environment problem; give the reason), SKIP (not applicable for this runner or machine; give the reason).
- Evidence paths are relative to `$DD_OUT`; every FAIL links to at least one defect; do not merge defects with different causes; do not soften results.
- Do not propose or apply code changes. A one-line suspected cause is fine under Actual, marked as a guess. The "Suspected stale step" line is how the coordinator finds documentation drift; it does not change the result.
