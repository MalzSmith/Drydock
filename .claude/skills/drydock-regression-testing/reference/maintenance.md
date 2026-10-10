# Maintenance

The skill maintains itself. Maintenance is the first and the last step of every run and is done by the coordinator, never by a runner (runners do not modify the repository). `maintenance.json` records the commit the skill was last brought in line with.

## Before the run

1. **Audit.** `node scripts/audit.mjs "$RUN/audit.json"` checks every selector, id, `data-tour` target, i18n key, `localStorage` key, URL parameter, `__drydock` hook, action name, unit-test name, repo path, locale list and `PARSE_VERSION` that SKILL.md and `reference/*.md` mention against the code. It exits 1 and lists what is missing. It also lists what the code has that the documents never mention (locales, tour targets, URL parameters, toast keys) under `uncovered`. Fix every `MISSING` entry before the run: read the component in `src/ui` (or the locale file, or `src/app.ts`) and update the selector table in harness.md and the steps that use it. Decide for every `uncovered` item whether a step should exercise it; add the step if so.
2. **Review the commits.** `git log --oneline <maintenance.json commit>..HEAD` and `git diff --stat <commit>..HEAD`. For each commit, read the diff of the touched files far enough to answer: which existing steps does this change, which steps are now wrong, and what new behaviour has no step. Use the map below to find the steps that a file affects.
3. **Update the steps.** Edit `reference/*.md` and `scripts/*.mjs` so the fixed steps match the current code. Rules for edits: keep step ids stable (a renamed or removed behaviour keeps its id with a note, a new permanent behaviour gets the next free id in its section; never renumber); keep pass criteria exact (values, texts, counts); when a check moves from a one-off focus check into a permanent step, say so in the run's `maintenance.md`.
4. **Write `focus.md`** in the run folder: the commit list since the previous run, and numbered focus checks `F1…` for new or changed behaviour that the fixed steps do not already cover (action, pass criterion, runner). If a commit is fully covered by existing steps, say which. If there is nothing to focus on, say so (runners then report `F0 SKIP`).
5. **Rerun the audit** until it exits 0, then set `maintenance.json` to the current `HEAD`, today's date and a one-line note of what changed in the skill.

If the working tree is dirty, the uncommitted changes are also "since the last run": review `git diff` (unstaged and staged) the same way, and record in `focus.md` that the run tests a dirty tree.

## After the run

1. Read both runner reports. Every defect marked `Suspected stale step: yes` is checked against the code: when the app is right and the step is outdated, fix the step (and the selector table) now, and record the fix in the run's `maintenance.md` as `step <id>: <what was wrong> → <what it says now>`. The defect stays in the report as the runner wrote it; the coordinator's merged report lists the correction under Maintenance.
2. Record flaky steps (PASS on retry) in `maintenance.md`; when the same step has been flaky in two consecutive runs, tighten its waiting condition in the step or in `lib.mjs`.
3. Harness failures (driver errors, Playwright exceptions, BLOCKED steps caused by the harness) are fixed in `scripts/` when the cause is clear, and recorded.
4. Write `maintenance.md` in the run folder (free text, bullets) before `run.mjs merge`, which copies it into the merged report. Update `maintenance.json` again if the skill was changed after the run.

## Toast keys without a step

The audit lists toast keys that no step mentions. These are failure paths that need an injected fault and have no fixed step on purpose; keep the list current when `src/locales/en.json` changes, and move a key out of it when a step starts covering it.

`@toast.composeFailed` (worker crash while building a composition), `@toast.exportFailed`, `@toast.copyFailed`, `@toast.turntableFailed` (renderer or encoder failure during export), `@toast.dropFailed` (drop handler exception, the non-blueprint and damaged cases go through `readFailed`), `@toast.storeListFailed`, `@toast.snapshotFailed`, `@toast.cacheFailed`, `@toast.clearFailed` (IndexedDB failures), `@toast.scanFailed` (scan worker exception). A focus check may cover one of them when a commit touches that path, for example by blocking IndexedDB in the test profile.

## Source file → steps map

Keep this table current; it is how step 2 finds what to re-read.

| Code | Steps |
|---|---|
| `src/app.ts` (URL parameters, `__drydock` hooks) | U1–U6, O1, every step that uses `window.__drydock` |
| `src/ui/tour.ts`, `src/styles/app.css` (tour) | T1–T5, I4 |
| `src/ui/nav.ts`, `src/ui/langMenu.ts` | B1, T3, I2, I3, L2 |
| `src/ui/blueprintPanel.ts` | O2, L2, L13, L14, G1, G4, M1, M4–M8 |
| `src/ui/sourcesDialog.ts`, `src/sources/*` | L1–L12, P1, P6 |
| `src/ui/missingDialog.ts` | M1, M2 |
| `src/ui/viewport.ts`, `src/render/camera.ts` | R5–R9, C18, C19 |
| `src/ui/right/view.ts` | R2–R4, M3, M7, P1, P7 |
| `src/ui/right/section.ts` | R9, C18 |
| `src/ui/right/scene.ts`, `src/render/sky.ts`, `src/assets/sky.ts` | R10–R12, P4 |
| `src/ui/right/export.ts`, `src/render/exportImage.ts`, `src/util/save.ts`, `src/util/zip.ts`, `src/util/webp.ts` | X1–X13 |
| `src/ui/composePanel.ts`, `src/compose/*`, `src/se/sbcWrite.ts` | C1–C20 |
| `src/se/blueprint.ts`, `src/workers/*` | O1–O6, O9, G1–G8, P2, P3, S1 test names |
| `src/sources/scan.ts`, `src/se/mods.ts`, `src/se/defs.ts` | L2–L4, L7–L10, M5, M8, M9 |
| `src/sources/idb.ts`, `src/state/derive.ts` | G7, P1–P6 |
| `src/render/*` (shaders, pbr, detail) | R1–R4, R12, G8, X2–X9 |
| `src/i18n.ts`, `src/locales/*.json` | S3, T1, I2–I4, N1, N2, every toast text |
| `index.html` (narrow page, string table) | S3, N1–N5 |
| `src/ui/footer.ts`, `public/count.js` | B1, T4 |
| `test/*.test.ts` | S1 (the named tests) |
| `package.json`, `vite.config.ts`, `tsconfig.json` | E2, E5, S2, S4 |
| `scripts/shot.mjs` | O1 |
| `README.md`, `ARCHITECTURE.md` | targets quoted in O9, S4 and R13; the test seams list |
