# Compose (C)

**C1 Enter Compose.** Click `[data-tour="mode"] label` nth 1. Wait until `compose.blocks` is not null and `compose.busy` false. Pass: `mode` compose, `.comp` visible and `.lib` hidden, 5 default shapes, caption shows the composition name "Drydock Hull" and "Large grid", screenshot `C1`. Record `compose.blocks` as N0.

**C2 Add shape.** `.comp .add-row button`. Pass: 6 shapes, the new one selected (`.comp .shape.sel` with `.shape-edit`), its meta starts with `11×11×11 @ 0, 0, 0` and names Light Armor Block, `compose.blocks` changes after the job finishes.

**C3 Shape types.** In the editor click `.shape-edit .seg` nth 1 labels 0..3 and nth 2 labels 0..1, waiting for `compose.busy` false each time. Pass: the shape type follows (box, sphere, cylinder, ellipsoid, torus, pyramid); block counts differ between box and sphere; torus shows the tube input (`.shape-edit .num-grid` nth 1); cylinder, torus and pyramid show the rotate buttons, the others do not; on the cylinder `X 90°` adds "rotated" to the meta and Reset removes it.

**C4 Operations.** Box, then `.shape-edit .seg` nth 0 labels 1 and 2. Pass: titles change to subtract/intersect forms, `compose.blocks` changes for each; back to add.

**C5 Size and offset.** Fill `.shape-edit .num-grid` nth 0 input 0 with 21 and press Tab; input 4 with 5 and Tab. Pass: meta `21×11×11 @ 0, 5, 0`.

**C6 Hollow.** On the shape added in C2 (it is last in the stack, so the default intersect sphere above it does not clip it), set the size to 21×21×21 and offset to (0, 60, 0) so it does not overlap the hull, then wall labels 1, 2, 3, 0 (`.shape-edit .seg` nth 3). Pass: the block counts satisfy wall 1 < wall 2 < wall 3 < solid, and the meta shows "wall n".

**C7 Block types.** `.shape-edit select` → `2` then `12`. Pass: meta shows Heavy Armor Block, then Interior Wall. Keep Interior Wall for C10.

**C8 Order, duplicate, delete.** `.shape-edit > .btn-row4 button`: ↑ moves the shape to index 5 of 6 (its `.idx` changes), ↓ back, Duplicate → 7 shapes with the copy selected, Delete → 6 shapes and no selection.

**C9 Right-click and Delete key.** First add two spare boxes with `.comp .add-row button` and run every removal below on those spares only, so the default hull stays for C10–C18. Right-click the head of a spare box (`click({ button: 'right' })`): one shape fewer. Click the head of a spare that is not selected yet (clicking the head of the selected shape deselects it, and Delete then correctly does nothing) and press Delete: one shape fewer. `document.activeElement` may be BODY after the click; that is fine as long as it is not an input. Select a shape, focus its size input, press Delete: the shape stays (the key edits the input). With no selection press Delete: no change. Pass: counts as stated, no browser context menu side effects.

**C10 Grid and Interior Wall on small grid.** Make sure one add shape uses Interior Wall (C7), click `.comp-bot .seg label` nth 1 (Small). Pass: `compose.grid` Small, caption "Small grid". Click export (`.comp-bot .btn-primary`) inside `lib.noDownload`: no download and a toast naming Interior Wall (`errors.noSmall`). Set that shape back to Light Armor (value 1) and the grid back to Large.

**C11 Name.** Fill `.comp-bot .field input` with `RT Hull <runner id>` and press Tab. Pass: `compose.name` and the caption follow.

**C12 Export large bp.sbc.**
```js
const d = await lib.download(s, () => s.page.locator('.comp-bot .btn-primary').click(), 'C12-bp.sbc')
const t = lib.fs.readFileSync(d.path, 'utf8')
return {
  d, sum: (await lib.summary(s)).compose, toasts: await lib.toasts(s),
  xml: { head: t.slice(0, 60), large: t.includes('<GridSizeEnum>Large</GridSizeEnum>'), named: t.includes('Subtype="RT Hull'), blocks: (t.match(/<MyObjectBuilder_CubeBlock/g) ?? []).length },
  sizeLine: await s.page.locator('.comp-bot span.s12').first().innerText(),
  errs: lib.drain(s),
}
```
Pass: suggested name `bp.sbc`; a `@toast.downloadedSbc` toast reports the same block count as `compose.blocks` and `xml.blocks`; `large` and `named` true; the estimated size in `sizeLine` is within 2 % of `d.bytes`.

**C13 Re-open the export, plain and gzipped.** Switch to Blueprint mode, `lib.dropFile(s, <C12 path>)`, then gzip the file (`lib.zlib.gzipSync` in the driver, or the command in environment.md) to `$DD_OUT/files/C13-bp.sbc.gz` and drop it as `bp.sbc`. Pass: both load with `name` `RT Hull <id>`, `large` true, `blockCount` equal to C12, and identical `lib.pick` values; their `dims` equal the Compose caption dimensions recorded in C12 (the caption shows the size of the placed blocks, not of a padded grid). Switch back to Compose.

