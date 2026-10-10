import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as zlib from 'node:zlib'
import { join } from 'node:path'

export { fs, zlib, join }
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = fs

const need = (k) => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is not set (source your work/<runner>/env.sh first)`)
  return v
}
export const RUNNER = need('DD_RUNNER')
export const REPO = need('DD_REPO')
export const SKILL = need('DD_SKILL')
export const BASE = need('DD_BASE').replace(/\/$/, '')
export const OUT = need('DD_OUT')
export const PROFILE = need('DD_PROFILE')
export const ORIGIN = new URL(BASE).origin
export const KINDS = ['game', 'workshop', 'torch', 'mods', 'blueprints']
const { chromium } = createRequire(join(REPO, 'package.json'))('playwright-core')
for (const d of ['shots', 'logs', 'files']) mkdirSync(join(OUT, d), { recursive: true })

export const pane = (tab) => `#right .rbody > div:nth-child(${['view', 'section', 'scene', 'export'].indexOf(tab) + 1})`

export function note(step, data) {
  appendFileSync(join(OUT, 'logs', 'steps.jsonl'), JSON.stringify({ t: new Date().toISOString(), step, ...data }) + '\n')
  return data
}

export const manifest = () => JSON.parse(readFileSync(join(need('DD_FIX'), 'manifest.json'), 'utf8'))
export const fixture = (folder) => join(need('DD_FIX'), 'bp', folder, 'bp.sbc')
export const save = (name, data) => (writeFileSync(join(OUT, 'logs', `${name}.json`), JSON.stringify(data, null, 1)), data)
export const load = (name) => JSON.parse(readFileSync(join(OUT, 'logs', `${name}.json`), 'utf8'))
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const pick = (sum) => sum.info && { name: sum.info.name, large: sum.info.large, dims: sum.info.dims, blockCount: sum.info.blockCount, lengthM: sum.info.lengthM }
export const rows = (s) => s.page.evaluate(() => window.__drydock.store.get().info?.rows ?? null)

export async function open(o = {}) {
  const profile = o.profile ?? PROFILE
  mkdirSync(profile, { recursive: true })
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: process.env.DD_HEADED !== '1',
    viewport: { width: o.w ?? 1440, height: o.h ?? 900 },
    locale: o.locale ?? 'en-US',
    acceptDownloads: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'],
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  if (o.tourSeen !== false)
    await ctx.addInitScript(() => {
      try {
        if (location.protocol.startsWith('http') && !localStorage.getItem('drydock.tourSeen')) localStorage.setItem('drydock.tourSeen', '1')
      } catch {}
    })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const s = { ctx, page, profile, problems: [], external: [] }
  const clog = join(OUT, 'logs', 'console.log')
  page.on('console', (m) => {
    appendFileSync(clog, `${new Date().toISOString()} [${m.type()}] ${m.text()}\n`)
    if (m.type() === 'error') s.problems.push(`console.error: ${m.text()}`)
  })
  page.on('pageerror', (e) => {
    appendFileSync(clog, `${new Date().toISOString()} [pageerror] ${e.stack ?? e.message}\n`)
    s.problems.push(`pageerror: ${e.message}`)
  })
  page.on('request', (r) => {
    const u = r.url()
    if (!u.startsWith(ORIGIN) && !/^(data|blob):/.test(u)) s.external.push(u)
  })
  if (o.goto !== false) await goto(s, o.query ?? '')
  return s
}

export async function close(s) {
  await s.ctx?.close().catch(() => undefined)
  for (const k of ['ctx', 'page']) delete s[k]
}

export async function goto(s, query = '') {
  await s.page.goto(BASE + '/' + (query ? '?' + query.replace(/^\?/, '') : ''), { waitUntil: 'load' })
  await s.page.waitForFunction(() => !!window.__drydock || document.documentElement.classList.contains('narrow'), null, { timeout: 60000 })
  await hookToasts(s)
}

export async function hookToasts(s) {
  await s.page.evaluate(() => {
    if (!window.__drydock || window.__rtToasts) return
    window.__rtToasts = []
    window.__drydock.store.watch(
      (st) => st.toast,
      (v) => {
        if (v) requestAnimationFrame(() => window.__rtToasts.push({ at: Date.now(), raw: v, text: document.querySelector('.toast span')?.textContent ?? '' }))
      },
    )
  })
}

