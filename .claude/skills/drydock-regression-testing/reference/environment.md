# Environment, test data and runner isolation

## Software

- Windows with Microsoft Edge installed (`scripts/shot.mjs` and the driver launch Playwright's `msedge` channel). Check: `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"` exists.
- Node.js 22.12 or newer. Check: `node -v`.
- The repository checkout with `node_modules` already installed (`node_modules/playwright-core`, `node_modules/vite`, `node_modules/vitest`, `node_modules/typescript`). If `node_modules` is missing, stop: every step is BLOCKED (runners do not install it).
- A working WebGL 2 in headless Edge (checked in step B2).
- `curl` (ships with Windows and Git Bash) for talking to the driver.

Commands in the step files use POSIX shell syntax (Git Bash). Paths are written with forward slashes (`C:/...`), which Node, Edge and Git Bash all accept. PowerShell is used only through `powershell -NoProfile -Command` for process and port queries.

## Test data

None of it is part of the repository. `scripts/env.sh` locates it; never copy a path that contains a user name or a Steam account id into the report's summary text (paths in evidence files are fine, they stay local).

| Data | Typical location | Variable | Used for |
|---|---|---|---|
| Game folder | `C:/Program Files (x86)/Steam/steamapps/common/SpaceEngineers`, or `SE_GAME_ROOT` | `SE_GAME_ROOT` | game source, models, textures, vanilla skyboxes, the `game assets` unit tests |
| Steam Workshop folder | `<Steam library>/steamapps/workshop/content/244850` | `DD_WORKSHOP` | workshop source: workshop blueprints and mods |
| Local blueprints | `%APPDATA%/SpaceEngineers/Blueprints/local` (one folder per blueprint, plain XML `bp.sbc`) | `DD_LOCAL_BP` | blueprints source, plain/gzip pairs |
| Cloud blueprints | `<Steam>/userdata/<steamid>/244850/remote/Blueprints/cloud/<name>/bp.sbc` (gzip-compressed `bp.sbc`, plus `bp.sbcB5` and `thumb.png`) | `DD_CLOUD_BP` | real gzipped blueprints |

A variable is empty when the data is not present. Missing data does not stop the run: steps that need it are SKIP with the reason `test data not present`. A gzipped `bp.sbc` starts with the bytes `1f 8b`.

Making a gzipped blueprint from a plain one by hand (the fixture script does this automatically):

```sh
node -e "const z=require('node:zlib'),fs=require('node:fs');fs.writeFileSync(process.argv[2],z.gzipSync(fs.readFileSync(process.argv[1])))" "<plain>/bp.sbc" "<out folder>/bp.sbc"
node -e "const z=require('node:zlib'),fs=require('node:fs');fs.writeFileSync(process.argv[2],z.gunzipSync(fs.readFileSync(process.argv[1])))" "<cloud>/bp.sbc" "<out folder>/bp.sbc"
```

The output must be named `bp.sbc` inside its own folder, because the app lists folders that contain a `bp.sbc`.

## Parallel runner isolation

Each runner gets a runner id, `A` or `B`. Everything that holds state is separate:

| | Runner A | Runner B |
|---|---|---|
| App server | production build, `vite preview` on port **4610** | Vite dev server on port **5620** |
| Driver port | **4611** | **5621** |
| Static checks (S1–S5) | runs them | SKIP, `owned by runner A` |
| Production build | builds into `$DD_DIST` (`work/A/dist`) | does not build |
| Game folder pick (step L10) | the game root folder | the game's `Content` folder |
| Work directory `DD_WORK` | `<skill>/work/A` | `<skill>/work/B` |
| Output directory `DD_OUT` | `<run dir>/A` | `<run dir>/B` |
| Browser profile | `$DD_WORK/profile` (+ `-de`, `-zh`, `-min`, `-narrow*` variants) | same layout under B's `DD_WORK` |

Why: IndexedDB (linked sources, snapshots, cached parses, cached models) and `localStorage` (tour, seams, language, narrow) are per browser profile, so each runner launches Edge with its own `--user-data-dir` through `launchPersistentContext`. The two app servers cover both the production bundle and the dev build. Only runner A runs Vitest, `tsc` and the build, so nothing races on `node_modules/.vite` and nothing writes `dist/` in the repo. Runner B is the only one that starts a Vite dev server, which writes its dependency cache under `node_modules/.vite` (git-ignored). If a developer is running `npm run dev` in the same checkout at the same time, note it in the report.

The skill folder (`.claude/`) is excluded from the dev server's watcher and file serving in `vite.config.ts`, so screenshots and logs written under `work/` and `reports/` do not trigger reloads. If a port is taken by a process you did not start, pick the next free port (4620/4621 for A, 5630/5631 for B), edit the port lines in your `env.sh`, record it, and never stop the other process.

## Variables (step E1)

`scripts/env.sh <runner> <run dir>` discovers the data and writes `work/<runner>/env.sh`. Shell state does not persist between an agent's commands, so **every command starts with** `. "$DD_SKILL/work/<runner>/env.sh"` (the coordinator gives you the absolute skill path). The file sets:

| Variable | Value |
|---|---|
| `DD_RUNNER` | `A` or `B` |
| `DD_SKILL` | the skill folder |
| `DD_REPO` | the checkout |
| `DD_RUN` | this run's report folder, `<skill>/reports/<id>` |
| `DD_WORK` | `<skill>/work/<runner>` (transient: profiles, fixtures, build, pids) |
| `DD_OUT` | `<run dir>/<runner>` (durable: `logs/`, `shots/`, `files/`, `report.md`) |
| `DD_PROFILE`, `DD_FIX`, `DD_DIST` | `$DD_WORK/profile`, `$DD_WORK/fixtures`, `$DD_WORK/dist` |
| `DD_PORT`, `DD_DRIVER_PORT`, `DD_BASE` | app port, driver port, `http://127.0.0.1:<port>` |
| `SE_GAME_ROOT`, `DD_WORKSHOP`, `DD_LOCAL_BP`, `DD_CLOUD_BP`, `DD_STEAM` | discovered data, empty when absent |

Writes are allowed only under `$DD_WORK` and `$DD_OUT`. `rm -rf` is only ever applied to your own `$DD_WORK`.
