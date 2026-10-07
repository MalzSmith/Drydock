import { fromTuples } from '../se/defs.ts'
import { actions, store, type ListEntry, type ModMeta, type Source, type SourceKind } from '../state/app.ts'
import { assetRpc, scanRpc } from '../workers/client.ts'
import type { CacheArg, CacheReply, ScanReply, SnapRec } from '../workers/work.worker.ts'
import { isRelevantFile } from './fs.ts'
import { assetKeys, isAssetFile } from '../assets/keys.ts'
import { assetFile, dropAssetFiles, setAssetFiles } from '../assets/files.ts'
import { idbAll, idbClear, idbDelete, idbGet, idbKeys, idbPut } from './idb.ts'
import type { ScanResult } from './scan.ts'
import type { SkyMeta } from '../assets/sky.ts'

const MOD_LABEL: Record<string, string> = { workshop: 'Workshop', torch: 'Torch', mods: 'Mods' }

const results = new Map<number, SnapRec>()
const progress = new Map<number, { text: string; frac: number | null }>()
let waiting = ''
let started = false

const num = (n: number) => n.toLocaleString('en-US')

function setStatus() {
  const p = [...progress.values()][0]
  if (p) store.set({ scanText: p.text, scanFrac: p.frac })
  else store.set({ scanText: waiting, scanFrac: null })
}

function publish() {
  const entries: ListEntry[] = []
  const game = []
  const skins = []
  const glass = []
  const mods: ModMeta[] = []
  for (const src of store.get().sources) {
    const r = results.get(src.id)
    if (!r) continue
    if (r.kind === 'game') {
      game.push(...fromTuples(r.defs, 'game'))
      skins.push(...(r.skins ?? []))
      glass.push(...(r.glass ?? []))
    }
    for (const e of r.entries)
      entries.push({
        id: e.id,
        name: e.name,
        large: e.large,
        size: e.size,
        mods: e.mods,
        blocks: e.blocks ?? null,
        list: r.kind === 'blueprints' ? 'local' : 'workshop',
        modified: e.modified,
        file: e.file,
      })
    for (const m of r.mods) mods.push({ key: m.key, name: m.name, label: MOD_LABEL[r.kind], folder: m.folder, subs: m.subs })
  }
  actions.setEntries(entries)
  return actions.setIndex(game, mods, skins, glass)
}

let thumbUrls: string[] = []

async function publishSkies() {
  const metas = await idbAll<SkyMeta>('skymeta').catch(() => [] as SkyMeta[])
  for (const u of thumbUrls) URL.revokeObjectURL(u)
  thumbUrls = metas.flatMap((m) => (m.thumb ? [URL.createObjectURL(m.thumb)] : []))
  let t = 0
  const skies = metas
    .map((m) => ({ id: 'sky:' + m.key, name: m.name, src: m.src, thumb: m.thumb ? thumbUrls[t++] : '', ready: !!assetFile(m.key) }))
    .filter((k) => k.ready || k.src === 'Vanilla')
  skies.sort((a, b) => Number(a.src !== 'Vanilla') - Number(b.src !== 'Vanilla') || a.name.localeCompare(b.name) || a.src.localeCompare(b.src))
  actions.setSkies(skies)
}

function listen() {
  if (started) return
  started = true
  const onProgress = (d: { sourceId: number; text: string; frac: number | null }) => {
    if (!progress.has(d.sourceId)) return
    progress.set(d.sourceId, { text: d.text, frac: d.frac })
    setStatus()
  }
  scanRpc().on('progress', onProgress)
  assetRpc().on('progress', onProgress)
}

type Picked = { files: File[]; assets: File[]; total: number; name: string }

function pick(): Promise<Picked | null> {
  return new Promise((ok) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.webkitdirectory = true
    el.multiple = true
    waiting = 'Waiting for browser to list files…'
    setStatus()
    const finish = (v: Picked | null) => {
      waiting = ''
      setStatus()
      ok(v)
    }
    el.addEventListener('change', () => {
      const list = Array.from(el.files ?? [])
      waiting = `Reading file list… ${num(list.length)} files`
      setStatus()
      const name = list[0]?.webkitRelativePath.split('/')[0] ?? ''
      finish({ files: list.filter((f) => isRelevantFile(f.name)), assets: list.filter((f) => isAssetFile(f.name)), total: list.length, name })
    })
    el.addEventListener('cancel', () => finish(null))
    el.click()
  })
}

