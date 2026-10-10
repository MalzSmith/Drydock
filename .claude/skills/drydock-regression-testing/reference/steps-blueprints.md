# Opening blueprints (O), linking sources (L), gzip and plain (G), mods and missing blocks (M)

## O Opening blueprints (files, no linked sources)

**O1 `?bp=` with every fixture pair (shot.mjs).** shot.mjs uses its own throw-away Edge context, so it does not touch your profile.
```sh
EVAL='(() => { const s = window.__drydock.store.get(); const i = s.info; return { name: i && i.name, large: i && i.large, dims: i && i.dims, blocks: i && i.blockCount, toast: s.toast, perf: window.__drydock.perf() } })()'
node -e "for (const p of require(process.env.DD_FIX + '/manifest.json').pairs) for (const f of [p.plain, p.gz]) console.log(f)" | while IFS= read -r f; do
  k="$(printf %s "$f" | tr -c 'A-Za-z0-9-' _)"
  node "$DD_REPO/scripts/shot.mjs" "$DD_BASE/?style=shaded" "$DD_OUT/shots/O1-$k.png" --bp "$DD_FIX/bp/$f/bp.sbc" --timeout 120000 --eval "$EVAL" > "$DD_OUT/logs/O1-$k.txt" 2>&1
  echo "$f exit $?"
done
node -e "
const fs=require('fs'),m=require(process.env.DD_FIX+'/manifest.json');const k=f=>f.replace(/[^A-Za-z0-9-]/g,'_');
const ev=f=>{const t=fs.readFileSync(process.env.DD_OUT+'/logs/O1-'+k(f)+'.txt','utf8');const l=t.split(/\r?\n/).find(x=>x.startsWith('[eval] '));return{v:l?JSON.parse(l.slice(7)):null,pageerror:/\[pageerror\]/.test(t)}};
const c=x=>x&&{name:x.name,large:x.large,dims:x.dims,blocks:x.blocks};
console.log(JSON.stringify(m.pairs.map(p=>{const a=ev(p.plain),b=ev(p.gz);return{pair:p.plain,equal:JSON.stringify(c(a.v))===JSON.stringify(c(b.v)),nameOk:a.v&&a.v.name===p.name,largeOk:a.v&&a.v.large===p.large,pageerror:a.pageerror||b.pageerror,plain:c(a.v),gz:c(b.v),decodeMs:[a.v&&a.v.perf&&a.v.perf.decode,b.v&&b.v.perf&&b.v.perf.decode]}}),null,1))" > "$DD_OUT/logs/O1-compare.json"
```
Pass: every invocation exits 0; for every pair `equal`, `nameOk` and `largeOk` are true and `pageerror` false; the gzipped shot and the plain shot look the same (compare a pair of screenshots with `lib.imgDiff` in the driver; `frac` below 0.002). Record `decodeMs` for plain and gzip (information; a gzip decode more than 5× slower than the plain decode of the same blueprint is worth a note).

**O2 Drop a plain and a gzipped `bp.sbc`.** In the driver (main session, after U6):
```js
const m = lib.manifest()
const out = []
for (const p of m.pairs) {
  const a = await lib.dropFile(s, lib.fixture(p.plain))
  const b = await lib.dropFile(s, lib.fixture(p.gz))
  out.push({ pair: p.plain, okA: a.ok, okB: b.ok, equal: lib.sameJson(lib.pick(a), lib.pick(b)), nameOk: a.info?.name === p.name, largeOk: a.info?.large === p.large, plain: lib.pick(a), gz: lib.pick(b), perf: [a.perf, b.perf], toasts: [...a.toasts, ...b.toasts] })
}
const firstRow = await s.page.locator('.lib-list .bp-row').first().innerText()
return lib.save('O2', { out, firstRow, shot: await lib.shot(s, 'O2-last-drop'), errs: lib.drain(s) })
```
Pass: every `okA`, `okB`, `equal`, `nameOk`, `largeOk` true; no failure toasts; `firstRow` shows the dropped blueprint (pinned row) with its grid letter; the values equal O1's.

**O3 Drop the unicode, late-grid gzip.** `lib.dropFile(s, lib.fixture('SG Unicode Late Grid'))`. Pass: `ok`, `info.name` exactly `DD Ünïcødé Шип 船`, `large` false, `blockCount` 27, `dims` [3,3,3], caption `.cap .dm` contains "Small grid" and "27 blocks".

