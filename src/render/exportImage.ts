import { actions, store } from '../state/app.ts'
import { download } from '../util/save.ts'
import { zipStore } from '../util/zip.ts'
import { animatedWebp } from '../util/webp.ts'
import { aspectOf, frameRect } from './camera.ts'
import type { Fit } from './camera.ts'
import type { Renderer } from './renderer.ts'
import { errText, keyed } from '../util/keyed.ts'
import { shrinkTile } from './shrink.ts'

const MIME = { PNG: 'image/png', JPG: 'image/jpeg', WEBP: 'image/webp' } as const
const MAX_PIXELS = 700e6

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

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export function renderFrame(r: Renderer, cssW: number, yaw?: number, fit?: Fit, transparent = transparentOf()): HTMLCanvasElement {
  const { w, h, ss } = exportSize()
  const W = w * ss
  const H = h * ss
  const out = newCanvas(w, h)
  const ctx = out.getContext('2d')!
  const T = r.maxTile() - (r.maxTile() % ss)
  r.exportBegin({ W, H, cssW, ss, transparent, yaw, fit })
  try {
    for (let y = 0; y < H; y += T)
      for (let x = 0; x < W; x += T) {
        const tw = Math.min(T, W - x)
        const th = Math.min(T, H - y)
        ctx.putImageData(new ImageData(shrinkTile(r.exportTile(x, y, tw, th), tw, th, ss, transparent), tw / ss, th / ss), x / ss, y / ss)
      }
  } finally {
    r.exportEnd()
  }
  return out
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
  return new Promise((ok, fail) => src.toBlob((b) => (b ? ok(b) : fail(new Error(keyed('errors.encoding')))), MIME[fmt], 0.92))
}

export function fileName(): string {
  const s = store.get()
  const bp = (s.mode === 'compose' ? s.compose.name : (s.info?.name ?? 'blueprint')).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'blueprint'
  const base = s.export.fileName
    .replace('{blueprint}', bp)
    .replace('{date}', new Date().toISOString().slice(0, 10))
  return base.replace(/[\\/:*?"<>|]+/g, '_')
}

const ext = () => store.get().export.fmt.toLowerCase()

const nextFrame = () => new Promise<void>((ok) => setTimeout(ok, 30))

function cssWidth(canvas: HTMLCanvasElement): number {
  return frameRect(canvas.clientWidth, canvas.clientHeight, aspectOf(store.get().export.aspect)).w
}

export const exportPerf: { lastMs: number } = { lastMs: 0 }

async function guarded(fn: () => Promise<void>, failKey: string) {
  if (store.get().busy) return
  store.set({ busy: true })
  await nextFrame()
  const t0 = performance.now()
  try {
    await fn()
    exportPerf.lastMs = performance.now() - t0
  } catch (err) {
    actions.toast(keyed(failKey, { error: errText(err) }))
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
    actions.toast(keyed('toast.downloadedFile', { file: name, detail: `${c.width}×${c.height}` }))
  }, 'toast.exportFailed')
}

export function copyImage(r: Renderer, canvas: HTMLCanvasElement) {
  return guarded(async () => {
    const c = renderFrame(r, cssWidth(canvas))
    const blob = await encode(c, 'PNG')
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      actions.toast(keyed('toast.copied'))
    } catch {
      actions.toast(keyed('toast.noClipboard'))
    }
  }, 'toast.copyFailed')
}

const SPIN_FRAMES = 36

async function spinFrames(r: Renderer, canvas: HTMLCanvasElement, transparent: boolean, each: (c: HTMLCanvasElement, i: number) => Promise<void>) {
  const start = r.view.yaw
  const yaws = Array.from({ length: SPIN_FRAMES }, (_, i) => start + (i * 2 * Math.PI) / SPIN_FRAMES)
  const fit = r.fitFor(yaws)
  const css = cssWidth(canvas)
  for (let i = 0; i < yaws.length; i++) {
    await each(renderFrame(r, css, yaws[i], fit, transparent), i)
    await new Promise((ok) => setTimeout(ok, 0))
  }
}

export function exportTurntable(r: Renderer, canvas: HTMLCanvasElement) {
  return guarded(async () => {
    const fmt = store.get().export.fmt
    const base = fileName()
    const files: Array<{ name: string; data: Uint8Array }> = []
    await spinFrames(r, canvas, transparentOf(), async (c, i) => {
      const blob = await encode(c, fmt)
      const name = `${base}_${String(i + 1).padStart(3, '0')}.${ext()}`
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) })
    })
    const name = `${base}_turntable.zip`
    download(zipStore(files), name)
    actions.toast(keyed('toast.downloadedFile', { file: name, detail: keyed('units.frames', { count: SPIN_FRAMES }) }))
  }, 'toast.turntableFailed')
}

export function exportSpinWebp(r: Renderer, canvas: HTMLCanvasElement) {
  return guarded(async () => {
    const s = store.get()
    const transparent = s.export.transparent || s.scene.bg === 'transparent'
    const frames: Uint8Array[] = []
    let w = 0
    let h = 0
    await spinFrames(r, canvas, transparent, async (c) => {
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/webp', 0.8))
      if (!blob) throw new Error(keyed('errors.encoding'))
      if (blob.type !== 'image/webp') throw new Error(keyed('errors.noWebp'))
      frames.push(new Uint8Array(await blob.arrayBuffer()))
      w = c.width
      h = c.height
    })
    const name = `${fileName()}_turntable.webp`
    download(animatedWebp(frames, w, h, 1000 / 24, transparent), name)
    actions.toast(keyed('toast.downloadedFile', { file: name, detail: keyed('units.frames', { count: SPIN_FRAMES }) }))
  }, 'toast.turntableFailed')
}
