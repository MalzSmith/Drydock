import { PARSE_VERSION, decodeBlueprint, parseBlueprint, type ParsedBlueprint } from '../se/blueprint.ts'
import { idbDelete, idbGet, idbKeys, idbPut } from '../sources/idb.ts'
import { mapPool, treeFromFiles } from '../sources/fs.ts'
import { scanSource, type BpMeta, type ModCacheRec, type ScanResult, type ScanCache, type SourceKind } from '../sources/scan.ts'
import { MAX_EXPORT_BLOCKS, writeSbc } from '../se/sbcWrite.ts'
import { surfaceInstances, voxelize, type CutSpec, type VShape } from '../compose/csg.ts'
import { request, serve } from './rpc.ts'
import { loadMesh, loadTexture, type AssetEnv, type Caps } from '../assets/build.ts'
import { defModels } from '../assets/keys.ts'
import { SKY_FACE, SKY_THUMB, SKY_V, panorama, readSky, skyForCaps, type SkyMeta, type SkyOrient, type SkyRec } from '../assets/sky.ts'
import type { SkyDef } from '../se/env.ts'

export type ScanArg = { files: File[]; kind: SourceKind; sourceId: number }
export type ScanReply = { result: ScanResult; persisted: boolean; ms: number }
export type CacheArg = { sourceId: number; items: Array<{ id: string; name: string; file: File }> }
export type CacheReply = { cached: number; reused: number; failed: boolean; ms: number }
export type SnapRec = Omit<ScanResult, 'seenMods'>
export type BpRec = { fp: string; v?: number; parsed: ParsedBlueprint }

async function prune(store: 'mods' | 'bps', sourceId: number, keep: Set<string>) {
  const prefix = `${sourceId}/`
  for (const k of await idbKeys(store)) if (typeof k === 'string' && k.startsWith(prefix) && !keep.has(k)) await idbDelete(store, k)
}

const cache: ScanCache = {
  getMod: (key) => idbGet<ModCacheRec>('mods', key),
  putMod: (key, rec) => idbPut('mods', key, rec).then(() => undefined),
  getBpMeta: (key) => idbGet<BpMeta | number>('bpmeta', key),
}

export type ParseArg = { buffer?: ArrayBuffer; file?: File; name: string }
export type ParseResult = { parsed: ParsedBlueprint; ms: { read: number; decode: number; parse: number } }

export type VoxelizeResult = { inst: ArrayBuffer; types: Uint8Array; count: number; dims: [number, number, number]; total: number; counts: number[]; ms: number }
export type WriteResult = { blob: Blob; total: number }

const assetFiles = new Map<number, Set<string>>()
const prefixes = new Map<number, Set<string>>()
const fetched = new Map<string, Promise<File | undefined>>()

const assetEnv: AssetEnv = {
  has(key) {
    for (const s of assetFiles.values()) if (s.has(key)) return true
    return false
  },
  file(key) {
    if (!assetEnv.has(key)) return Promise.resolve(undefined)
    let f = fetched.get(key)
    if (!f) {
      f = request<File | undefined>('assetFile', key)
      fetched.set(key, f)
    }
    return f
  },
  hasPrefix(prefix) {
    for (const s of prefixes.values()) if (s.has(prefix)) return true
    return false
  },
  cacheGet: (store, key) => idbGet(store, key),
  cachePut: (store, key, v) => idbPut(store, key, v).then(() => undefined),
}

export type AssetArg = { sourceId: number; keys: string[] }

export type SkyLoad = { data: SkyRec['data']; orient: SkyOrient } | null

const skyPath = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const skyStem = (p: string) => p.replace(/\\/g, '/').split('/').pop()!.replace(/\.dds$/i, '')

async function thumbnail(f: File, orient: SkyOrient): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null
  const small = await readSky(f, SKY_THUMB.face, false)
  if (!small) return null
  const px = panorama(small, orient, SKY_THUMB.w, SKY_THUMB.h)
  const c = new OffscreenCanvas(SKY_THUMB.w, SKY_THUMB.h)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), SKY_THUMB.w, SKY_THUMB.h), 0, 0)
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}

