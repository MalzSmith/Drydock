# Rendering (R) and image export (X)

## R Rendering (main session, game linked)

Subject: the median local pair's plain entry (`manifest.pairs[1].plain`, or the first pair if there is only one). Open it and `lib.waitIdle(s)` before R1.

**R1 Textured pipeline.** Pass: `await s.page.evaluate(() => window.__drydock.info())` has `detail` true and loaded model/texture counts; no `@toast.uncached` toast in this session; screenshot `R1-textured`.

**R2 Styles.** Click `${lib.pane('view')} .seg` nth 0 labels 0..3, waiting 1.5 s and `lib.waitIdle` each time, screenshot each. Pass: `render.mode` textured, shaded, clay, line; every pair of screenshots differs (`frac` above 0.01); the exposure slider (`${lib.pane('view')} input[type=range]`) is visible only for Textured.

**R3 Exposure.** Textured: `lib.setRange(s, lib.pane('view') + ' input[type=range]', 1)`. Pass: `render.exposure` 1, label "+1.0 EV", screenshot brighter than R1 (differs); double-click the slider: back to 0.

**R4 Seams.** Click `${lib.pane('view')} label.chk` nth 0. Pass: `render.edges` true, `localStorage['drydock.seams']` "1", screenshot differs. Leave it on (checked again in section P).

**R5 Projection.** Click `[data-tour="vptools"] .seg label` nth 0. Pass: `render.proj` persp, screenshot differs from ortho; click nth 1 to return.

**R6 Presets.** Click `.vp-top > div:nth-child(1) .seg label` nth 0..4, wait 800 ms each, read `.readout` and take a screenshot. Pass: `preset` iso, front, side, top, rear; five different readouts and screenshots.

**R7 Camera input.**
```js
const c = await s.page.locator('#view canvas.gl').boundingBox()
const cx = c.x + c.width / 2, cy = c.y + c.height / 2
const read = () => s.page.locator('.readout').innerText()
const r0 = await read()
await s.page.mouse.move(cx, cy); await s.page.mouse.down(); await s.page.mouse.move(cx + 200, cy + 40, { steps: 10 }); await s.page.mouse.up()
const r1 = await read(); const preset = (await lib.summary(s)).preset
const p0 = await lib.shot(s, 'R7-before-pan')
await s.page.mouse.move(cx, cy); await s.page.mouse.down({ button: 'right' }); await s.page.mouse.move(cx + 120, cy, { steps: 8 }); await s.page.mouse.up({ button: 'right' })
const p1 = await lib.shot(s, 'R7-after-pan')
await s.page.mouse.move(cx, cy); await s.page.mouse.wheel(0, -400); await s.page.waitForTimeout(500)
const r2 = await read()
await s.page.mouse.dblclick(cx, cy)
const settle = async () => { let r = ''; for (let i = 0; i < 15; i++) { await s.page.waitForTimeout(200); r = await read(); if (r.endsWith('1.00×')) break } return r }
const r3 = await settle()
await s.page.locator('[data-tour="vptools"] > button').nth(2).click()
return { r0, r1, preset, pan: await lib.imgDiff(s, p0, p1), r2, r3, r4: await settle(), errs: lib.drain(s) }
```
Pass: `r1` yaw differs from `r0` and `preset` is empty; `pan.frac` above 0.01; `r2` zoom differs from `r1`; `r3` and `r4` end in `1.00×` within 3 s (the reset eases, and under three parallel runners on the dev server it can take longer than 800 ms).

**R8 Turntable spin.** Click `[data-tour="vptools"] > button` nth 1, wait 1 s, read the readout twice 500 ms apart. Pass: `spin` true, the button has class `on`, yaw changes; click again: `spin` false, yaw steady.

**R9 Section view.** Click the scissors (`[data-tour="vptools"] > button` nth 0). Pass: `section.on` true, `tab` section, screenshot differs from section off. Then in `lib.pane('section')`: axis labels 0, 1, 2 → `section.axis` 0, 1, 2 and `.tnum` reads "Layer n / total" with total equal to `info.dims[axis]`, a screenshot per axis, all different; mode label 1 → `slice`, the thickness slider becomes visible, `setRange` on range nth 1 to 4 → `section.thick` 4; `setRange` on range nth 0 to 0 and to its max → `section.pos` 0 and 1; Prev and Next change the layer by one; Flip toggles `section.flip`; the highlight checkbox toggles `section.capHi`; Shift + wheel over the canvas changes `section.pos`. Turn it off with `label.sec-title input`. Pass: every value as stated, no errors.

