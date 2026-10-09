# Boot (B), first-run tour (T) and URL parameters (U)

**B1 Boot in a fresh profile.**
```sh
sh "$DD_SKILL/scripts/dd.sh" > "$DD_OUT/logs/B1.json" <<'EOF'
Object.assign(s, await lib.open({ tourSeen: false }))
await s.page.waitForTimeout(1500)
const res = await s.page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /count\.js|goatcounter/.test(n)))
return {
  sum: await lib.summary(s),
  app: await s.page.locator('#app').isVisible(),
  narrow: await s.page.locator('#narrow').isVisible(),
  html: await s.page.evaluate(() => document.documentElement.lang),
  link: await s.page.locator('[data-tour="sources"]').innerText(),
  counter: res,
  shot: await lib.shot(s, 'B1-boot', null),
  errs: lib.drain(s),
}
EOF
```
Pass: `app` true, `narrow` false, `html` `en`, `link` "Link folders", `sum.sources` empty, `sum.caption` shows "No blueprint" style text (English, no raw keys), `counter` empty (the counter only loads on the public site), no problems, no external requests. Evidence: `B1.json`, `shots/B1-boot.png`.

**B2 WebGL 2.** `return await lib.gpu(s)`. Pass: `webgl2` true. Record the renderer string. If false, every R, X and C rendering check is BLOCKED.

**T1 Welcome card.**
```js
return {
  welcome: await s.page.locator('.tour-welcome').isVisible(),
  tour: (await lib.summary(s)).tour,
  count: await s.page.locator('.tour-count input').isChecked(),
  langs: await s.page.locator('.tour-lang .seg label').count(),
  keys: await lib.rawKeys(s),
  shot: await lib.shot(s, 'T1-welcome', null),
  errs: lib.drain(s),
}
```
Pass: welcome visible, `tour` 0, `count` true (no Do Not Track in the test browser), one language label per locale file in `src/locales` (5 at the time of writing), no raw keys.

**T2 Guided tour.** Toasts are recorded one animation frame after they appear, so read `lib.toasts` for the final Done toast after a 300 ms wait, not in the same breath as the last click. Click start, then for each step record the callout, check that the highlight frame surrounds its target, and watch the layout for 60 animation frames to make sure it is still. A tour overlay that sticks out of the window makes the page scrollbars appear, `#app` shrinks, the tour re-places itself, the scrollbars vanish and the whole screen flickers; this happened once on the step whose target (the right tabs) touches the window's right edge. The target list below must equal `STEPS` in `src/ui/tour.ts` (the audit checks it).
```js
await s.page.locator('.tour-welcome .btn-primary').click()
const targets = ['sources', 'library', 'vptools', 'tabs', 'export', 'mode']
const out = []
for (let i = 0; i < targets.length; i++) {
  await s.page.waitForTimeout(400)
  const f = await s.page.locator('.tour-frame').boundingBox()
  const t = await s.page.locator(`[data-tour="${targets[i]}"]`).boundingBox()
  const still = await s.page.evaluate(async () => {
    const app = document.getElementById('app')
    const doc = document.documentElement
    const parts = ['.tour-frame', '.tour-callout', '.tour-line', '.tour-dot'].map((q) => document.querySelector(q))
    let resizes = -1
    const ro = new ResizeObserver(() => resizes++)
    ro.observe(app)
    const seen = new Set()
    let outside = []
    for (let n = 0; n < 60; n++) {
      await new Promise(requestAnimationFrame)
      const a = app.getBoundingClientRect()
      const rects = parts.map((e) => e.getBoundingClientRect())
      seen.add([a.width, a.height, doc.scrollWidth, doc.scrollHeight, ...rects.flatMap((r) => [r.x, r.y, r.width, r.height])].map(Math.round).join(','))
      outside = parts.filter((e, k) => rects[k].left < a.left - 0.5 || rects[k].top < a.top - 0.5 || rects[k].right > a.right + 0.5 || rects[k].bottom > a.bottom + 0.5).map((e) => e.className)
    }
    ro.disconnect()
    return { resizes, states: seen.size, outside, overflowX: doc.scrollWidth > doc.clientWidth, overflowY: doc.scrollHeight > doc.clientHeight }
  })
  out.push({
    step: (await lib.summary(s)).tour,
    title: await s.page.locator('.tour-callout .tour-title').innerText(),
    back: await s.page.locator('.tour-callout .tour-foot .btn-secondary').isVisible(),
    next: await s.page.locator('.tour-callout .tour-foot .btn-primary').innerText(),
    framed: !!f && !!t && f.x <= t.x && f.y <= t.y && f.x + f.width >= t.x + t.width && f.y + f.height >= t.y + t.height,
    still,
    shot: await lib.shot(s, `T2-step${i + 1}`, null),
  })
  await s.page.locator('.tour-callout .tour-foot .btn-primary').click()
}
await s.page.waitForTimeout(300)
const sum = await lib.summary(s)
return { out, tour: sum.tour, toasts: await lib.toasts(s), seen: (await lib.storage(s))['drydock.tourSeen'], errs: lib.drain(s) }
```
Pass: steps 1..n in order, every `framed` true, titles non-empty and not raw keys, `back` false on step 1 and true afterwards, `next` reads "Done" on the last step, final `tour` -1, a `@toast.tourDone` toast, `seen` "1". Stability, for every step: `still.resizes` 0, `still.states` 1, `still.outside` empty and `overflowX`/`overflowY` false. A step with `states` above 1 or `resizes` above 0 is a flicker defect (severity major); name the step and the element that moves.

