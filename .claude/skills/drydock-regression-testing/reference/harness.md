# Harness

The harness lives in `scripts/` and is run in place; nothing is copied or installed. It resolves `playwright-core` from the checkout's `node_modules` through `createRequire`.

| File | Role |
|---|---|
| `scripts/env.sh` | discovers test data, writes `work/<runner>/env.sh` (see environment.md) |
| `scripts/lib.mjs` | browser session and helpers; a session object `s` holds `ctx` (persistent Edge context), `page`, and the collected `problems` and `external` requests |
| `scripts/driver.mjs` | a small HTTP server on `127.0.0.1:$DD_DRIVER_PORT` that keeps one browser session alive between commands. Each request body is the body of an async function with the parameters `lib` and `s`; its return value comes back as JSON |
| `scripts/dd.sh` | sends a command read from stdin to your driver |
| `scripts/make-fixtures.mjs` | builds the test blueprints in `$DD_FIX` from the machine's data (read-only) and writes `$DD_FIX/manifest.json` with the expected values |
| `scripts/audit.mjs` | coordinator only: checks every selector, key, parameter and path these documents mention against the code |
| `scripts/run.mjs` | coordinator only: creates run folders, merges runner reports, compares with the previous run, prunes old reports |
| `$DD_REPO/scripts/shot.mjs` | the app's own screenshot script, used for `?bp=` loads in a throw-away browser |

The driver matters because linked `File`s exist only while the page is open: reloading the page in the middle of the run would lose them, so the runner works step by step against one long-lived page.

## Fixtures

`make-fixtures.mjs` writes into `$DD_FIX`:

| Folder | Content | Expected |
|---|---|---|
| `bp/P <name>` and `bp/G <name>` | the smallest, the median and the largest (under 30 MB) local blueprint, as plain XML (`P`) and gzipped (`G`) | same name, grid, block count, dims, rows in every view |
| `bp/P <cloud>` and `bp/G <cloud>` | every cloud blueprint, unpacked (`P`) and as found (`G`) | same as above; the `G` file is byte-identical to the real cloud file |
| `bp/S Missing`, `bp/SG Missing` | synthetic, plain and gzipped: 8 `LargeBlockArmorBlock` and 8 `CubeBlock/DrydockRegressionUnknown` | Large grid, 16 blocks, one unknown type with 8 blocks |
| `bp/SG Unicode Late Grid` | gzipped, Id `DD Ünïcødé Шип 船`, a 20 kB XML comment before `<GridSizeEnum>Small` (outside the first 4 kB, inside the first 64 kB), 27 `SmallBlockArmorBlock` | list name exact, Small grid, 27 blocks, dims 3×3×3 |
| `bp/SG Corrupt` | the first half of a gzipped 8,000-block blueprint (truncated stream) | no crash; a readable error when opened |
| `bp/SG Not A Blueprint` | gzipped plain text | listed under its folder name; opening shows "not a blueprint" |
| `bp/S Mod Block` | 4 blocks of a non-vanilla block type from the smallest workshop mod that defines one, plus 4 vanilla armor blocks | mod detected once the mod is linked |
| `mods/<modid>` | a copy of that mod | `mods` source |
| `torch/Instance/content/244850/<modid>` | a copy of that mod in a Torch layout | `torch` source |
| `empty/` | empty folder | "That folder is empty." toast |
| `misc/` | `not-a-blueprint.txt`, `bad-composition.json` (version 99), `not-json.json` | error toasts |

`manifest.json` lists every pair with the expected `name` and `large` (computed in Node the way the list reads them: the `Id Subtype` attribute in the first 4 kB, the first `GridSizeEnum` in the first 64 kB), the synthetic expectations, the chosen mod (`mod.key` is `Type/Subtype`), `localCount` (local blueprint folders), `workshopBlueprints` and `bpFolders`.

## Using the driver

Start it (step E6) and talk to it like this:

```sh
. "$DD_SKILL/work/A/env.sh"
sh "$DD_SKILL/scripts/dd.sh" > "$DD_OUT/logs/STEPID-reply.json" <<'EOF'
const sum = await lib.summary(s)
return { sum, errs: lib.drain(s) }
EOF
cat "$DD_OUT/logs/STEPID-reply.json"
```

Conventions:

- Save every driver reply as `$DD_OUT/logs/<step id>-reply.json` (use a suffix such as `-reply-2` for follow-ups). Do not name it `<step id>.json`: steps that call `lib.save('<step id>', ...)` write that file themselves, and later steps read it back with `lib.load`. That file is the step's evidence together with the screenshots it names.
- End every browser step with `errs: lib.drain(s)`. A non-empty `errs.problems` or `errs.external` fails the step unless the step lists it as expected.
- Screenshots: `lib.shot(s, '<step id>-<what>')` captures the viewport element `#view`; pass `null` as the third argument for the whole page. They land in `$DD_OUT/shots`.
- Downloads: `lib.download(s, () => <click>, '<step id>-<name>')` saves into `$DD_OUT/files` and returns the browser's suggested file name.
- Store state: `window.__drydock.store.get()` inside `s.page.evaluate`. `lib.summary(s)` returns the fields most steps need. Toasts: the store holds them as keyed strings such as `@toast.readFailed {"error":"..."}`; `lib.toasts(s, since)` returns every toast since a page timestamp (`await lib.now(s)`), with the raw key and the displayed text, because a toast disappears after 3.2 s.
- Long operations: `lib.linkStart` returns as soon as the folder is handed to the page. Poll with `return await lib.linkWait(s, 240000)` (at most 4 minutes per call) until `done` is `true`. Set `DD_MAXTIME` larger than the wait when you call `dd.sh`.
- Never call `lib.goto` on the main session after step L2 until section P: a reload drops the linked `File`s and changes what later steps test.
- Second sessions (other profiles) are kept in properties of `s`, for example `s.de = await lib.open({ profile: process.env.DD_PROFILE + '-de', locale: 'de-DE', tourSeen: false })`, and all helpers take that object instead of `s`. Close them with `await lib.close(s.de)`.
- `lib` helpers: `open`, `close`, `goto`, `summary`, `entries`, `rows`, `pick`, `sameJson`, `toasts`, `now`, `drain`, `waitModel`, `openEntry`, `dropFile`, `linkStart`, `refreshStart`, `linkWait`, `waitIdle`, `shot`, `download`, `noDownload`, `setRange`, `imageInfo`, `imgDiff`, `rawKeys`, `storage`, `gpu`, `manifest`, `fixture`, `save`, `load`, `pane`, `note`, plus `fs`, `zlib`, `join` re-exported from Node.

## Selector reference

All selectors come from the app's DOM (`src/ui`). Right-hand panes are addressed with `lib.pane('view' | 'section' | 'scene' | 'export')`, which expands to `#right .rbody > div:nth-child(n)`. The audit script checks every selector in this table against the code; when it reports one missing, read the component in `src/ui` and fix the table and the steps that use it.