**R10 Backgrounds.** Scene tab (`[data-tour="tabs"] .tab` nth 2). Click `.sw-grid3 .sw` nth 0..5 and screenshot each. Pass: `scene.bg` paper, hangar, steel, dusk, transparent, custom; custom shows `.colors`; set the top colour (`.colors input[type=color]` nth 0, set value `#ff0000` and dispatch `change`) → `scene.gradTop` `#ff0000` and the image changes. Procedural: click only the visible `.sw-grid2` nth 1 buttons (sky-default and sky-orbit; the hidden Nebula button would time out) → `scene.bg` accordingly; the Nebula swatch is hidden by default (record it); `actions.setScene({ bg: 'sky-nebula' })` still renders it. All screenshots pairwise different.

**R11 Game skyboxes.** `.sw-grid2` nth 0 lists one button per `store.skies` entry; vanilla entries are enabled in this session. Click the first enabled one, then poll up to 30 s (every 500 ms) until a `#view` screenshot differs from sky-default, and record the time it took. Pass: `scene.bg` starts with `sky:`, no failure toast, screenshot differs from sky-default (`frac` above 0.05). If a mod skybox is listed (`src` not Vanilla), select it too. Record the load time.

**R12 Lighting.** Scene `.seg label` nth 1 (Uniform) → `scene.lighting` uniform, sun slider hidden, screenshot differs; nth 0 back; `lib.setRange(s, lib.pane('scene') + ' input[type=range] >> nth=0', 200)` (nth 0: the shadow strength slider is a second range in this pane since 8827ae7) → `scene.sun` 200 and label "200°", screenshot differs. Reset sun to 40 and background to sky-default.

**R13 Frame rate (information).** `return { bench: await s.page.evaluate(() => window.__drydock.bench(60)), fps: await s.page.evaluate(() => window.__drydock.fps(120)) }`. Record; no pass threshold under parallel load.

**R14 Shadows.** Textured, Directional, Scene tab, sun 220 (`lib.setRange(s, lib.pane('scene') + ' input[type=range] >> nth=0', 220)`), wait 1 s, screenshot `R14-off`. Before clicking anything: `scene.shadows` false, `scene.shadowStrength` 80, `localStorage['drydock.shadows']` absent, `${lib.pane('scene')} label.chk` (the Shadows box) visible and unchecked, range nth 1 (strength) hidden. Click the box, wait 1 s, screenshot `R14-on`. Pass: `scene.shadows` true, `drydock.shadows` "80", range nth 1 visible with label "80%", `lib.imgDiff(R14-off, R14-on).frac` above 0.001 (cast shadows darken part of the hull). `lib.setRange(s, lib.pane('scene') + ' input[type=range] >> nth=1', 100)`, screenshot `R14-100`. Pass: `shadowStrength` 100, `drydock.shadows` "100", label "100%", screenshot differs from `R14-on`. Double-click range nth 1: back to 80. Visibility: View style Shaded (`${lib.pane('view')} .seg` nth 0 label 1) → the Shadows box (its `.col` parent) is hidden in the Scene pane; back to Textured → visible; Lighting Uniform → hidden; back to Directional → visible. Perspective (`[data-tour="vptools"] .seg label` nth 0) with shadows on: screenshot, no errors; back to ortho. Uncheck the box. Pass: `scene.shadows` false, `drydock.shadows` absent, screenshot equals `R14-off` (`frac` 0 with the default tolerance). Throughout: no WebGL warning in `$DD_OUT/logs/console.log` written during this step (grep for `GL_INVALID`; WebGL warnings are console warnings, so `lib.drain` does not catch them). Reset sun to 40.

## X Image export (subject from R, Textured, sky-default)

**X1 Export tab.** Click `[data-tour="export"]`. Pass: `tab` export, `.res-dims` reads "3,840 × 2,160 px", the viewport is dimmed outside the frame (screenshot `X1`).

**X2 PNG.** In `lib.pane('export')`: resolution label 0 (1080p), aspect label 0 (16:9), supersampling label 0 (1×), format label 0 (PNG).
```js
const P = lib.pane('export')
const d = await lib.download(s, () => s.page.locator(P + ' .btn-hero').click(), 'X2.png')
return { d, img: await lib.imageInfo(s, d.path), toasts: await lib.toasts(s), errs: lib.drain(s) }
```
Pass: suggested name `<blueprint name with non-alphanumerics as _>_<YYYY-MM-DD>.png`, image 1920×1080, `opaqueFrac` 1, a `@toast.downloadedFile` toast with `1920×1080`.