export const toasts = (s, since = 0) => s.page.evaluate((t) => (window.__rtToasts ?? []).filter((x) => x.at >= t), since)
export const now = (s) => s.page.evaluate(() => Date.now())

export function drain(s) {
  return { problems: s.problems.splice(0), external: s.external.splice(0) }
}

export const summary = (s) =>
  s.page.evaluate(() => {
    const st = window.__drydock.store.get()
    const i = st.info
    const t = document.querySelector('.toast')
    return {
      mode: st.mode,
      bp: st.bp,
      loading: st.loading,
      busy: st.busy,
      modelVersion: st.modelVersion,
      toast: st.toast,
      toastText: t && !t.hidden ? (t.querySelector('span')?.textContent ?? '') : '',
      tab: st.tab,
      locale: st.locale,
      lang: st.lang,
      tour: st.tour,
      info: i && { name: i.name, large: i.large, dims: i.dims, blockCount: i.blockCount, lengthM: i.lengthM },
      caption: [document.querySelector('.cap .nm')?.textContent, document.querySelector('.cap .dm')?.textContent],
      compose: { n: st.compose.shapes.length, sel: st.compose.selShape, grid: st.compose.grid, name: st.compose.name, blocks: st.composeInfo?.blockCount ?? null, busy: st.composeBusy },
      render: st.render,
      section: st.section,
      scene: st.scene,
      exp: st.export,
      preset: st.preset,
      spin: st.spin,
      sources: st.sources.map((x) => ({ id: x.id, name: x.name, kind: x.kind, note: x.note })),
      entries: st.entries.length,
      scanText: st.scanText,
      assetText: st.assetText,
      modRows: st.modRows.map((r) => ({ key: r.key, enabled: r.enabled, missing: r.missing })),
      unknown: st.unknownBlocks,
      skies: st.skies.map((k) => ({ id: k.id, src: k.src, ready: k.ready })),
      srcOpen: st.srcOpen,
      missingOpen: st.missingOpen,
      ready: document.body.dataset.ready === '1',
      snapshot: document.body.dataset.snapshot === '1',
      footer: document.querySelector('#foot')?.textContent ?? '',
      nav: document.querySelector('.navstat')?.textContent ?? '',
    }
  })

export const entries = (s) =>
  s.page.evaluate(() => window.__drydock.store.get().entries.map((e) => ({ id: e.id, name: e.name, large: e.large, size: e.size, blocks: e.blocks, mods: e.mods, unresolved: e.unresolved ?? null, list: e.list, hasFile: !!e.file })))

export const version = (s) => s.page.evaluate(() => window.__drydock.store.get().modelVersion)

const FAIL = /^@toast\.(readFailed|dropFailed|urlFailed|openFailed|notInSnapshot)/

export async function waitModel(s, prev, timeout = 120000, since) {
  const t0 = Date.now()
  const pt0 = since ?? (await now(s))
  let timedOut = false
  try {
    await s.page.waitForFunction(
      (p) => {
        const st = window.__drydock.store.get()
        if (st.modelVersion > p.v && !st.loading && document.body.dataset.ready === '1') return true
        return !st.loading && (window.__rtToasts ?? []).some((x) => x.at >= p.t0 && new RegExp(p.fail).test(x.raw))
      },
      { v: prev, t0: pt0, fail: FAIL.source },
      { timeout, polling: 100 },
    )
  } catch {
    timedOut = true
  }
  const sum = await summary(s)
  const ok = !timedOut && sum.modelVersion > prev && sum.ready
  return { ok, timedOut, ms: Date.now() - t0, perf: ok ? await s.page.evaluate(() => window.__drydock.perf()) : null, toasts: await toasts(s, pt0), ...sum }
}

export async function openEntry(s, folder, timeout) {
  const v = await version(s)
  const t0 = await now(s)
  const found = await s.page.evaluate((f) => {
    const e = window.__drydock.store.get().entries.find((x) => x.id.endsWith('/' + f))
    if (!e) return false
    void window.__drydock.actions.openEntry(e)
    return true
  }, folder)
  if (!found) return { ok: false, error: `no entry for folder ${folder}` }
  return waitModel(s, v, timeout, t0)
}

