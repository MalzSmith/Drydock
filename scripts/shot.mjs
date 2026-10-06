import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const argv = process.argv.slice(2)
const pos = []
const opt = { click: [], eval: [] }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--headed') opt.headed = true
  else if (a.startsWith('--')) {
    const k = a.slice(2)
    const v = argv[++i]
    if (k === 'click' || k === 'eval') opt[k].push(v)
    else opt[k] = v
  } else pos.push(a)
}
const [url, out] = pos
if (!url || !out) {
  console.error('usage: shot.mjs <url> <out.png> [--bp file] [--w 1440] [--h 900] [--click selector]... [--eval js]... [--bench frames] [--headed] [--timeout ms]')
  process.exit(1)
}

const width = +(opt.w ?? 1440)
const height = +(opt.h ?? 900)
const timeout = +(opt.timeout ?? 60000)
const browser = await chromium.launch({
  channel: 'msedge',
  headless: !opt.headed,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'],
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: +(opt.dpr ?? 1) })
page.on('console', (m) => console.log('[page]', m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

let target = url
if (opt.bp) {
  const data = readFileSync(opt.bp)
  await page.route((u) => u.pathname === '/__bp.sbc', (r) => r.fulfill({ body: data, contentType: 'application/octet-stream' }))
  target += (url.includes('?') ? '&' : '?') + 'bp=/__bp.sbc'
}

const t0 = Date.now()
await page.goto(target)
if (opt.bp) await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout })
else await page.waitForTimeout(+(opt.wait ?? 600))
const readyMs = Date.now() - t0
for (const sel of opt.click) {
  await page.click(sel)
  await page.waitForTimeout(250)
}
for (const js of opt.eval) console.log('[eval]', JSON.stringify(await page.evaluate(js)))
if (opt.bench) console.log('[bench]', JSON.stringify(await page.evaluate((n) => window.__drydock.bench(n), +opt.bench)))
if (opt.fps) console.log('[fps]', JSON.stringify(await page.evaluate((n) => window.__drydock.fps(n), +opt.fps)))
if (opt.bp) console.log('[perf]', JSON.stringify(await page.evaluate(() => window.__drydock.perf())), 'wall', readyMs, 'ms')
await page.waitForTimeout(150)
mkdirSync(dirname(out), { recursive: true })
await page.screenshot({ path: out })
await browser.close()