**X3 JPG** (format label 1) and **X4 WEBP** (label 2). Pass: `.jpg` / `.webp` names, 1920×1080, the file decodes.

**X5 Aspects** (PNG): 21:9 → 2520×1080, 1:1 → 1080×1080, 4:5 → 864×1080. Back to 16:9.

**X6 Transparent PNG.** Check `${P} label.chk input`. Pass: `corner` alpha 0, `clearFrac` above 0.05, `opaqueFrac` above 0.01. Then JPG with the box still checked: corner alpha 255 (JPG has no alpha). Uncheck, back to PNG.

**X7 Transparent background.** Scene swatch transparent (`.sw-grid3 .sw` nth 4), export PNG: corner alpha 0; export JPG: corner RGB all ≥ 245 (flattened onto white). Back to sky-default, PNG.

**X8 File name template.** Fill `${P} .field input` with `rt-{blueprint}-{date}:x` and press Tab. Pass: suggested name `rt-<blueprint>-<YYYY-MM-DD>_x.png` (the colon replaced). Restore `{blueprint}_{date}`.

**X9 4× at 4K** (formerly "supersampling cap"; the 700 MP cap was removed in 76be1fd, the id stays). 4K, 16:9, 4× PNG. Pass: 3840×2160 output, no failure toast; record `await s.page.evaluate(() => window.__drydock.exportMs())`.

**X10 Clipboard.** Headless only (a headed browser shares the system clipboard with the other runners: then SKIP). Runner C: SKIP, `clipboard permissions not available in Playwright Firefox` (it rejects `clipboard-read`, so `lib.open` grants nothing there). 1080p, click `${P} button.btn-secondary` nth 0, wait for `busy` false.
```js
const clip = await s.page.evaluate(async () => {
  const items = await navigator.clipboard.read()
  const out = []
  for (const it of items) for (const t of it.types) { const b = await it.getType(t); const bmp = t.startsWith('image/') ? await createImageBitmap(b) : null; out.push({ t, size: b.size, w: bmp?.width, h: bmp?.height }) }
  return out
})
```
Pass: a `@toast.copied` toast and an `image/png` item of 1920×1080. If the toast is `@toast.noClipboard` or reading is denied, BLOCKED with the text (harness permission), not FAIL.

**X11 Turntable.** 1080p, 1×, PNG. Download with `${P} button.btn-secondary` nth 1 (`lib.download(..., 'X11-turntable.zip')`, it renders 36 frames), then:
```sh
node -e "const b=require('fs').readFileSync(process.argv[1]);const e=b.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));const n=b.readUInt16LE(e+10);let o=b.readUInt32LE(e+16),names=[],methods=new Set();for(let i=0;i<n;i++){methods.add(b.readUInt16LE(o+10));const l=b.readUInt16LE(o+28),x=b.readUInt16LE(o+30),c=b.readUInt16LE(o+32);names.push(b.toString('utf8',o+46,o+46+l));o+=46+l+x+c}console.log(JSON.stringify({n,methods:[...methods],first:names[0],last:names[n-1]}))" "$DD_OUT/files/X11-turntable.zip"
```
Pass: suggested name `<base>_turntable.zip`; 36 entries; method 0 (stored); names `<base>_001.png` … `<base>_036.png`; a `@toast.downloadedFile` toast with 36 frames. Extract frame 1 and 19 with Node if needed and confirm they differ (optional).

**X12 Busy guard.** Click render twice in the same task: `await s.page.evaluate(() => { const b = document.querySelector('.btn-hero'); b.click(); b.click() })` (two Playwright clicks can land after a fast 1080p 1× render has already finished, which legitimately starts a second export; changed in run 20261012-185214). Pass: exactly one download within 20 s (use `page.on('download')` counting, or `lib.download` followed by `lib.noDownload(s, async () => {}, 5000)`), the button label shows "Rendering…" while busy.