export async function dropFile(s, path, name = 'bp.sbc') {
  const route = `/__rt_drop/${Date.now()}/${encodeURIComponent(name)}`
  const data = readFileSync(path)
  await s.page.route((u) => u.pathname === route, (r) => r.fulfill({ body: data, contentType: 'application/octet-stream' }))
  const v = await version(s)
  const t0 = await now(s)
  await s.page.evaluate(
    async ({ route, name }) => {
      const blob = await (await fetch(route)).blob()
      const dt = new DataTransfer()
      dt.items.add(new File([blob], name))
      const target = document.getElementById('view')
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { route, name },
  )
  return waitModel(s, v, 120000, t0)
}

export async function linkStart(s, kind, dir) {
  const i = KINDS.indexOf(kind)
  if (i < 0) throw new Error(`unknown kind ${kind}`)
  s.linkBefore = await s.page.evaluate(() => window.__drydock.store.get().sources.map((x) => `${x.id}:${x.when}`))
  s.linkT0 = await now(s)
  if (!(await s.page.locator('.link-card').first().isVisible())) await s.page.locator('[data-tour="sources"]').click()
  const [fc] = await Promise.all([s.page.waitForEvent('filechooser', { timeout: 15000 }), s.page.locator('.link-card').nth(i).click()])
  await fc.setFiles(dir, { timeout: 0 })
  return { started: kind, dir }
}

export async function refreshStart(s, sourceName, dir) {
  s.linkBefore = await s.page.evaluate(() => window.__drydock.store.get().sources.map((x) => `${x.id}:${x.when}`))
  s.linkT0 = await now(s)
  if (!(await s.page.locator('.link-card').first().isVisible())) await s.page.locator('[data-tour="sources"]').click()
  const row = s.page.locator('.src-row').filter({ has: s.page.locator('.nm', { hasText: sourceName }) })
  const [fc] = await Promise.all([s.page.waitForEvent('filechooser', { timeout: 15000 }), row.locator('button.btn-secondary').click()])
  await fc.setFiles(dir, { timeout: 0 })
  return { started: 'refresh', sourceName }
}

export async function linkWait(s, timeout = 240000) {
  try {
    await s.page.waitForFunction(
      (b) => {
        const st = window.__drydock.store.get()
        return st.scanText === '' && st.sources.some((x) => !b.includes(`${x.id}:${x.when}`))
      },
      s.linkBefore ?? [],
      { timeout, polling: 1000 },
    )
    return { done: true, toasts: await toasts(s, s.linkT0 ?? 0), ...(await summary(s)) }
  } catch {
    return { done: false, toasts: await toasts(s, s.linkT0 ?? 0), ...(await summary(s)) }
  }
}

export async function waitIdle(s, timeout = 240000) {
  try {
    await s.page.waitForFunction(
      () => {
        const st = window.__drydock.store.get()
        const a = window.__drydock.info().assets
        return st.scanText === '' && st.assetText === '' && !st.loading && !st.busy && !st.composeBusy && a.meshesDone === a.meshes && a.texturesDone === a.textures
      },
      null,
      { timeout, polling: 500 },
    )
    return { idle: true, ...(await summary(s)) }
  } catch {
    return { idle: false, ...(await summary(s)) }
  }
}

export async function shot(s, name, selector = '#view') {
  const path = join(OUT, 'shots', `${name}.png`)
  if (selector) await s.page.locator(selector).screenshot({ path })
  else await s.page.screenshot({ path })
  return path
}

export async function download(s, trigger, as, timeout = 600000) {
  const [d] = await Promise.all([s.page.waitForEvent('download', { timeout }), trigger()])
  const path = join(OUT, 'files', as ?? d.suggestedFilename())
  await d.saveAs(path)
  return { path, suggested: d.suggestedFilename(), bytes: readFileSync(path).length }
}

export async function noDownload(s, trigger, ms = 4000) {
  let got = null
  const on = (d) => (got = d.suggestedFilename())
  s.page.on('download', on)
  await trigger()
  await s.page.waitForTimeout(ms)
  s.page.off('download', on)
  return { downloaded: got }
}

export async function setRange(s, selector, value) {
  await s.page.locator(selector).evaluate((el, v) => {
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

export async function imageInfo(s, path) {
  const b64 = readFileSync(path).toString('base64')
  return s.page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none' })
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const x = c.getContext('2d')
    x.drawImage(bmp, 0, 0)
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data
    let opaque = 0
    let clear = 0
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] === 255) opaque++
      else if (d[i] === 0) clear++
    }
    const px = (u, v) => Array.from(x.getImageData(u, v, 1, 1).data)
    const n = bmp.width * bmp.height
    return { w: bmp.width, h: bmp.height, corner: px(0, 0), center: px(bmp.width >> 1, bmp.height >> 1), opaqueFrac: opaque / n, clearFrac: clear / n }
  }, b64)
}

