import { actions, store } from '../state/app.ts'
import { download } from '../util/save.ts'
import { zipStore } from '../util/zip.ts'
import { aspectOf, frameRect } from './camera.ts'
import type { Fit } from './camera.ts'
import type { Renderer } from './renderer.ts'

const MIME = { PNG: 'image/png', JPG: 'image/jpeg', WEBP: 'image/webp' } as const
const MAX_PIXELS = 64e6

export type ExportSize = { w: number; h: number; ss: number }

export function exportSize(): ExportSize {
  const e = store.get().export
  const h = e.res
  const w = Math.round(h * aspectOf(e.aspect))
  let ss = e.ss
  while (w * h * ss * ss > MAX_PIXELS && ss > 1) ss /= 2
  return { w, h, ss }
}

function transparentOf(): boolean {
  const s = store.get()
  return (s.export.transparent && s.export.fmt === 'PNG') || s.scene.bg === 'transparent'
}

function unpremultiply(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    if (a > 0 && a < 255) {
      const k = 255 / a
      d[i] = Math.min(255, d[i] * k)
      d[i + 1] = Math.min(255, d[i + 1] * k)
      d[i + 2] = Math.min(255, d[i + 2] * k)
    }
  }
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export function renderFrame(r: Renderer, cssW: number, yaw?: number, fit?: Fit): HTMLCanvasElement {
  const { w, h, ss } = exportSize()
  const W = w * ss
  const H = h * ss
  const transparent = transparentOf()
  const big = newCanvas(W, H)
  const ctx = big.getContext('2d')!
  const T = r.maxTile()
  r.exportBegin({ W, H, cssW, ss, transparent, yaw, fit })
  try {
    for (let y = 0; y < H; y += T)
      for (let x = 0; x < W; x += T) {
        const tw = Math.min(T, W - x)
        const th = Math.min(T, H - y)
        const px = r.exportTile(x, y, tw, th)
        const img = new ImageData(tw, th)
        for (let row = 0; row < th; row++) {
          const src = (th - 1 - row) * tw * 4
          img.data.set(px.subarray(src, src + tw * 4), row * tw * 4)
        }
        if (transparent) unpremultiply(img.data)
        ctx.putImageData(img, x, y)
      }
  } finally {
    r.exportEnd()
  }
  return downsample(big, w, h)
}

function downsample(c: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = c
  while (cur.width > w) {
    const nw = Math.max(w, Math.floor(cur.width / 2))
    const nh = Math.max(h, Math.floor(cur.height / 2))
    const next = newCanvas(nw, nh)
    const ctx = next.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, nw, nh)
    cur = next
  }
  return cur
}

function flatten(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = newCanvas(c.width, c.height)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(c, 0, 0)
  return out
}

function encode(c: HTMLCanvasElement, fmt: keyof typeof MIME): Promise<Blob> {
  const src = fmt === 'JPG' ? flatten(c) : c
  return new Promise((ok, fail) => src.toBlob((b) => (b ? ok(b) : fail(new Error('Encoding failed'))), MIME[fmt], 0.92))
}

export function fileName(): string {
  const s = store.get()
  const bp = (s.mode === 'compose' ? s.compose.name : (s.info?.name ?? 'blueprint')).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'blueprint'
  const base = s.export.fileName
    .replace('{blueprint}', bp)
    .replace('{view}', s.preset || 'custom')
    .replace('{date}', new Date().toISOString().slice(0, 10))
  return base.replace(/[\\/:*?"<>|]+/g, '_')
}

const ext = () => store.get().export.fmt.toLowerCase()

const nextFrame = () => new Promise<void>((ok) => setTimeout(ok, 30))

function cssWidth(canvas: HTMLCanvasElement): number {
  return frameRect(canvas.clientWidth, canvas.clientHeight, aspectOf(store.get().export.aspect)).w
}

export const exportPerf: { lastMs: number } = { lastMs: 0 }

async function guarded(fn: () => Promise<void>, failText: string) {
  if (store.get().busy) return
  store.set({ busy: true })
  await nextFrame()
  const t0 = performance.now()
  try {
    await fn()
    exportPerf.lastMs = performance.now() - t0
  } catch (err) {
    actions.toast(failText + (err instanceof Error ? err.message : String(err)))
  } finally {
    store.set({ busy: false })
  }
}

export function exportImage(r: Renderer, canvas: HTMLCanvasElement) {
  return guarded(async () => {
    const c = renderFrame(r, cssWidth(canvas))
    const blob = await encode(c, store.get().export.fmt)
    const name = `${fileName()}.${ext()}`
    download(blob, name)
    actions.toast(`Downloaded ${name} · ${c.width}×${c.height}`)
  }, 'Export failed: ')
}

export function copyImage(r: Renderer, canvas: HTMLCanvasElement) {
  return guarded(async () => {
    const c = renderFrame(r, cssWidth(canvas))
    const blob = await encode(c, 'PNG')
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      actions.toast('Image copied to clipboard')
    } catch {
      actions.toast('Clipboard not available')
    }
  }, 'Copy failed: ')
}

export function exportTurntable(r: Renderer, canvas: HTMLCanvasElement) {
  return guarded(async () => {
    const start = r.view.yaw
    const yaws = Array.from({ length: 36 }, (_, i) => start + (i * Math.PI) / 18)
    const fit = r.fitFor(yaws)
    const css = cssWidth(canvas)
    const fmt = store.get().export.fmt
    const base = fileName()
    const files: Array<{ name: string; data: Uint8Array }> = []
    for (let i = 0; i < yaws.length; i++) {
      const c = renderFrame(r, css, yaws[i], fit)
      const blob = await encode(c, fmt)
      const name = `${base}_${String(i + 1).padStart(3, '0')}.${ext()}`
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) })
      await nextFrame()
    }
    const name = `${base}_turntable.zip`
    download(zipStore(files), name)
    actions.toast(`Downloaded ${name} · 36 frames`)
  }, 'Turntable failed: ')
}