async function persistSource(src: Source) {
  try {
    await idbPut('sources', undefined, src)
  } catch {
    actions.toast('Could not store the source list; it will be forgotten after this session.')
  }
}

async function scanOne(id: number, kind: SourceKind, name: string, files: File[], assets: File[], total: number) {
  progress.set(id, { text: `Reading file list… ${num(total)} files`, frac: null })
  setStatus()
  try {
    if (kind !== 'blueprints') {
      const keyed = assetKeys(kind, id, assets)
      setAssetFiles(id, new Map(keyed))
      await assetRpc().call<number>('registerAssets', { sourceId: id, keys: keyed.map((k) => k[0]) })
      actions.assetsChanged()
    }
    const rep = await scanRpc().call<ScanReply>('scanSource', { files, kind, sourceId: id })
    const res: ScanResult = rep.result
    results.set(id, res)
    const note = `${num(total)} files${res.entries.length ? ` · ${num(res.entries.length)} blueprints` : ''}${res.mods.length ? ` · ${num(res.mods.length)} mods` : ''} · ${(rep.ms / 1000).toFixed(1)} s`
    const src: Source = { id, name, kind, when: Date.now(), note }
    store.set((s) => ({ sources: s.sources.some((x) => x.id === id) ? s.sources.map((x) => (x.id === id ? src : x)) : [...s.sources, src] }))
    await persistSource(src)
    if (kind === 'game' && !res.found) actions.toast('Expected the SpaceEngineers (or its Content) folder — linked anyway')
    if (!rep.persisted) actions.toast('Could not store the snapshot (storage full?). It works for this session only.')
    await publish()
    void actions.fillMods()
    if (rep.persisted && res.entries.length) {
      const arg: CacheArg = { sourceId: id, items: res.entries.filter((e) => e.file).map((e) => ({ id: e.id, name: e.name, file: e.file! })) }
      const c = await scanRpc().call<CacheReply>('cacheBlueprints', arg)
      if (c.failed) actions.toast('Could not cache all blueprints (storage full?). Uncached ones need a refresh to open.')
      void actions.fillMods()
    }
    if (rep.persisted && kind !== 'blueprints') {
      await assetRpc().call<number>('indexSkies', { sourceId: id })
      await publishSkies()
      await assetRpc().call<number>('cacheModels', { sourceId: id })
    }
  } catch (err) {
    actions.toast(`Scan failed for ${name}: ` + (err instanceof Error ? err.message : String(err)))
  } finally {
    progress.delete(id)
    setStatus()
  }
}

export async function restoreSources() {
  listen()
  try {
    const sources = (await idbAll<Source>('sources')).sort((a, b) => a.id - b.id)
    for (const s of sources) {
      const snap = await idbGet<SnapRec>('snap', s.id)
      if (snap) results.set(s.id, snap)
    }
    store.set({ sources: sources.filter((s) => results.has(s.id)) })
    await publish()
    await publishSkies()
    void actions.fillMods()
    void idbClear('skies').catch(() => undefined)
  } catch {
    return
  }
}

export async function linkSource(kind: SourceKind, replaceId?: number) {
  listen()
  const picked = await pick()
  if (!picked) return
  if (!picked.total) {
    actions.toast('That folder is empty.')
    return
  }
  const sources = store.get().sources
  const old = replaceId !== undefined ? sources.find((s) => s.id === replaceId) : sources.find((s) => s.kind === kind && s.name === picked.name)
  await scanOne(old?.id ?? Date.now(), kind, picked.name, picked.files, picked.assets, picked.total)
}

export async function unlinkSource(id: number) {
  store.set((s) => ({ sources: s.sources.filter((x) => x.id !== id) }))
  results.delete(id)
  dropAssetFiles(id)
  void assetRpc()
    .call('dropAssets', { sourceId: id })
    .then(() => actions.assetsChanged())
  try {
    await idbDelete('sources', id)
    await idbDelete('snap', id)
    const prefix = `${id}/`
    for (const st of ['mods', 'bps'] as const) for (const k of await idbKeys(st)) if (typeof k === 'string' && k.startsWith(prefix)) await idbDelete(st, k)
    for (const st of ['meshes', 'textures', 'skymeta'] as const) for (const k of await idbKeys(st)) if (typeof k === 'string' && k.startsWith('m:' + prefix)) await idbDelete(st, k)
  } catch {
    actions.toast('Could not clear the stored snapshot.')
  }
  await publish()
  await publishSkies()
}