export async function animInfo(s, path, probe = [0, 9, 18]) {
  const buf = readFileSync(path)
  const allDurationsMs = []
  for (let o = 12; o + 8 <= buf.length; ) {
    const size = buf.readUInt32LE(o + 4)
    if (buf.toString('latin1', o, o + 4) === 'ANMF') allDurationsMs.push(buf.readUIntLE(o + 20, 3))
    o += 8 + size + (size & 1)
  }
  const b64 = buf.toString('base64')
  const info = await s.page.evaluate(
    async ({ b64, probe }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dec = new ImageDecoder({ data: bytes, type: 'image/webp' })
      await dec.tracks.ready
      const tr = dec.tracks.selectedTrack
      const out = { frames: tr.frameCount, animated: tr.animated, loopsForever: tr.repetitionCount === Infinity, w: 0, h: 0, durationsMs: [], firstClearFrac: 0, changedFrac: [] }
      let first = null
      for (const i of probe) {
        const { image } = await dec.decode({ frameIndex: i })
        out.durationsMs.push(image.duration / 1000)
        const c = new OffscreenCanvas(image.displayWidth, image.displayHeight)
        const x = c.getContext('2d')
        x.drawImage(image, 0, 0)
        const d = x.getImageData(0, 0, c.width, c.height).data
        const n = c.width * c.height
        out.w = c.width
        out.h = c.height
        if (!first) {
          first = d.slice()
          let clear = 0
          for (let k = 3; k < d.length; k += 4) if (d[k] < 255) clear++
          out.firstClearFrac = clear / n
        } else {
          let ch = 0
          for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - first[k]) + Math.abs(d[k + 1] - first[k + 1]) + Math.abs(d[k + 2] - first[k + 2]) > 30) ch++
          out.changedFrac.push(ch / n)
        }
        image.close()
      }
      dec.close()
      return out
    },
    { b64, probe },
  )
  return { ...info, allDurationsMs }
}

export async function imgDiff(s, a, b, tol = 8) {
  const A = readFileSync(a).toString('base64')
  const B = readFileSync(b).toString('base64')
  return s.page.evaluate(
    async ({ A, B, tol }) => {
      const load = async (b64) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]))
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const x = c.getContext('2d')
        x.drawImage(bmp, 0, 0)
        return x.getImageData(0, 0, bmp.width, bmp.height)
      }
      const [p, q] = await Promise.all([load(A), load(B)])
      if (p.width !== q.width || p.height !== q.height) return { sameSize: false, frac: 1 }
      let n = 0
      for (let i = 0; i < p.data.length; i += 4)
        if (Math.abs(p.data[i] - q.data[i]) > tol || Math.abs(p.data[i + 1] - q.data[i + 1]) > tol || Math.abs(p.data[i + 2] - q.data[i + 2]) > tol || Math.abs(p.data[i + 3] - q.data[i + 3]) > tol) n++
      return { sameSize: true, frac: n / (p.width * p.height) }
    },
    { A, B, tol },
  )
}

export const rawKeys = (s) =>
  s.page.evaluate(() => {
    const key = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+)+$/
    const bad = (t) => (key.test(t) && !/\.(sbc|json|png|jpg|webp|zip|com|io)$/i.test(t)) || /\{\w+\}/.test(t) || t.startsWith('@')
    const out = []
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.data.trim()
      if (t && bad(t)) out.push(t)
    }
    for (const el of document.querySelectorAll('[title],[placeholder],[aria-label]'))
      for (const a of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(a)
        if (v && bad(v.trim())) out.push(`${a}=${v}`)
      }
    return out
  })

export const storage = (s) =>
  s.page.evaluate(() => {
    const o = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      o[k] = localStorage.getItem(k)
    }
    return o
  })

export const gpu = (s) =>
  s.page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return { webgl2: false }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return { webgl2: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), ua: navigator.userAgent }
  })
