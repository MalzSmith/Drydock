---
name: drydock-regression-testing
description: Full end-to-end regression test of the Drydock app (unit tests, build, boot, tour, blueprints, sources, gzip, mods, rendering, export, compose, locales, narrow page, persistence) with two parallel browser runners, a self-maintaining step catalogue, merged reports with run-to-run comparison, and its own report storage. Use when asked to regression test Drydock, run the regression suite, check a change end to end, or before a release.
---

# Drydock regression testing

This skill runs a complete regression test of the Drydock checkout at `<repo>` and keeps itself in line with the code. The agent that invokes it is the **coordinator**; it maintains the skill, prepares a run, launches two **runners** (A and B) as subagents, and merges their reports. Runners test and report. They never fix anything.

## Layout

```
.claude/skills/drydock-regression-testing/
  SKILL.md                this file: roles, procedure, rules
  maintenance.json        commit and date the skill was last verified against
  reference/
    environment.md        prerequisites, test data, runner isolation, variables
    harness.md            scripts, fixtures, driver usage, selector reference, open paths
    steps-setup.md        E (setup) and S (static checks), execution order
    steps-boot.md         B (boot), T (tour), U (URL parameters)
    steps-blueprints.md   O (open), L (link), G (gzip/plain), M (mods, missing)
    steps-render-export.md  R (render), X (export)
    steps-compose.md      C (compose)
    steps-locale-narrow-persist.md  I (locales), N (narrow), P (persistence), F (focus)
    steps-teardown.md     Z (teardown)
    report.md             runner report format
    maintenance.md        how the skill maintains itself, file → step map
  scripts/
    env.sh                writes work/<runner>/env.sh (discovery, ports, paths)
    lib.mjs, driver.mjs, dd.sh, make-fixtures.mjs   browser harness
    audit.mjs             checks the documents against the code
    run.mjs               new | merge | prune | list run folders
  work/<A|B>/             transient per-runner state (profiles, fixtures, build). git-ignored, deleted in Z4
  reports/<id>/           one folder per run. git-ignored, pruned to 10
    run.json, focus.md, audit.json, maintenance.md, report.md (merged)
    A/ B/                 runner output: report.md, logs/, shots/, files/
```

Run id: `YYYYMMDD-HHMMSS-<sha7>`. `run.mjs merge` keeps the 10 newest run folders and deletes `shots/` and `files/` from all but the 3 newest, so complete evidence exists for recent runs and report plus logs for older ones.

## Procedure (coordinator)

Work from the repository root. `SKILL` below is the absolute path of this folder, with forward slashes.

1. **Preconditions.** `node_modules` present, Edge installed, no uncommitted change you did not expect (`git status`). Read `reference/environment.md` once. If `node_modules` is missing, stop and say so; do not install it as part of a test run without being asked.
2. **Maintenance before the run** (`reference/maintenance.md`, "Before the run"): create the run folder first so the audit has a place to write:
   ```sh
   RUN="$(node "$SKILL/scripts/run.mjs" new)"
   node "$SKILL/scripts/audit.mjs" "$RUN/audit.json"
   git log --oneline "$(node -p "require('$SKILL/maintenance.json').commit")"..HEAD
   ```
   Fix every `MISSING` item in the documents, review the commits, update steps, write `$RUN/focus.md`, rerun the audit until it exits 0, update `maintenance.json`. Edits to the skill are ordinary uncommitted working-tree changes; do not commit them unless the user asks. Do this before the runners take their E3 baseline, so the baseline includes your edits.