**T2b Tour at the minimum window size.** Repeat T2 in a second session with the window at the app's minimum size, where the overlays have the least room: `s.min = await lib.open({ profile: process.env.DD_PROFILE + '-min', w: 1120, h: 700, tourSeen: false })`, run the T2 loop against `s.min` (shots named `T2b-step<n>`), then `await lib.close(s.min)`. Pass: the same criteria as T2.

**T3 Keyboard and replay.** Click `#nav > button.btn-ghost` → `tour` 0; press Escape → `tour` -1 and a `@toast.tourSkip` toast. Click the tour button again, click start, press ArrowRight twice → `tour` 3, ArrowLeft → 2, Escape → -1 and a `@toast.tourClosed` toast. Pass: all values as stated. Evidence: JSON with the observed values.

**T4 Counter opt-out.** Open the tour again, uncheck `.tour-count input`, press Escape. Pass: `localStorage['drydock.count']` is "0"; no request to `goatcounter` and no `count.js` resource in `performance.getEntriesByType('resource')` during the whole session.

**T5 Seen tour stays closed.** `await lib.goto(s)`; pass: `.tour-welcome` hidden, `tour` -1.

**U1 View parameters.**
```js
await lib.goto(s, 'style=line&proj=persp&tab=scene&bg=paper&seams=1&tint=1&view=top&missing=hide&light=uniform')
const sum = await lib.summary(s)
return { render: sum.render, tab: sum.tab, scene: sum.scene, preset: sum.preset, seamsStored: (await lib.storage(s))['drydock.seams'] ?? null, errs: lib.drain(s) }
```
Pass: `render.mode` line, `proj` persp, `edges` true, `tintMods` true, `missing` hide, `tab` scene, `scene.bg` paper, `scene.lighting` uniform, `preset` top, and `seamsStored` unchanged from before (null in a fresh profile): URL parameters must not persist the seams setting.

**U2** `lib.goto(s, 'mode=compose&sources=1')`. Pass: `mode` compose, `srcOpen` true, the sources dialog visible; Escape closes it.

**U3** `lib.goto(s, 'tour=1')`. Pass: `tour` 0 although the tour was seen; Escape closes it.

**U4** `lib.goto(s, 'w=1200&h=700')`. Pass: `#app` has inline width 1200px and height 700px (`getComputedStyle` or `style.width`).

**U5 Untrusted `?bp`.** (a) `lib.goto(s, 'bp=' + encodeURIComponent('https://example.invalid/x/bp.sbc'))`, wait 3 s. Pass: `external` stays empty, no model, no toast. (b) `lib.goto(s, 'bp=/rt-does-not-exist/bp.sbc')`, wait 3 s. Pass: a toast `@toast.urlFailed` with `HTTP 404`, or, if the server answers with the SPA fallback page, `@toast.urlFailed`/`@toast.readFailed` saying it is not a blueprint; no model, no pageerror. A `console.error` "Failed to load resource: 404" is expected in (b) only.

**U6** `lib.goto(s)`. Pass: default state again (`mode` blueprint, style textured, ortho). Evidence for U1–U6: one JSON each.
