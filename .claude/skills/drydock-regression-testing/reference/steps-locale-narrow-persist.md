# Localisation (I), narrow screens (N), persistence (P) and focus checks (F)

## I Localisation

**I1 Locale files.** Covered by S3 (runner A). Runner B: SKIP, owned by A.

**I2 Every locale in every main state.** Load `S Missing` first (it gives the mods panel and the missing dialog). The `codes` array must list every file in `src/locales` in the order of the language menu (the audit compares it with the folder):
```js
const codes = ['en', 'de', 'ru', 'zh-Hans', 'zh-Hant']
const res = []
for (let i = 0; i < codes.length; i++) {
  await s.page.locator('.lang-btn').click()
  await s.page.locator('.lang-menu .lang-row').nth(i + 1).click()
  await s.page.waitForFunction((c) => window.__drydock.store.get().locale === c && document.documentElement.lang === c, codes[i])
  const states = {
    view: async () => s.page.locator('[data-tour="tabs"] .tab').nth(0).click(),
    section: async () => s.page.locator('[data-tour="tabs"] .tab').nth(1).click(),
    scene: async () => s.page.locator('[data-tour="tabs"] .tab').nth(2).click(),
    export: async () => s.page.locator('[data-tour="tabs"] .tab').nth(3).click(),
    sources: async () => s.page.locator('[data-tour="sources"]').click(),
    missing: async () => { await s.page.keyboard.press('Escape'); await s.page.locator('.missing-btn').click() },
    compose: async () => { await s.page.keyboard.press('Escape'); await s.page.locator('[data-tour="mode"] label').nth(1).click(); await s.page.evaluate(() => { const st = window.__drydock.store.get(); window.__drydock.actions.selectShape(st.compose.shapes[0].id) }) },
    welcome: async () => { await s.page.locator('#nav > button.btn-ghost').click() },
  }
  for (const [name, go] of Object.entries(states)) {
    await go()
    await s.page.waitForTimeout(400)
    res.push({ code: codes[i], state: name, keys: await lib.rawKeys(s), shot: await lib.shot(s, `I2-${codes[i]}-${name}`, null) })
  }
  await s.page.keyboard.press('Escape')
  await s.page.waitForTimeout(300)
  res.push({ code: codes[i], state: 'toast', toast: (await lib.toasts(s)).slice(-1)[0] })
  await s.page.locator('[data-tour="mode"] label').nth(0).click()
  await s.page.locator('[data-tour="tabs"] .tab').nth(0).click()
}
return lib.save('I2', { res, errs: lib.drain(s) })
```
Pass: every `keys` list empty; every toast text is in the target language and not a raw key; the screenshots show translated text (look at each: no English left in German/Russian/Chinese UI except product names, block names from game data, file names and units); Chinese and Cyrillic text renders with a font (no tofu boxes). Number formatting follows the locale (for example a block count of 1,234 is `1.234` in German); record one example.

**I3 Browser-language entry.** Open the menu, click `.lang-menu .lang-row` nth 0. Pass: `lang` auto, `localStorage['drydock.lang']` absent, `locale` en (the test browser is en-US), `.lang-row.on` is the first row, `aria-checked` true on it only.

**I4 Automatic detection.** New sessions with their own profiles:
```js
s.de = await lib.open({ profile: process.env.DD_PROFILE + '-de', locale: 'de-DE', tourSeen: false })
s.zh = await lib.open({ profile: process.env.DD_PROFILE + '-zh', locale: 'zh-TW', tourSeen: false })
const r = {
  de: { html: await s.de.page.evaluate(() => document.documentElement.lang), title: await s.de.page.locator('.tour-hello').innerText(), keys: await lib.rawKeys(s.de), shot: await lib.shot(s.de, 'I4-de', null) },
  zh: { html: await s.zh.page.evaluate(() => document.documentElement.lang), title: await s.zh.page.locator('.tour-hello').innerText(), keys: await lib.rawKeys(s.zh), shot: await lib.shot(s.zh, 'I4-zh', null) },
  errs: [lib.drain(s.de), lib.drain(s.zh)],
}
await lib.close(s.de); await lib.close(s.zh)
return r
```
Pass: `de.html` `de` and the title equals `welcome.title` in `src/locales/de.json`; `zh.html` `zh-Hant` and the title equals `welcome.title` in `src/locales/zh-Hant.json`; no raw keys.

## N Narrow screens

**N1 Narrow notice.**
```js
s.n = await lib.open({ profile: process.env.DD_PROFILE + '-narrow', w: 1000, h: 800 })
return { narrow: await s.n.page.evaluate(() => document.documentElement.classList.contains('narrow')), notice: await s.n.page.locator('#narrow').isVisible(), app: await s.n.page.locator('#app').isVisible(), booted: await s.n.page.evaluate(() => !!window.__drydock), langs: await s.n.page.locator('#narrow-langs a').count(), shot: await lib.shot(s.n, 'N1-narrow', null), errs: lib.drain(s.n) }
```
Pass: `narrow` and `notice` true, `app` and `booted` false, one language link per locale.