3. **Launch the runners** in parallel with the Agent tool (`subagent_type: general-purpose`), one prompt each, using the template below. They run 25–40 minutes. Do not poll; wait for both completion notifications.
4. **Maintenance after the run** ("After the run" in `reference/maintenance.md`): check defects marked as suspected stale steps against the code, fix stale steps and harness problems, write `$RUN/maintenance.md`.
5. **Merge:** `node "$SKILL/scripts/run.mjs" merge "$RUN"`. It writes `$RUN/report.md`, compares with the previous merged run (new failures, fixed, added and removed steps), prunes old runs and prints the summary.
6. **Report to the user:** the overall counts, the changes since the previous run, every defect with its severity in one line each, the maintenance edits made to the skill, and the path of `report.md`. Do not fix app defects as part of the run; list them. If a defect's cause is a stale step, say so and that the step has been corrected.

If only one runner can run (for example the machine is busy), run A alone with its lanes (it carries the static checks) and say so in the report; `run.mjs merge` handles a single runner.

### Runner prompt template

Replace the angle-bracket values. Give the runner the absolute paths; it has no other context.

```
You are runner <A|B> of the Drydock regression test. Follow the skill at <SKILL> exactly.

Read, in this order: <SKILL>/reference/environment.md, harness.md, steps-setup.md, steps-boot.md, steps-blueprints.md, steps-render-export.md, steps-compose.md, steps-locale-narrow-persist.md, steps-teardown.md, report.md, and the focus checks in <RUN>/focus.md.

Settings: DD_SKILL=<SKILL>, runner id <A|B>, run folder <RUN>, repo <REPO>.
Start with: sh "<SKILL>/scripts/env.sh" <A|B> "<RUN>"   and begin every later shell command with   . "<SKILL>/work/<A|B>/env.sh"

Rules you must keep:
1. Do not modify the repository. Write only under $DD_WORK and $DD_OUT. No npm install/ci/build, no git add/commit/stash/checkout. Runner B does not run the static checks (S1–S5 are SKIP, owned by runner A).
2. Do not fix code or steps. A failure is a defect with repro steps; continue with the next independent step. When you believe the step, not the app, is wrong, still report FAIL and set "Suspected stale step: yes" in the defect.
3. Report faithfully: PASS only when every criterion was checked and met with evidence. A step that passes only on retry is PASS with the note "flaky: failed first attempt" plus a defect of severity minor or higher. One retry at most per step.
4. Stay in your lane: your ports, your profiles, your driver. Never stop a process you did not start, never kill by image name.
5. Shared test data (game, workshop, blueprint folders) is read-only.
6. A browser step also fails on any unexpected pageerror, console.error or request to another origin (lib.drain).
7. Keep each shell command under your tool's time limit; long operations are started once and polled.
8. Always run the teardown Z1–Z4, also after failures.

Execution order: E1–E4 → S1–S5 (A only) → E5–E6 → B1–B2 → T1, T2, T2b, T3–T5 → U1–U6 → O1–O9 → L1–L6 → G1–G7 → M1–M4 → L7–L14 → M5–M9 → G8 → R1–R13 → X1–X13 → C1–C20 → I1–I4 → N1–N5 → P0–P7 → F (focus.md) → Z1–Z4.

Deliver: write the report in the exact format of report.md to $DD_OUT/report.md and return the same text as your final message.
```

## Rules for runners (summary; the prompt above carries them)

Result values: **PASS** executed, every criterion met, evidence recorded. **FAIL** executed, a criterion not met, at least one defect. **BLOCKED** not executable because of an earlier failure or a harness/environment problem, with reason. **SKIP** not applicable for this runner or machine (owned by the other runner, test data missing, manual-only), with reason. A step that depends on a failed step is `BLOCKED by <id>`.

## Rules for the coordinator

- The skill is the single source of truth for the regression test. Keep step ids stable; add new permanent behaviour as new steps, put one-off checks for a change into `focus.md`.
- Runners never edit the skill; you edit it only in the maintenance steps, and you record every edit in the run's `maintenance.md`.
- Nothing under `work/` or `reports/` is committed. Everything else in this folder is.
- Never report a run as passed when a runner did not finish; a missing runner report is itself a BLOCKED run, and `run.mjs merge` will tell you which runner is missing.
