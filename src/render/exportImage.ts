import { actions, STREAM_ABOVE, store } from '../state/app.ts'
import { download } from '../util/save.ts'
import { zipStore } from '../util/zip.ts'
import { animatedWebp } from '../util/webp.ts'
import { aspectOf, frameRect } from './camera.ts'
import type { Fit } from './camera.ts'
import type { Renderer } from './renderer.ts'
import { errText, keyed } from '../util/keyed.ts'
import { tilePlan } from './lanczos.ts'
import { pngRpc } from '../workers/client.ts'
import type { PngArg } from '../workers/work.worker.ts'

const MIME = { PNG: 'image/png', JPG: 'image/jpeg', WEBP: 'image/webp' } as const

export type ExportSize = { w: number; h: number; ss: number }

export function exportSize(): ExportSize {
  const e = store.get().export
  const h = e.res
  return { w: Math.round(h * aspectOf(e.aspect)), h, ss: e.ss }
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

const CANCELLED = new Error('cancelled')
let cancelled = false

export function cancelExport() {
  cancelled = true
}

type FrameOpts = { yaw?: number; fit?: Fit; transparent?: boolean; progress?: (f: number) => void }

async function eachTile(
  r: Renderer,
  cssW: number,
  o: FrameOpts,
  onTile: (px: Uint8Array, ox: number, oy: number, ow: number, oh: number) => void,
  onBand?: (oh: number) => Promise<void>,
) {
  const { w, h, ss } = exportSize()
  const plan = tilePlan(w, ss, r.maxTile())
  const total = Math.ceil(w / plan.ow) * Math.ceil(h / plan.oh)
  const progress = o.progress ?? ((f: number) => store.set({ progress: f }))
  let done = 0
  r.exportBegin({ W: w * ss, H: h * ss, cssW, ss, transparent: o.transparent ?? transparentOf(), yaw: o.yaw, fit: o.fit })
  try {
    for (let oy = 0; oy < h; oy += plan.oh) {
      const oh = Math.min(plan.oh, h - oy)
      for (let ox = 0; ox < w; ox += plan.ow) {
        const ow = Math.min(plan.ow, w - ox)
        onTile(r.exportLanczos(plan, ox, oy, ow, oh), ox, oy, ow, oh)
        progress(++done / total)
        await new Promise((ok) => setTimeout(ok, 0))
        if (cancelled) throw CANCELLED
      }
      await onBand?.(oh)
    }
  } finally {
    r.exportEnd()
  }
}

export async function renderFrame(r: Renderer, cssW: number, o: FrameOpts = {}): Promise<HTMLCanvasElement> {
  const { w, h } = exportSize()
  const out = newCanvas(w, h)
  const ctx = out.getContext('2d')!
  await eachTile(r, cssW, o, (px, ox, oy, ow, oh) => ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), ow, oh), ox, oy))
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
  if (store.get().assetText) return actions.toast(keyed('toast.waitAssets'), true)
  cancelled = false
  store.set({ busy: true, progress: 0 })
  await nextFrame()
  const t0 = performance.now()
  try {
    await fn()
    exportPerf.lastMs = performance.now() - t0
  } catch (err) {
    if (err === CANCELLED) actions.toast(keyed('toast.exportCancelled'))
    else actions.toast(keyed(failKey, { error: errText(err) }), true)
  } finally {
    store.set({ busy: false, progress: null })
  }
}

async function streamPng(r: Renderer, cssW: number): Promise<{ blob: Blob; w: number; h: number }> {
  const { w, h } = exportSize()
  const transparent = transparentOf()
  const png = pngRpc()
  let band: Uint8Array<ArrayBuffer> | null = null
  let inFlight: Promise<unknown> = Promise.resolve()
  await png.call('pngBegin', { w, h, alpha: transparent } satisfies PngArg)
  try {
    await eachTile(
      r,
      cssW,
      { transparent },
      (px, ox, _oy, ow, oh) => {
        band ??= new Uint8Array(w * oh * 4)
        for (let y = 0; y < oh; y++) band.set(px.subarray(y * ow * 4, (y + 1) * ow * 4), (y * w + ox) * 4)
      },
      async (oh) => {
        await inFlight
        const rows = band!
        band = null
        inFlight = png.call('pngRows', { rgba: rows.buffer, rows: oh }, [rows.buffer])
      },
    )
    await inFlight
  } catch (err) {
    await inFlight.catch(() => {})
    await png.call('pngAbort', null)
    throw err
  }
  return { blob: await png.call<Blob>('pngEnd', null), w, h }
}

export function exportImage(r: Renderer, canvas: HTMLCanvasElement) {
  return guarded(async () => {
    const name = `${fileName()}.${ext()}`
    if (store.get().export.res > STREAM_ABOVE) {
      const out = await streamPng(r, cssWidth(canvas))
      download(out.blob, name)
      return actions.toast(keyed('toast.downloadedFile', { file: name, detail: `${out.w}×${out.h}` }))
    }
    const c = await renderFrame(r, cssWidth(canvas))
    const blob = await encode(c, store.get().export.fmt)
    download(blob, name)
    actions.toast(keyed('toast.downloadedFile', { file: name, detail: `${c.width}×${c.height}` }))
  }, 'toast.exportFailed')
}

export function copyImage(r: Renderer, canvas: HTMLCanvasElement) {
  return guarded(async () => {
    const c = await renderFrame(r, cssWidth(canvas))
    const blob = await encode(c, 'PNG')
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      actions.toast(keyed('toast.copied'))
    } catch {
      actions.toast(keyed('toast.noClipboard'), true)
    }
  }, 'toast.copyFailed')
}

const SPIN_FRAMES = 36

async function spinFrames(r: Renderer, canvas: HTMLCanvasElement, transparent: boolean, each: (c: HTMLCanvasElement, i: number) => Promise<void>) {
  const start = r.view.yaw
  const yaws = Array.from({ length: SPIN_FRAMES }, (_, i) => start + (i * 2 * Math.PI) / SPIN_FRAMES)
  const fit = r.fitFor(yaws)
  const css = cssWidth(canvas)
  for (let i = 0; i < yaws.length; i++)
    await each(await renderFrame(r, css, { yaw: yaws[i], fit, transparent, progress: (f) => store.set({ progress: (i + f) / SPIN_FRAMES }) }), i)
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