**O4 Drop a truncated gzip.** Record `lib.pick(await lib.summary(s))` first, then `lib.dropFile(s, lib.fixture('SG Corrupt'))`. Pass: `ok` false without timing out (`timedOut` false), a `@toast.readFailed` toast whose error is `@errors.damagedGzip` (English: "Could not read blueprint: The compressed file is damaged or incomplete"; any mention of "fetch" is a FAIL), `loading` false, the previous model still shown (`info` unchanged), no pageerror.

**O5 Drop non-blueprints.** `SG Not A Blueprint` (gzipped text) and `$DD_FIX/misc/not-a-blueprint.txt` (use `lib.dropFile(s, path, 'not-a-blueprint.txt')`). Both give the same toast text, and the toast hook only sees store changes, so wait until the first toast has cleared (`store.get().toast === ''`, about 3.2 s) before the second drop. Pass: each gives `@toast.readFailed` whose text says it is not a blueprint (English `errors.notBlueprint`), no pageerror, previous model kept.

**O6 Drop a file with another name.** `lib.dropFile(s, lib.fixture(<a G pair>), 'Ship.sbc')`. Pass: loads, name from the blueprint's Id (not "Ship").

**O7 Drag-over feedback.**
```js
await s.page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'bp.sbc')); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt })) })
const on = await s.page.evaluate(() => document.body.classList.contains('dropping'))
await s.page.evaluate(() => window.dispatchEvent(new DragEvent('dragleave')))
return { on, off: !(await s.page.evaluate(() => document.body.classList.contains('dropping'))), errs: lib.drain(s) }
```
Pass: `on` true, `off` true.

**O8 Folder drop (manual).** SKIP for agents with the note `manual: folder drag and drop cannot be scripted`. For a human: open the runner's URL in Edge, drag the folder `$DD_FIX/bp/G <cloud name>` (a gzipped blueprint folder) and then a plain one from Explorer onto the window; each must load with the same name, grid and block count as O2.

**O9 Performance (information).** Drop the largest `P` and `G` pair once more and record `perf` (read, decode, parse, resolve, firstFrame, total). No pass threshold under parallel load; note values that exceed the architecture targets (10k blocks under 300 ms, 105k blocks under 2.5 s).

## L Linking sources

**L1 Empty folder.**
```js
const t0 = await lib.now(s)
await lib.linkStart(s, 'blueprints', lib.manifest().dirs.empty)
await s.page.waitForTimeout(3000)
return { toasts: await lib.toasts(s, t0), sum: await lib.summary(s), errs: lib.drain(s) }
```
Pass: a `@toast.emptyFolder` toast and no new source. If Playwright refuses an empty directory, record BLOCKED with its error.

**L2 Fixture blueprints folder.** `lib.linkStart(s, 'blueprints', lib.manifest().dirs.bp)`, then poll `lib.linkWait(s)` until `done`. Then:
```js
const m = lib.manifest()
const es = await lib.entries(s)
const want = lib.fs.readdirSync(m.dirs.bp)
const listed = want.map((f) => ({ f, entry: es.find((e) => e.id.endsWith('/' + f)) ?? null }))
return lib.save('L2', {
  sources: (await lib.summary(s)).sources,
  missing: listed.filter((x) => !x.entry).map((x) => x.f),
  listed: listed.map((x) => ({ f: x.f, name: x.entry?.name, large: x.entry?.large, list: x.entry?.list })),
  link: await s.page.locator('[data-tour="sources"]').innerText(),
  nav: (await lib.summary(s)).nav,
  footer: (await lib.summary(s)).footer,
  dialog: await lib.shot(s, 'L2-dialog', null),
  errs: lib.drain(s),
})
```
Pass: one source of kind blueprints named `bp`, its row shows a note with file and blueprint counts; every folder except possibly `SG Corrupt` is listed with `list` local (record whether `SG Corrupt` is listed); `link` now "Sources"; `nav` says mods are linked without a game folder; footer names the source. `SG Not A Blueprint` is listed under its folder name, Large.

**L3 Real local blueprints.** Link `%APPDATA%/SpaceEngineers/Blueprints` (the parent of `DD_LOCAL_BP`: this checks that `local/` is found inside the pick) as blueprints. Pass: a new source named `Blueprints`; the number of its entries (ids starting with its source id) equals `manifest.localCount`.