**N2 Language on the notice.** Click `#narrow-langs a[lang="de"]`. Pass: `#narrow-continue` reads "Trotzdem fortfahren", `html` lang `de`, `localStorage['drydock.lang']` "de", the link has class `on`.

**N3 Continue anyway.** Click `#narrow-continue`, wait for `window.__drydock`. Pass: app boots, `html.narrow` removed, `localStorage['drydock.narrowOk']` "1", `store.locale` de, no errors, screenshot `N3`.

**N4 Remembered.** `await lib.goto(s.n)`. Pass: the app boots directly, no notice. `await lib.close(s.n)`.

**N5 Boundary.** Two fresh profiles (`-w1119`, `-w1120`) at widths 1119 and 1120 (`goto` happens in `open`). Pass: 1119 shows the notice, 1120 boots the app. Close both.

## P Persistence across a reload (main profile)

**P0 Before closing.** In the main session: set the language to Русский (menu row nth 3), make sure seams are on (R4), then save the reference state:
```js
return lib.save('P0', { sum: await lib.summary(s), entries: await lib.entries(s), storage: await lib.storage(s), errs: lib.drain(s) })
```

**P1 Reopen the same profile.**
```js
await lib.close(s)
Object.assign(s, await lib.open())
await s.page.waitForFunction(() => document.body.dataset.snapshot === '1', null, { timeout: 60000 })
const p0 = lib.load('P0')
const sum = await lib.summary(s)
return {
  sourcesSame: lib.sameJson(sum.sources.map((x) => [x.id, x.name, x.kind]), p0.sum.sources.map((x) => [x.id, x.name, x.kind])),
  entries: [sum.entries, p0.sum.entries],
  locale: sum.locale, html: await s.page.evaluate(() => document.documentElement.lang),
  edges: sum.render.edges, seamsBox: await s.page.locator(lib.pane('view') + ' label.chk input').nth(0).isChecked(),
  welcome: await s.page.locator('.tour-welcome').isVisible(),
  nav: sum.nav, shot: await lib.shot(s, 'P1-reloaded', null), errs: lib.drain(s),
}
```
Pass: `sourcesSame` true, entry counts equal, `locale` and `html` `ru`, `edges` and `seamsBox` true, `welcome` false, `nav` reports the linked sources. A `@toast.uncached` toast may appear later (files are gone); that is expected.

**P2 Pairs from the snapshot.** For every pair open plain and gzipped entry with `lib.openEntry`. Pass: both load; plain and gzipped `lib.pick` are equal; name, `large` and `blockCount` equal G3 (`lib.load('G3')`), while `dims` and `lengthM` are compared with the game-linked values from G8/R1 (G3 ran before the game was linked, and game definitions give multi-cell blocks their real size); `perf` read/decode/parse are 0 (the cached parse was used because the files are no longer available); the unicode entry opens with the O3 values.

**P3 Entries that cannot be opened from the snapshot.** Open `SG Corrupt` (if listed): it could not be cached, so a `@toast.notInSnapshot` toast is expected. Open `SG Not A Blueprint`: its cached parse has no grids, so a `@toast.readFailed` saying it is not a blueprint is expected. Pass: those toasts, no pageerror, the previous model kept.

**P4 Skyboxes after reload.** Scene tab. Pass: vanilla skybox swatches are listed but disabled (`.sw-grid2 >> nth=0` buttons have `disabled`), the `.hint` note is visible, `scene.bg` is sky-default. Mod skyboxes are not listed until the workshop is linked again; this is intended, do not report it.

**P5 Models from the cache.** Open the section R subject. Pass: `__drydock.info().detail` true (block models come from the IndexedDB cache without re-linking the game); textures may be missing (a `@toast.texturesMissing` or `@toast.modelsMissing` toast is expected, record which).

**P6 Unlinked source stays gone.** The source removed in L12 is not in `sources`.

**P7 Settings can be reset.** Uncheck seams, choose the Browser-language row, then `lib.close(s)` and `Object.assign(s, await lib.open())`. Pass: `render.edges` false, `localStorage['drydock.seams']` "0", `drydock.lang` absent, `locale` en.

## F Focus checks (per run)

`$DD_RUN/focus.md` is written by the coordinator during maintenance. It lists the commits since the previous run and, for each behaviour they changed that the fixed steps do not already cover, a numbered focus check `F1`, `F2`, … with an action, a pass criterion and which runner runs it (both unless stated). Execute them after P7 with the same rigour and evidence as any other step, and report each as its own row. When `focus.md` says there are no focus checks, report a single row `F0 | SKIP | — | no focus checks for this run`.