| Area | Selector | Notes |
|---|---|---|
| Mode switch | `[data-tour="mode"] label` | nth 0 Blueprint, nth 1 Compose |
| Sources button | `[data-tour="sources"]` | text "Link folders" without sources, "Sources" with |
| Source status | `.navstat` | |
| Tour button | `#nav > button.btn-ghost` | |
| Language | `.lang-btn`, `.lang-menu .lang-row` | rows: nth 0 Browser language, then en, de, ru, zh-Hans, zh-Hant |
| Export image (nav) | `[data-tour="export"]` | switches to the Export tab |
| Library search | `.lib-search input` | |
| Local / Workshop list | `.lib-head .seg label` | nth 0 Local, nth 1 Workshop |
| Found count | `.lib-head .between > span.s11` | |
| Blueprint rows | `.lib-list .bp-row`, name `.nm`, meta `.s11` | selected row has `.sel`; a dropped file is the first row |
| Mod rows | `.lib-mods .mod-row`, `input[type=checkbox]`, `.tag` | |
| Missing blocks button | `.missing-btn` | hidden when there are none |
| Sources dialog | `.dlg-backdrop:has(.link-grid)`; cards `.link-card` | cards: nth 0 game, 1 workshop, 2 torch, 3 mods, 4 blueprints |
| Source rows | `.src-row`, `.nm`, `.tag`, refresh `button.btn-secondary`, remove `button.btn-ghost` | |
| Missing dialog | `.dlg-backdrop:has(.missing-table)`; rows `.missing-table tbody tr` | |
| Dialog close | `.dlg > div > button.btn-icon` inside the backdrop | Escape and a click on the backdrop also close |
| View presets | `.vp-top > div:nth-child(1) .seg label` | iso, front, side, top, rear |
| Projection | `[data-tour="vptools"] .seg label` | nth 0 Perspective, nth 1 Orthographic |
| Section / Turntable / Frame | `[data-tour="vptools"] > button` | nth 0, 1, 2 |
| Caption, readout, toast | `.cap .nm`, `.cap .dm`, `.readout`, `.toast span` | |
| GL canvas | `#view canvas.gl` | |
| Right tabs | `[data-tour="tabs"] .tab` | View, Section, Scene, Export |
| View pane | `.seg` nth 0 style (textured, shaded, clay, line), nth 1 missing mode (placeholder, substitute, hide); `label.chk` nth 0 seams, nth 1 tint; `input[type=range]` exposure; `table.defs tbody tr` | |
| Section pane | `label.sec-title input`; `.seg` nth 0 axis, nth 1 cut/slice; `input[type=range]` nth 0 position, nth 1 thickness; `button.btn-secondary` nth 0 prev, 1 next, 2 flip; `label.chk input` highlight; `.tnum` layer label | |
| Scene pane | `.sw-grid2` nth 0 game/mod skyboxes, nth 1 procedural skies; `.hint` greyed-out note; `.sw-grid3 .sw` gradients (paper, hangar, steel, dusk, transparent, custom); `.colors input[type=color]`; `.seg label` directional/uniform; `input[type=range]` sun | |
| Export pane | `.seg` nth 0 resolution (1080p, 1440p, 4K, 8K), nth 1 aspect (16:9, 21:9, 1:1, 4:5), nth 2 format (PNG, JPG, WebP), nth 3 supersampling (1×, 2×, 4×); `label.chk input` transparent; `.field input` file name; `.btn-hero` render; `button.btn-secondary` nth 0 copy, nth 1 turntable; `.res-dims` | |
| Compose panel | `.comp`; `.comp .add-row button`; `.comp .shape`, `.shape-head`, `.shape-head .meta`; `.comp .btn-row2 button` nth 0 Save JSON, nth 1 Open JSON; `.comp .btn-row2 input[type=file]`; `.comp-bot .seg label` Large/Small; `.comp-bot .field input` name; `.comp-bot .btn-primary` export; `.comp-bot span.s12` nth 0 size line; `.comp-bot .size-warn` | |
| Shape editor | `.shape-edit .seg` nth 0 op (add, subtract, intersect), nth 1 types box/sphere/cylinder/ellipsoid, nth 2 torus/pyramid, nth 3 wall (Solid, 1, 2, 3); `.shape-edit .num-grid` nth 0 inputs 0-2 size, 3-5 offset, nth 1 torus tube; `.shape-edit select` block (values 1, 2, 12); `.shape-edit .sel-grid .btn-row4 button` X/Y/Z 90°, Reset; `.shape-edit > .btn-row4 button` ↑, ↓, Duplicate, Delete | |
| Tour | `.tour-welcome`, start `.tour-welcome .btn-primary`, explore `.tour-choice .btn-secondary`, `.tour-count input`, `.tour-lang .seg label`, `.tour-callout`, `.tour-title`, `.tour-hello`, next `.tour-foot .btn-primary`, back `.tour-foot .btn-secondary`, `.tour-x`, `.tour-frame`, `.tour-line`, `.tour-dot` | |
| Narrow page | `html.narrow`, `#narrow`, `#narrow-continue`, `#narrow-langs a[lang=...]` | |

## How each way of opening a blueprint is exercised

| Path in the app | How the workflow drives it | Code path covered |
|---|---|---|
| `?bp=<same-origin url>` | `scripts/shot.mjs --bp <file>`: it serves the file at `/__bp.sbc` through `page.route` and opens `?bp=/__bp.sbc` (step O1) | `fetch` → `ArrayBuffer` → worker `parseBlueprint` → `decodeBlueprint` (buffer) |
| Drop of a `bp.sbc` file | `lib.dropFile`: serves the file through `page.route`, builds a `File` in the page, puts it in a `DataTransfer` and dispatches `dragenter`, `dragover` and `drop` on `#view` | `installDrop` → `getAsFile()` fallback → worker `parseBlueprint` (File) → `decodeBlueprint` |
| Drop of a blueprint folder | **not automatable**: a script cannot create a `DataTransfer` that carries a real directory entry. Manual check in O8 | `getAsFileSystemHandle` / `webkitGetAsEntry` directory branch |
| Linking a folder | the link cards create a hidden `<input type=file webkitdirectory>` and click it; `lib.linkStart` catches the `filechooser` event and calls `setFiles(<directory>)` (Playwright directory upload) | `pick()` → worker `scanSource` → `readBlueprintHead` for each list row → `cacheBlueprints` → `decodeBlueprint` |
| Clicking a list row | `.lib-list .bp-row` click, or `lib.openEntry(s, folder)` which calls `actions.openEntry` with the store entry | cached parse from IndexedDB when present, else the session `File` |
| Snapshot after reload | section P: reopen the profile, open entries without re-linking | cached parse from IndexedDB only |

If the synthetic drop does not reach the app (no model and no toast), or `setFiles` with a directory is rejected, the affected steps are BLOCKED with the error text; do not substitute another path silently.