**L4 Cloud blueprints.** If `DD_CLOUD_BP` is set, link that `cloud` folder itself as blueprints. Pass: entries equal the number of cloud folders; every entry's `name` and `large` equal `manifest.cloud`; `bp.sbcB5` and `thumb.png` do not create extra entries. Note for the report: linking the standard `Blueprints` folder (L3) lists only `local/`, so cloud blueprints appear only when their folder is linked directly; that is current behaviour, not a defect. SKIP if no cloud folder.

**L5 Wrong folder as game.** Link `manifest.dirs.misc` as game. Pass: `@toast.notGameFolder`, a source of kind game is added anyway. Then remove it with its row's remove button (`.src-row` filtered by name `misc`, `button.btn-ghost`). Pass: the source disappears from the dialog, the store and the footer, and within 30 s every list entry that had `blocks` and `mods` filled before the removal has them filled again (count entries with `blocks !== null` before and after; removing a source used to wipe them).

**L6 Dialog handling.** With the dialog open: Escape closes it; reopen with `[data-tour="sources"]`; a click on the backdrop outside the card (`s.page.mouse.click(10, 10)`) closes it; reopen; the close button closes it. Pass: `srcOpen` false after each.

(Run G1–G7 and M1–M4 now, then continue with L7.)

**L7 Mods folder.** If `manifest.mod`: link `manifest.dirs.mods` as mods. Pass: source of kind mods, note mentions 1 mod.

**L8 Torch instance.** If `manifest.mod`: link `manifest.dirs.torch` as torch. Pass: source of kind torch, note mentions 1 mod.

**L9 Workshop.** Link `DD_WORKSHOP` as workshop and poll `linkWait` (several minutes). Pass: source of kind workshop; workshop entries (`list` workshop) equal `manifest.workshopBlueprints`; the note lists the mod count; no failure toast. SKIP if the workshop folder is missing.

**L10 Game folder.** Runner A links `SE_GAME_ROOT`, runner B links `$SE_GAME_ROOT/Content`. Poll `linkWait` with `DD_MAXTIME=600` and `linkWait(s, 540000)` until `done`; this includes "Caching models n/m" and can take a few minutes at most (17–54 s measured) with both runners active. Pass: no `@toast.notGameFolder` or scan failure; `nav` reads "N sources linked" plus the mod folder count; `skies` contains entries with `src` Vanilla and `ready` true; footer status back to "Ready". Record the duration. SKIP (and mark every Textured check in R as BLOCKED) if the game is not installed.

**L11 Refresh.** Click the refresh button of the `bp` source row (`lib.refreshStart(s, 'bp', lib.manifest().dirs.bp)`), poll `linkWait`. Pass: same source id, newer `when`, no duplicate source, entry count unchanged.

**L12 Unlink.** Remove the torch source (or, without a mod, the cloud source). Pass: gone from the store, the dialog, the footer; its mods (or entries) are gone from the list; within 30 s every remaining entry that had `blocks` filled before still has it filled.

**L13 List controls.** Click `.lib-head .seg label` nth 1: `listSource` workshop, the row count equals the workshop entries, the found counter matches. Back to Local. Type `Ünïcødé` into `.lib-search input`: exactly one row, counter "1 found". Clear the search. Pass: as stated.

**L14 Open by clicking a row.** Search for `Ünïcødé`, click the single `.lib-list .bp-row`, wait with `lib.waitModel`. Pass: model loads with the O3 values; the row has class `sel`; clear the search.

## G Gzip and plain blueprints