**C14 Export small grid.** Grid Small (no Interior Wall in the stack), export, re-open by drop in Blueprint mode. Pass: `large` false and the block count equals the toast's. Back to Compose, grid Large.

**C15 Save and open JSON.**
```js
const d = await lib.download(s, () => s.page.locator('.comp .btn-row2 button').nth(0).click(), 'C15-composition.json')
const j = JSON.parse(lib.fs.readFileSync(d.path, 'utf8'))
const before = (await lib.summary(s)).compose
for (let n = before.n; n > 0; n--) await s.page.locator('.comp .shape-head').first().click({ button: 'right' })
const empty = (await lib.summary(s)).compose
const t0 = await lib.now(s)
await s.page.locator('.comp .btn-row2 input[type=file]').setInputFiles(d.path)
await s.page.waitForFunction((n) => { const st = window.__drydock.store.get(); return st.compose.shapes.length === n && !st.composeBusy && st.composeInfo }, before.n, { timeout: 60000 })
await s.page.waitForTimeout(1500)
return { d, j: { format: j.format, version: j.version, name: j.name, grid: j.grid, shapes: j.shapes.length }, before, empty, after: (await lib.summary(s)).compose, toasts: await lib.toasts(s, t0), errs: lib.drain(s) }
```
Pass: file name `RT Hull <id>.json`; `format` `drydock-composition`, `version` 1, shape count, name and grid match; `empty.n` 0; `after` has the same shape count, name, grid and block count as `before`; a `@toast.openedFile` toast.

**C16 Invalid JSON.** `setInputFiles` with `misc/bad-composition.json` and `misc/not-json.json`. Pass: each gives `@toast.openFileFailed` (newer version / not JSON), the stack is unchanged.

**C17 Size warnings.** Add a box 40×40×40 at offset (0, 120, 0). Pass: `.comp-bot .size-warn` visible with the "large" warning once the count exceeds 50,000. Set it to 160×160×160 at offset (0, 0, 0): the warning switches to the over-limit text, export (inside `lib.noDownload`) produces no download and a too-many-blocks toast. Delete the shape.

**C18 Camera stays still while cutting sections.** Section X leaves the Export tab open, and its frame overlay would be in the "before" shot only. Switch to the View tab first.
```js
await s.page.evaluate(() => window.__drydock.actions.setTab('view'))
await s.page.waitForTimeout(300)
await s.page.locator('[data-tour="vptools"] > button').nth(2).click()
await s.page.waitForTimeout(1500)
const view = () => s.page.evaluate(() => { const v = window.__drydock.renderer.view; return { yaw: v.yaw, pitch: v.pitch, zoom: v.zoom } })
const v0 = await view()
const a = await lib.shot(s, 'C18-before')
await s.page.locator('[data-tour="vptools"] > button').nth(0).click()
for (let i = 0; i < 3; i++) { await s.page.locator(lib.pane('section') + ' button.btn-secondary').nth(1).click(); await s.page.waitForTimeout(400) }
const v1 = await view()
const cut = await lib.shot(s, 'C18-cut')
await s.page.locator(lib.pane('section') + ' label.sec-title input').click()
await s.page.waitForFunction(() => !window.__drydock.store.get().composeBusy)
await s.page.waitForTimeout(3600)
const v2 = await view()
const b = await lib.shot(s, 'C18-after')
return { v0, v1, v2, cutDiff: await lib.imgDiff(s, a, cut), backDiff: await lib.imgDiff(s, a, b), errs: lib.drain(s) }
```
Pass: `v0`, `v1` and `v2` equal within 1e-6 for each of yaw, pitch and zoom (the zoom easing leaves differences around 1e-9 that are invisible and not a defect); `cutDiff.frac` above 0.002 (the cut is visible); `backDiff.frac` below 0.002 (same framing after turning the section off).

**C19 Edits inside the frame keep the camera.** Change a small shape's size by 2 (for example 21 → 19; an odd size and the even size below it place the same blocks, so 21 → 20 changes nothing). Select shapes by clicking their head, not by a stored id: opening the JSON in C15 renumbers the shape ids. Pass: `renderer.view` unchanged, with the same 1e-6 tolerance per value as C18. Then grow a box beyond the frame (offset 100): the camera reframes (zoom or view changes, or the screenshot shows the whole model).

**C20 Back to Blueprint mode.** Pass: the blueprint that was open in Blueprint mode just before the most recent switch into Compose (after C13/C14 this is the last one they loaded) is shown again (`info` equal to the value recorded right before that switch), the list visible, Compose state kept when switching back and forth once more.