**X13 Spinning WebP.** 1080p, 1:1, 1×, PNG, sky-default, transparent box unchecked. Download with `${P} button.btn-secondary` nth 2 (`lib.download(..., 'X13-spin.webp')`, it renders 36 frames), then `await lib.animInfo(s, '<path>')`. Pass: the button text is the `export.spinWebp` string ("Spinning WebP · 24 fps" in English); suggested name `<base>_turntable.webp`; file starts with `RIFF` and has `WEBP` at offset 8; `frames` 36, `animated` true, `loopsForever` true, `w`×`h` 1080×1080, every `durationsMs` 42 and `allDurationsMs` is 36 entries of 42; `firstClearFrac` 0; every `changedFrac` above 0.01 (the ship turns); a `@toast.downloadedFile` toast with 36 frames. Then check `${P} label.chk input` and download again as `X13-spin-alpha.webp`: `frames` 36 and `firstClearFrac` above 0.05 (transparency follows the checkbox even though the format is PNG). Uncheck, back to 16:9.

**X14 16K is PNG only.** Start at 1080p, 16:9, 1×, format label 1 (JPG), transparent box unchecked. Click resolution label 4 (16K). Pass: `.res-dims` reads "15,360 × 8,640 px"; the format `.seg` (nth 3) now has PNG checked; its JPG and WEBP inputs are `disabled` and PNG is not; `${P} button.btn-secondary` nth 2 (spinning WebP) is `disabled`, nth 0 and nth 1 are not. Download with `.btn-hero` (`lib.download(..., 'X14-16k.png')`; it renders in tiles and can take minutes under parallel load) and read the header in Node, not with `lib.imageInfo` (decoding 133 megapixels in the page is too heavy):
```sh
node -e "const b=require('fs').readFileSync(process.argv[1]);console.log(JSON.stringify({png:b.toString('latin1',1,4),w:b.readUInt32BE(16),h:b.readUInt32BE(20),bytes:b.length}))" "$DD_OUT/files/X14-16k.png"
```
Pass: suggested name ends `.png`; `png` "PNG", `w`×`h` 15360×8640; a `@toast.downloadedFile` toast with `15360×8640`, `error` false and `icon` `check` in `lib.toasts`; no failure toast. Then click resolution label 3 (8K). Pass: JPG, WEBP and the spinning WebP button are enabled again and PNG stays checked (the format is not switched back). Back to 1080p, PNG.

**X15 Progress dialog and Cancel.** 8K, 16:9, 8×, PNG, transparent box unchecked. Click `.btn-hero`, then wait for the export dialog: `s.page.locator('.dlg-backdrop').filter({ hasText: <export.progressNote string> })` visible (it fades in after 400 ms; wait up to 3 s). Pass: its `.dlg-title` reads "Rendering 7,680 × 4,320"; the percent label matches `/^\d+%$/`; `busy` true and `progress` a number from 0 to 1. Click the dialog's `button.btn-secondary` (Cancel) inside `lib.noDownload(s, ..., 8000)`. Pass: no download; within 8 s a `@toast.exportCancelled` toast, `busy` false, `progress` null, the dialog backdrop `hidden`; the render button label is back to its idle text. Back to 1080p, 1×.

**X17 Tiled export with shadows.** 8K, 16:9, 2×, PNG, transparent box unchecked, Scene shadows on (`actions.setScene({ shadows: true, sun: 220 })`, not the checkbox, so storage stays untouched), zoom in once (`window.__drydock.renderer.zoomBy(-500)`). Download with `.btn-hero` (`lib.download(..., 'X17-shadows.png')`); 8K at 2× renders in several tiles. Pass: 7680×4320 PNG that decodes (`lib.imageInfo`), no failure toast, no `GL_INVALID` in the console log during the step; record the export time (`window.__drydock.exportMs()`). Then `actions.setScene({ shadows: false, sun: 40 })`, Frame button (`[data-tour="vptools"] > button` nth 2), back to 1080p, 1×.

**X16 64K row.** Check `${P} .seg` nth 1: exactly one label, text the `export.res64k` string ("64K - WARNING" in English), its `title` attribute equals `export.res64kTip`. Start at 1080p, 16:9, 1×, format JPG. Click that label. Pass: `export.res` 34560; `.res-dims` reads "61,440 × 34,560 px"; the 64K label's input is checked and no resolution label in `.seg` nth 0 is; PNG is checked and JPG/WEBP inputs are `disabled`; `${P} button.btn-secondary` nth 0 (copy), nth 1 (turntable) and nth 2 (spinning WebP) are all `disabled`. Do not render (a 64K PNG is hundreds of megabytes). Click resolution label 0 (1080p). Pass: the 64K input is unchecked, copy, turntable, spinning WebP, JPG and WEBP are enabled again, PNG stays checked.