serve({
  registerAssets(arg: AssetArg) {
    const m = new Set(arg.keys)
    const p = new Set<string>()
    for (const k of m) p.add(k.startsWith('c:') ? 'c:' : k.slice(0, k.indexOf(':', 2) + 1))
    assetFiles.delete(arg.sourceId)
    assetFiles.set(arg.sourceId, m)
    prefixes.set(arg.sourceId, p)
    fetched.clear()
    return { result: m.size }
  },
  dropAssets(arg: { sourceId: number }) {
    assetFiles.delete(arg.sourceId)
    prefixes.delete(arg.sourceId)
    fetched.clear()
    return { result: true }
  },
  async cacheModels(arg: { sourceId: number }, emit) {
    const files = assetFiles.get(arg.sourceId)
    const snap = await idbGet<SnapRec>('snap', arg.sourceId)
    if (!files || !snap) return { result: 0 }
    const lists = defModels(snap.defs, null)
    for (const m of snap.mods) {
      const rec = await idbGet<ModCacheRec>('mods', m.key)
      if (rec) lists.push(...defModels(rec.defs, m.key))
    }
    const todo = lists.filter((c) => files.has(c[0]))
    let done = 0
    let cached = 0
    await mapPool(todo, 4, async (cands) => {
      if (assetFiles.get(arg.sourceId) !== files) return
      const r = await loadMesh(assetEnv, cands).catch(() => null)
      if (r?.status === 'ok') cached++
      done++
      if (done % 10 === 0 || done === todo.length) emit('progress', { sourceId: arg.sourceId, text: `Caching models ${done.toLocaleString('en-US')}/${todo.length.toLocaleString('en-US')}`, frac: done / todo.length })
    })
    return { result: cached }
  },
  async cacheSkies(arg: { sourceId: number }, emit) {
    const files = assetFiles.get(arg.sourceId)
    const snap = await idbGet<SnapRec>('snap', arg.sourceId)
    if (!files || !snap) return { result: 0 }
    const todo: Array<{ cands: string[]; name: string; src: string; def: SkyDef }> = []
    for (const def of snap.skies ?? []) todo.push({ cands: ['c:' + skyPath(def.path)], name: skyStem(def.path).replace(/_/g, ' '), src: 'Vanilla', def })
    for (const m of snap.modSkies ?? [])
      for (const def of m.skies) todo.push({ cands: [`m:${m.key}:${skyPath(def.path)}`, 'c:' + skyPath(def.path)], name: m.name, src: 'Mod · ' + skyStem(def.path), def })
    const seen = new Set<string>()
    let cached = 0
    for (let i = 0; i < todo.length; i++) {
      emit('progress', { sourceId: arg.sourceId, text: `Caching skyboxes ${i + 1}/${todo.length}`, frac: (i + 1) / todo.length })
      const t = todo[i]
      const key = t.cands.find((c) => assetEnv.has(c))
      if (!key || seen.has(key)) continue
      seen.add(key)
      const f = await assetEnv.file(key)
      if (!f) continue
      const fp = `${f.size}|${f.lastModified}`
      const orient: SkyOrient = [t.def.yaw, t.def.pitch, t.def.roll]
      try {
        const have = await idbGet<SkyRec>('skies', key)
        if (!have || have.v !== SKY_V || have.fp !== fp) {
          const data = await readSky(f, SKY_FACE, true)
          if (!data) continue
          await idbPut('skies', key, { v: SKY_V, fp, data } satisfies SkyRec)
        }
        const old = await idbGet<SkyMeta>('skymeta', key)
        if (!old || old.src !== t.src || old.name !== t.name || old.orient.some((x, j) => x !== orient[j]) || !old.thumb || have?.fp !== fp)
          await idbPut('skymeta', key, { key, name: t.name, src: t.src, orient, thumb: await thumbnail(f, orient).catch(() => null) } satisfies SkyMeta)
        cached++
      } catch {
        continue
      }
    }
    return { result: cached }
  },
  async loadSky(arg: { key: string; caps: Caps }) {
    const rec = await idbGet<SkyRec>('skies', arg.key)
    const meta = await idbGet<SkyMeta>('skymeta', arg.key)
    if (!rec || !meta || rec.v !== SKY_V) return { result: null }
    const data = skyForCaps(rec.data, arg.caps)
    const result: SkyLoad = { data, orient: meta.orient }
    return { result, transfer: data.faces.map((f) => f.buffer as ArrayBuffer) }
  },
  async loadMesh(arg: { cands: string[] }) {
    const r = await loadMesh(assetEnv, arg.cands)
    const d = r.data
    return { result: r, transfer: d ? [d.pos.buffer, d.nrm.buffer, d.uv.buffer, d.idx.buffer] : [] }
  },
  async loadTexture(arg: { cands: string[]; caps: Caps }) {
    const r = await loadTexture(assetEnv, arg.cands, arg.caps)
    const buffers = new Set<ArrayBuffer>()
    for (const l of r.data?.levels ?? []) buffers.add(l.data.buffer as ArrayBuffer)
    return { result: r, transfer: [...buffers] }
  },
  voxelize(arg: { shapes: VShape[]; sel: number; cut: CutSpec | null }) {
    const t0 = performance.now()
    const v = voxelize(arg.shapes, arg.sel)
    const s = surfaceInstances(v, arg.cut)
    const result: VoxelizeResult = { inst: s.inst, types: s.types, count: s.count, dims: v.dims, total: v.total, counts: v.counts, ms: performance.now() - t0 }
    return { result, transfer: [s.inst, s.types.buffer] }
  },
  writeBlueprint(arg: { shapes: VShape[]; name: string; size: 'Large' | 'Small' }) {
    const v = voxelize(arg.shapes)
    if (v.total > MAX_EXPORT_BLOCKS) throw new Error(`Too many blocks to export (${v.total.toLocaleString('en-US')}). Hollow the shape or make it smaller.`)
    const result: WriteResult = { blob: writeSbc(v, arg.name, arg.size), total: v.total }
    return { result }
  },
  async scanSource(arg: ScanArg, emit) {
    const t0 = performance.now()
    const send = (text: string, frac: number | null) => emit('progress', { sourceId: arg.sourceId, text, frac })
    send('Building file index…', null)
    const root = treeFromFiles(arg.files)
    const result = await scanSource(root, { kind: arg.kind, sourceId: arg.sourceId, cache, progress: send })
    let persisted = true
    try {
      send('Saving snapshot…', null)
      const { seenMods, ...snap } = result
      const rec: SnapRec = { ...snap, entries: result.entries.map((e) => ({ ...e, file: null })) }
      await idbPut('snap', arg.sourceId, rec)
      await prune('mods', arg.sourceId, new Set(seenMods.map((m) => `${arg.sourceId}/${m}`)))
    } catch {
      persisted = false
    }
    const reply: ScanReply = { result, persisted, ms: performance.now() - t0 }
    return { result: reply }
  },

  async cacheBlueprints(arg: CacheArg, emit) {
    const t0 = performance.now()
    let cached = 0
    let reused = 0
    let failed = false
    try {
      await prune('bps', arg.sourceId, new Set(arg.items.map((i) => i.id)))
    } catch {
      failed = true
    }
    for (let i = 0; i < arg.items.length && !failed; i++) {
      const it = arg.items[i]
      emit('progress', { sourceId: arg.sourceId, text: `Caching blueprints ${i + 1}/${arg.items.length}`, frac: (i + 1) / arg.items.length })
      const fp = `${it.file.size}|${it.file.lastModified}`
      try {
        const have = await idbGet<BpRec>('bps', it.id)
        if (have && have.fp === fp && have.v === PARSE_VERSION) {
          reused++
          continue
        }
        const parsed = parseBlueprint(decodeBlueprint(await it.file.arrayBuffer()), it.name)
        await idbPut('bps', it.id, { fp, v: PARSE_VERSION, parsed } satisfies BpRec)
        cached++
      } catch (err) {
        if (err instanceof DOMException || (err as { name?: string })?.name === 'QuotaExceededError') failed = true
      }
    }
    const reply: CacheReply = { cached, reused, failed, ms: performance.now() - t0 }
    return { result: reply }
  },

  async parseBlueprint(arg: ParseArg) {
    const t0 = performance.now()
    const buf = arg.buffer ?? (await arg.file!.arrayBuffer())
    const t1 = performance.now()
    const text = decodeBlueprint(buf)
    const t2 = performance.now()
    const parsed = parseBlueprint(text, arg.name)
    const t3 = performance.now()
    const transfer: Transferable[] = []
    for (const g of parsed.grids) transfer.push(g.key.buffer, g.min.buffer, g.orient.buffer, g.hsv.buffer, g.world.buffer, ...(g.skin ? [g.skin.buffer] : []))
    const result: ParseResult = { parsed, ms: { read: t1 - t0, decode: t2 - t1, parse: t3 - t2 } }
    return { result, transfer }
  },
})