Space Engineers cloud blueprints (and console players' blueprints) are gzip-compressed `bp.sbc` files. `decodeBlueprint` in `src/se/blueprint.ts` inflates gzip data, and `readBlueprintHead` reads the start of plain or gzipped files for the blueprint list. This section compares a plain and a gzipped copy of the same blueprint everywhere they can appear.

**G1 List rows of every pair.** Blocks and mod counts are filled in the background after "Caching blueprints"; first `lib.waitIdle(s)`, then poll until every pair entry has `blocks !== null` (up to 5 minutes):
```js
const m = lib.manifest()
const es = await lib.entries(s)
const by = (f) => es.find((e) => e.id.endsWith('/' + f))
const out = m.pairs.map((p) => {
  const a = by(p.plain)
  const b = by(p.gz)
  return { pair: p.plain, found: !!a && !!b, name: [a?.name, b?.name, p.name], large: [a?.large, b?.large, p.large], blocks: [a?.blocks, b?.blocks], mods: [a?.mods, b?.mods], unresolved: [a?.unresolved, b?.unresolved], size: [a?.size, b?.size] }
})
const texts = await s.page.evaluate(() => [...document.querySelectorAll('.lib-list .bp-row .txt')].map((e) => e.innerText))
return lib.save('G1', { out, texts, errs: lib.drain(s) })
```
Pass for every pair: both found; all three names equal; both `large` equal the manifest; `blocks` equal and not null; `mods` and `unresolved` equal; sizes differ (gzip smaller). In `texts`, the rows of a pair read identically.

**G2 Real cloud entries.** For each `manifest.cloud` folder: the entry from the L4 source has the manifest name and grid, and the same `blocks` as the `G <folder>` fixture entry (same bytes) and the `P <folder>` entry. SKIP without cloud data.

**G3 Viewer, every pair (box renderer, before the game is linked).**
```js
const m = lib.manifest()
await s.page.evaluate(() => window.__drydock.actions.setRender({ mode: 'shaded' }))
const out = []
for (const p of m.pairs) {
  const a = await lib.openEntry(s, p.plain)
  await s.page.waitForTimeout(300)
  const ra = await lib.rows(s)
  const sa = await lib.shot(s, `G3-${p.plain.replace(/[^A-Za-z0-9-]/g, '_')}`)
  const b = await lib.openEntry(s, p.gz)
  await s.page.waitForTimeout(300)
  const rb = await lib.rows(s)
  const sb = await lib.shot(s, `G3-${p.gz.replace(/[^A-Za-z0-9-]/g, '_')}`)
  out.push({ pair: p.plain, ok: [a.ok, b.ok], info: lib.pick(a), equal: lib.sameJson(lib.pick(a), lib.pick(b)), rowsEqual: lib.sameJson(ra, rb), mods: [a.modRows, b.modRows], unknown: [a.unknown, b.unknown], perf: [a.perf, b.perf], diff: await lib.imgDiff(s, sa, sb) })
}
await s.page.evaluate(() => window.__drydock.actions.setRender({ mode: 'textured' }))
return lib.save('G3', { out, errs: lib.drain(s) })
```
Pass for every pair: both `ok`; `equal` and `rowsEqual` true; mod rows and unknown blocks equal; `diff.frac` below 0.002; values equal O1/O2. `perf` shows whether the cached parse (all zero) or the file was used; record it.

**G4 Unicode, late grid in the list.** The `SG Unicode Late Grid` entry: name exactly `DD Ünïcødé Шип 船`, `large` false (the `GridSizeEnum` sits after the first 4 kB, so this checks the 64 kB head read through the gzip stream), meta "Small grid · 27 blocks · vanilla" once filled. Open it: O3 values.

**G5 Truncated gzip in the list.** Record whether `SG Corrupt` is listed (both outcomes are acceptable: the list reads only the first 64 kB, which may still inflate). If listed, open it with `lib.openEntry(s, 'SG Corrupt')`. Pass: no timeout, a `@toast.readFailed` or `@toast.openFailed` toast whose error is `@errors.damagedGzip` (no mention of "fetch"), `loading` false, the previous model kept, no pageerror; the rest of the list and later caching are unaffected (G1 passed).

**G6 Gzipped non-blueprint in the list.** Open `SG Not A Blueprint`. Pass: a toast saying it is not a blueprint, no pageerror.

**G7 Cached parse and file parse agree.** For the first local pair and (if present) the first cloud pair, read the cached parse from IndexedDB in the page and compare it with the file:
```js
const m = lib.manifest()
const out = []
for (const p of m.pairs.filter((x, i, a) => a.findIndex((y) => y.from === x.from) === i)) {
  const v = await s.page.evaluate(async (folders) => {
    const st = window.__drydock.store.get()
    const db = await new Promise((ok, no) => { const r = indexedDB.open('drydock'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
    const get = (id) => new Promise((ok) => { const r = db.transaction('bps').objectStore('bps').get(id); r.onsuccess = () => ok(r.result ?? null); r.onerror = () => ok(null) })
    const res = []
    for (const f of folders) {
      const e = st.entries.find((x) => x.id.endsWith('/' + f))
      const rec = e ? await get(e.id) : null
      res.push({ f, cached: !!rec, fpOk: !!rec && rec.fp === `${e.size}|${e.modified}`, v: rec?.v ?? null, name: rec?.parsed?.name ?? null, blocks: rec ? rec.parsed.grids.reduce((n, g) => n + g.key.length, 0) : null, grids: rec?.parsed?.grids?.length ?? null })
    }
    db.close()
    return res
  }, [p.plain, p.gz])
  out.push({ pair: p.plain, v })
}
return lib.save('G7', { out, errs: lib.drain(s) })
```
Pass: both entries of every checked pair are cached with a matching fingerprint and `v` 4 (`PARSE_VERSION` in `src/se/blueprint.ts`; the audit compares the number), and name, block count and grid count are identical between the plain and the gzipped record and equal the G3 values. This proves the background `cacheBlueprints` worker inflates gzip files too.

**G8 After the game is linked (Textured).** After L10, repeat G3 for the median local pair and the first cloud pair without forcing Shaded (style Textured), and wait for assets before each screenshot (`lib.waitIdle(s)`, which also waits for every mesh and texture, then 1 s). If the two `#view` screenshots differ in size, wait 1 s and take both again before comparing; record it. Pass: `equal` and `rowsEqual` true, the rows now name game blocks, `diff.frac` below 0.01, `__drydock.info().detail` true for both.

## M Mods and missing blocks

**M1 Unknown block types.** `lib.openEntry(s, 'S Missing')`. Pass: `unknown` equals `manifest.synthetic.missing.unknown`; `info.blockCount` 16; `.missing-btn` visible; `modRows` contains one row with `key` `unresolved` and `missing` true whose tag reads "Not installed"; the list row meta does not say "vanilla".

**M2 Missing-blocks dialog.** Click `.missing-btn`. Pass: `.dlg-backdrop:has(.missing-table)` visible; one table row with cells `CubeBlock`, `DrydockRegressionUnknown`, `8`; the summary reads "1 block type · 8 blocks"; screenshot `M2-dialog` (whole page). Escape closes it; reopen; a click at (10, 10) closes it. Repeat with `SG Missing`: identical dialog.

**M3 Missing modes.** In the View tab click `${lib.pane('view')} .seg` nth 1 labels 0, 1, 2 and take a screenshot after each. Pass: `render.missing` placeholder, substitute, hide; pairwise `imgDiff` above 0.002 (magenta placeholders, plain blocks, gone). Set it back to placeholder.

**M4 Vanilla meta.** The `SG Unicode Late Grid` row meta contains "vanilla". Pass: as stated.

(Continue with L7–L14, then M5.)

**M5 Mod detected.** After L7/L8: `lib.openEntry(s, 'S Mod Block')`. Pass: `modRows` has at least one row with `missing` false and `enabled` true whose key starts with the id of the source that provides the mod under the "later sources override" rule (the workshop from L9 when it contains the same mod, otherwise the mods or torch source); record which source won; the `.lib-mods .mod-row .tag` reads "Loaded"; `unknown` empty; the defs table (`${lib.pane('view')} table.defs tbody tr`) contains the mod block, credited to the mod; the list row meta says "1 mod". SKIP without `manifest.mod`.

**M6 Toggle a mod.** Uncheck that mod row's checkbox. Pass: `store.mods[key]` false, tag "Off", the defs rows of the mod block turn into missing rows, a screenshot differs from M5 (`imgDiff` above 0.002); check it again: `info` and rows equal M5.

**M7 Tint modded.** Check `${lib.pane('view')} label.chk` nth 1. Pass: `render.tintMods` true; screenshot differs from untinted. Uncheck.

**M8 Workshop blueprint with mods.** After L9: open the first `entries` item with `list` workshop and `mods > 0`. Pass: loads, `modRows` not empty, the mods summary `.lib-mods .between .s11` (use `.first()`; its text can be followed by the nested missing-blocks button text, so compare with startsWith) starts with "n mods loaded". Record the name. SKIP if none.

**M9 Mod sources and the game together.** After L10 open `S Mod Block` again. Pass: the vanilla armor resolves to the game definitions (rows credited to the game), the mod block to the mod, `unknown` empty.
