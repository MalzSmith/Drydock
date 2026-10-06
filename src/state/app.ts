import { PARSE_VERSION, type ParsedBlueprint } from '../se/blueprint.ts'
import {
  buildLookup,
  fromTuples,
  loadVanilla,
  resolveBlueprint,
  type DefRecord,
  type DefTuple,
  type MissingMode,
  type RenderModel,
  type Resolved,
  type GlassDef,
  type GlassRecord,
  type SkinDef,
  type SkinRecord,
  type TableRow,
} from '../se/defs.ts'
import { identity } from '../se/orient.ts'
import { buildModIndex, pickMods, type ModIndex, type Picks } from '../se/mods.ts'
import { idbGet, idbPut } from '../sources/idb.ts'
import type { SourceKind } from '../sources/scan.ts'
import { COMP_BLOCKS } from '../compose/blocks.ts'
import { QUARTER, ROT_IDENTITY, rotMul, type VShape } from '../compose/csg.ts'
import { compositionJson, parseComposition } from '../compose/file.ts'
import { composeRpc, parseRpc } from '../workers/client.ts'
import type { ParseArg, ParseResult, VoxelizeResult, WriteResult } from '../workers/work.worker.ts'
import { estimateSbcBytes, formatBytes } from '../se/sbcWrite.ts'
import { download } from '../util/save.ts'
import { createStore } from './store.ts'

export type { SourceKind }
export type Source = { id: number; name: string; kind: SourceKind; when: number; note: string }
export type ShapeOp = 'add' | 'subtract' | 'intersect'
export type ShapeType = 'box' | 'sphere' | 'cylinder' | 'ellipsoid' | 'torus' | 'pyramid'
export const ROTATABLE: ShapeType[] = ['cylinder', 'torus', 'pyramid']
export type Shape = {
  id: number
  op: ShapeOp
  type: ShapeType
  size: [number, number, number]
  pos: [number, number, number]
  block: number
  shell: number
  tube: number
  rot: number[]
}
export type ListEntry = {
  id: string
  name: string
  large: boolean
  size: number
  mods: number | null
  list: 'local' | 'workshop'
  modified: number
  file: File | null
}
export type ModRow = { key: string; name: string; meta: string; enabled: boolean; missing: boolean }
export type Info = {
  name: string
  large: boolean
  dims: [number, number, number]
  lengthM: number
  blockCount: number
  rows: TableRow[]
  sbcBytes?: number
}

export type Tab = 'view' | 'section' | 'scene' | 'export'

export type SkyItem = { id: string; name: string; src: string; thumb: string }

export type Lighting = 'directional' | 'uniform'
export type RenderStyle = 'textured' | 'shaded' | 'clay' | 'line'

export type AssetStatus = { meshes: number; meshesDone: number; textures: number; texturesDone: number; uncachedMeshes: number; uncachedTextures: number }

export type AppState = {
  mode: 'blueprint' | 'compose'
  bp: string | null
  info: Info | null
  modelVersion: number
  composeInfo: Info | null
  composeVersion: number
  composeFrame: number
  composeBusy: boolean
  loading: boolean
  entries: ListEntry[]
  pinned: ListEntry | null
  modRows: ModRow[]
  unknownBlocks: Array<{ key: string; blocks: number }>
  missingOpen: boolean
  scanText: string
  scanFrac: number | null
  assetText: string
  assetFrac: number | null
  assetsVersion: number
  listSource: 'local' | 'workshop'
  search: string
  mods: Record<string, boolean>
  tab: Tab
  render: { mode: RenderStyle; proj: 'persp' | 'ortho'; edges: boolean; tintMods: boolean; missing: MissingMode; exposure: number }
  section: { on: boolean; axis: 0 | 1 | 2; pos: number; mode: 'cut' | 'slice'; flip: boolean; thick: number; capHi: boolean }
  scene: { bg: string; gradTop: string; gradBot: string; sun: number; lighting: Lighting }
  skies: SkyItem[]
  export: { res: number; aspect: string; fmt: 'PNG' | 'JPG' | 'WEBP'; transparent: boolean; ss: number; fileName: string }
  compose: { shapes: Shape[]; selShape: number | null; grid: 'Large' | 'Small'; name: string }
  sources: Source[]
  srcOpen: boolean
  toast: string
  busy: boolean
  spin: boolean
  preset: string
}

let shapeSeq = 10
export const nextShapeId = () => shapeSeq++

export function mkShape(type: ShapeType, o: Partial<Shape> = {}): Shape {
  return { id: shapeSeq++, op: 'add', type, size: [15, 15, 15], pos: [0, 0, 0], block: 1, shell: 0, tube: 5, rot: ROT_IDENTITY, ...o }
}

const defaultShapes = (): Shape[] => [
  mkShape('ellipsoid', { size: [25, 11, 61], shell: 2 }),
  mkShape('box', { size: [33, 3, 15], pos: [0, -2, 6], block: 2 }),
  mkShape('cylinder', { op: 'subtract', size: [5, 5, 70] }),
  mkShape('box', { op: 'subtract', size: [11, 3, 9], pos: [0, 2, -26] }),
  mkShape('sphere', { op: 'intersect', size: [61, 61, 61] }),
]

const shapes0 = defaultShapes()

export const store = createStore<AppState>({
  mode: 'blueprint',
  bp: null,
  info: null,
  modelVersion: 0,
  composeInfo: null,
  composeVersion: 0,
  composeFrame: 0,
  composeBusy: false,
  loading: false,
  entries: [],
  pinned: null,
  modRows: [],
  unknownBlocks: [],
  missingOpen: false,
  scanText: '',
  scanFrac: null,
  assetText: '',
  assetFrac: null,
  assetsVersion: 0,
  listSource: 'local',
  search: '',
  mods: {},
  tab: 'view',
  render: { mode: 'textured', proj: 'ortho', edges: true, tintMods: false, missing: 'placeholder', exposure: 0 },
  section: { on: false, axis: 0, pos: 0.5, mode: 'cut', flip: false, thick: 2, capHi: true },
  scene: { bg: 'sky-default', gradTop: '#d6ebff', gradBot: '#2c455d', sun: 40, lighting: 'directional' },
  skies: [],
  export: { res: 2160, aspect: '16:9', fmt: 'PNG', transparent: false, ss: 2, fileName: '{blueprint}_{view}_{date}' },
  compose: { shapes: shapes0, selShape: null, grid: 'Large', name: 'Drydock Hull' },
  sources: [],
  srcOpen: false,
  toast: '',
  busy: false,
  spin: false,
  preset: 'iso',
})

export function sectionCut(s: AppState['section']): { pos: number; flip: boolean } {
  const mirror = s.axis !== 1
  return { pos: mirror ? 1 - s.pos : s.pos, flip: s.flip !== mirror }
}

type Perf ={ read: number; decode: number; parse: number; resolve: number; firstFrame: number; total: number; blocks: number }

export const perf: { last: Perf | null; t0: number } = { last: null, t0: 0 }

export type ModMeta = { key: string; name: string; label: string; folder: string; subs: string[] }

type Current = {
  parsed: ParsedBlueprint
  entry: ListEntry | null
  picks: Picks | null
  picksVersion: number
  resolved: Resolved
}

let current: Current | null = null
let vanillaP: Promise<DefRecord[]> | null = null
let gameDefs: DefRecord[] = []
let gameSkins: SkinRecord[] = []
let gameGlass: GlassRecord[] = []
let modMeta: ModMeta[] = []
let modIndex: ModIndex = buildModIndex([])
let indexVersion = 0
let seq = 0
const modDefCache = new Map<string, { defs: DefRecord[]; skins: SkinRecord[]; glass: GlassRecord[] }>()

const getVanilla = () => (vanillaP ??= loadVanilla())

async function loadModDefs(key: string): Promise<{ defs: DefRecord[]; skins: SkinRecord[]; glass: GlassRecord[] }> {
  let d = modDefCache.get(key)
  if (!d) {
    const rec = await idbGet<{ defs: DefTuple[]; skins?: SkinDef[]; glass?: GlassDef[] }>('mods', key)
    d = { defs: rec ? fromTuples(rec.defs, key) : [], skins: (rec?.skins ?? []).map((x) => ({ ...x, source: key })), glass: (rec?.glass ?? []).map((x) => ({ ...x, source: key })) }
    modDefCache.set(key, d)
  }
  return d
}

function skinLookup(layers: SkinRecord[][]): (sub: string) => SkinRecord | undefined {
  const m = new Map<string, SkinRecord>()
  for (const l of layers) for (const sk of l) m.set(sk.sub.toLowerCase(), sk)
  return (sub) => m.get(sub.toLowerCase())
}

function glassMap(layers: GlassRecord[][]): Record<string, GlassRecord> {
  const m: Record<string, GlassRecord> = {}
  for (const l of layers) for (const g of l) m[g.sub.toLowerCase()] = g
  return m
}

export function indexStats() {
  return { game: gameDefs.length, mods: modMeta.length, subs: modIndex.bySub.size, version: indexVersion }
}

export function getModel(): RenderModel | null {
  return current ? current.resolved.model : null
}

let composeModel: RenderModel | null = null
let composeLookup: { defs: Array<{ large: DefRecord | undefined; small: DefRecord | undefined }> } | null = null

function composeDefs() {
  if (!composeLookup) {
    const l = buildLookup([gameDefs])
    composeLookup = { defs: COMP_BLOCKS.map((b) => ({ large: l.find('CubeBlock', b.large, true), small: b.small ? l.find('CubeBlock', b.small, false) : undefined })) }
  }
  return composeLookup.defs
}

export function getComposeModel(): RenderModel | null {
  return composeModel
}

export const composePerf: { lastMs: number; lastTotal: number; runs: number } = { lastMs: 0, lastTotal: 0, runs: 0 }

const vshapes = (shapes: Shape[]): VShape[] =>
  shapes.map((x) => ({
    op: x.op,
    type: x.type,
    size: [...x.size],
    pos: [...x.pos],
    block: x.block,
    shell: x.shell,
    ...(x.type === 'torus' ? { tube: x.tube } : {}),
    ...(ROTATABLE.includes(x.type) ? { rot: [...x.rot] } : {}),
  }))

function composeModelOf(r: VoxelizeResult, large: boolean, name: string): RenderModel {
  const cell = large ? 2.5 : 0.5
  const [X, Y, Z] = r.dims
  const table = composeDefs().map((d) => (large ? d.large : d.small))
  const defs: DefRecord[] = []
  const index = table.map((d) => (d ? defs.push(d) - 1 : -1))
  const def = new Int32Array(r.count)
  for (let i = 0; i < r.count; i++) def[i] = index[r.types[i]] ?? -1
  const hsv = new Float32Array(r.count * 3)
  for (let i = 0; i < r.count; i++) hsv[i * 3 + 1] = -1
  const detail = { def, orient: new Uint8Array(r.count).fill(4), hsv, skin: new Uint16Array(r.count) }
  return {
    name,
    gridLarge: large,
    dims: r.dims,
    lengthM: Z * cell,
    cellMin: [0, 0, 0],
    mainCell: cell,
    blockCount: r.total,
    boundsMin: [-0.5 * cell, -0.5 * cell, -0.5 * cell],
    boundsMax: [(X - 0.5) * cell, (Y - 0.5) * cell, (Z - 0.5) * cell],
    grids: r.count ? [{ cell, toMain: identity(), inst: r.inst, count: r.count, detail }] : [],
    defs,
    skins: [],
    glass: glassMap([gameGlass]),
  }
}

let voxInflight = false
let frameNext = false
let voxPending = false

async function voxelizeLatest() {
  if (voxInflight) {
    voxPending = true
    return
  }
  voxInflight = true
  store.set({ composeBusy: true })
  try {
    do {
      voxPending = false
      const s = store.get()
      const sel = s.compose.shapes.findIndex((x) => x.id === s.compose.selShape)
      const r = await composeRpc().call<VoxelizeResult>('voxelize', { shapes: vshapes(s.compose.shapes), sel, cut: s.section.on ? { axis: s.section.axis, mode: s.section.mode, thick: s.section.thick, ...sectionCut(s.section) } : null })
      if (voxPending) continue
      const now = store.get()
      const large = now.compose.grid === 'Large'
      composeModel = composeModelOf(r, large, now.compose.name)
      composePerf.lastMs = r.ms
      composePerf.lastTotal = r.total
      composePerf.runs++
      const rows: TableRow[] = r.counts
        .map((qty, i) => ({ name: COMP_BLOCKS[i].name, source: 'Vanilla', qty, missing: false, modded: false }))
        .filter((x) => x.qty > 0)
        .sort((a, b) => b.qty - a.qty)
      const info: Info = { name: now.compose.name, large, dims: r.dims, lengthM: composeModel.lengthM, blockCount: r.total, rows, sbcBytes: estimateSbcBytes(r.counts, r.dims, now.compose.name.trim() || 'Drydock Hull', now.compose.grid) }
      const frame = frameNext ? 1 : 0
      frameNext = false
      store.set((st) => ({ composeInfo: info, composeVersion: st.composeVersion + 1, composeFrame: st.composeFrame + frame }))
    } while (voxPending)
  } catch (err) {
    actions.toast('Compose failed: ' + (err instanceof Error ? err.message : String(err)))
  } finally {
    voxInflight = false
    store.set({ composeBusy: false })
  }
}

export const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`

export function formatSize(b: number): string {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}

export function entryMeta(e: ListEntry): string {
  const grid = `${e.large ? 'Large' : 'Small'} grid`
  if (e.mods === null) return grid
  return `${grid} · ${e.mods === 0 ? 'vanilla' : plural(e.mods, 'mod')}`
}

let fillRun = 0

async function fillEntryMods() {
  const run = ++fillRun
  const todo = store.get().entries.filter((e) => e.mods === null)
  if (!todo.length) return
  const vanilla = await getVanilla()
  const base = buildLookup([vanilla, gameDefs])
  const version = indexVersion
  const found = new Map<string, number>()
  const flush = () => {
    if (!found.size) return
    const got = new Map(found)
    found.clear()
    store.set((s) => ({ entries: s.entries.map((x) => (got.has(x.id) && x.mods === null ? { ...x, mods: got.get(x.id)! } : x)) }))
  }
  for (const e of todo) {
    if (run !== fillRun || version !== indexVersion) break
    try {
      const rec = await idbGet<{ fp: string; parsed: ParsedBlueprint }>('bps', e.id)
      if (!rec || rec.fp !== `${e.size}|${e.modified}`) continue
      const n = pickMods(rec.parsed, base, modIndex).picked.length
      found.set(e.id, n)
      void idbPut('bpmeta', `${e.id}|${e.modified}`, n).catch(() => undefined)
    } catch {
      continue
    }
    if (found.size >= 8) {
      flush()
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  flush()
}

let toastTimer = 0
let uncachedToast: string | null = null

async function resolveCurrent() {
  const c = current
  if (!c) return
  const my = ++seq
  const t0 = performance.now()
  const vanilla = await getVanilla()
  const base = buildLookup([vanilla, gameDefs])
  if (c.picksVersion !== indexVersion || !c.picks) {
    c.picks = pickMods(c.parsed, base, modIndex)
    c.picksVersion = indexVersion
  }
  const picks = c.picks
  const toggles = store.get().mods
  const pos = new Map(modMeta.map((m, i) => [m.key, i]))
  const enabled = picks.picked.filter((p) => toggles[p.key] !== false).sort((a, b) => (pos.get(a.key) ?? 0) - (pos.get(b.key) ?? 0))
  const layers = await Promise.all(enabled.map((p) => loadModDefs(p.key)))
  if (my !== seq) return
  const labels = new Map(modMeta.map((m) => [m.key, m.name]))
  const resolved = resolveBlueprint(
    c.parsed,
    buildLookup([vanilla, gameDefs, ...layers.map((l) => l.defs)]),
    store.get().render.missing,
    labels,
    skinLookup([gameSkins, ...layers.map((l) => l.skins)]),
  )
  resolved.model.glass = glassMap([gameGlass, ...layers.map((l) => l.glass)])
  c.resolved = resolved
  const meta = new Map(modMeta.map((m) => [m.key, m]))
  const rows: ModRow[] = picks.picked.map((p) => {
    const m = meta.get(p.key)
    return {
      key: p.key,
      name: m?.name ?? p.key,
      meta: `${m?.label ?? 'Mod'} ${m?.folder ?? ''} · ${plural(p.blocks, 'block')}`,
      enabled: toggles[p.key] !== false,
      missing: false,
    }
  })
  if (picks.uncoveredBlocks > 0)
    rows.push({
      key: 'unresolved',
      name: 'Unresolved blocks',
      meta: `${plural(picks.uncoveredTypes, 'block type')} · ${plural(picks.uncoveredBlocks, 'block')}`,
      enabled: false,
      missing: true,
    })
  const m = resolved.model
  const info: Info = { name: m.name, large: m.gridLarge, dims: m.dims, lengthM: m.lengthM, blockCount: m.blockCount, rows: resolved.rows }
  if (perf.last) perf.last.resolve = performance.now() - t0
  const e = c.entry
  const pin = store.get().pinned
  if (!e && pin && pin.mods !== picks.picked.length) store.set({ pinned: { ...pin, mods: picks.picked.length } })
  if (e && e.mods !== picks.picked.length) {
    const updated = { ...e, mods: picks.picked.length }
    c.entry = updated
    idbPut('bpmeta', `${e.id}|${e.modified}`, picks.picked.length)
    store.set((s) => ({ entries: s.entries.map((x) => (x.id === e.id ? updated : x)) }))
  }
  store.set((s) => ({ info, modRows: rows, unknownBlocks: picks.uncovered, missingOpen: s.missingOpen && picks.uncovered.length > 0, modelVersion: s.modelVersion + 1 }))
}

export const actions = {
  toast(text: string) {
    store.set({ toast: text })
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => store.set({ toast: '' }), 3200)
  },

  setTab: (tab: Tab) => store.set({ tab }),
  setRender: (p: Partial<AppState['render']>) => store.set((s) => ({ render: { ...s.render, ...p } })),
  setSection: (p: Partial<AppState['section']>) => store.set((s) => ({ section: { ...s.section, ...p } })),
  setScene: (p: Partial<AppState['scene']>) => store.set((s) => ({ scene: { ...s.scene, ...p } })),
  setSkies: (skies: SkyItem[]) =>
    store.set((s) => ({ skies, scene: s.scene.bg.startsWith('sky:') && !skies.some((k) => k.id === s.scene.bg) ? { ...s.scene, bg: 'sky-default' } : s.scene })),
  setExport: (p: Partial<AppState['export']>) => store.set((s) => ({ export: { ...s.export, ...p } })),
  setCompose: (p: Partial<AppState['compose']>) => store.set((s) => ({ compose: { ...s.compose, ...p } })),
  setAssets(c: AssetStatus) {
    const busy = c.meshesDone < c.meshes || c.texturesDone < c.textures
    const text = !busy
      ? ''
      : c.meshesDone < c.meshes
        ? `Loading models ${c.meshesDone.toLocaleString('en-US')}/${c.meshes.toLocaleString('en-US')}`
        : `Loading textures ${c.texturesDone.toLocaleString('en-US')}/${c.textures.toLocaleString('en-US')}`
    const frac = !busy ? null : c.meshesDone < c.meshes ? c.meshesDone / c.meshes : c.texturesDone / c.textures
    store.set({ assetText: text, assetFrac: frac })
    const s = store.get()
    const id = s.mode === 'compose' ? 'compose' : s.bp
    if (!busy && (c.uncachedMeshes || c.uncachedTextures) && id && uncachedToast !== id) {
      uncachedToast = id
      const parts = [c.uncachedTextures ? `Textures missing: ${plural(c.uncachedTextures, 'texture')}` : '', c.uncachedMeshes ? plural(c.uncachedMeshes, 'model') : ''].filter(Boolean)
      actions.toast(`${parts.join(' · ')} not cached · link the game folder again to load them`)
    }
  },
  assetsChanged: () => store.set((s) => ({ assetsVersion: s.assetsVersion + 1 })),
  setListSource: (listSource: AppState['listSource']) => store.set({ listSource }),
  setSearch: (search: string) => store.set({ search }),
  setSpin: (spin: boolean) => store.set({ spin }),
  setPreset: (preset: string) => store.set({ preset, spin: false }),
  openSources: () => store.set({ srcOpen: true }),
  closeSources: () => store.set({ srcOpen: false }),
  openMissing: () => store.set({ missingOpen: true }),
  closeMissing: () => store.set({ missingOpen: false }),

  setMode(mode: AppState['mode']) {
    store.set((s) => ({ mode, section: { ...s.section, pos: 0.5 } }))
  },

  toggleSection() {
    store.set((s) => ({ section: { ...s.section, on: !s.section.on }, tab: 'section' }))
  },

  stepSection(dir: number) {
    const s = store.get()
    const n = (s.mode === 'compose' ? s.composeInfo : s.info)?.dims[s.section.axis] ?? 1
    const pos = Math.min(1, Math.max(0, (Math.round(s.section.pos * n) + dir) / n))
    actions.setSection({ pos })
  },

  toggleMod(key: string) {
    store.set((s) => ({ mods: { ...s.mods, [key]: s.mods[key] === false } }))
  },

  updateShape(id: number, patch: Partial<Shape>) {
    store.set((s) => ({
      mode: 'compose',
      compose: { ...s.compose, shapes: s.compose.shapes.map((x) => (x.id === id ? { ...x, ...patch } : x)) },
    }))
  },

  moveShape(id: number, d: number) {
    store.set((s) => {
      const a = [...s.compose.shapes]
      const i = a.findIndex((x) => x.id === id)
      const j = i + d
      if (j < 0 || j >= a.length) return {}
      ;[a[i], a[j]] = [a[j], a[i]]
      return { mode: 'compose', compose: { ...s.compose, shapes: a } }
    })
  },

  dupShape(id: number) {
    store.set((s) => {
      const a = [...s.compose.shapes]
      const j = a.findIndex((x) => x.id === id)
      const c = { ...a[j], size: [...a[j].size] as Shape['size'], pos: [...a[j].pos] as Shape['pos'], id: nextShapeId() }
      a.splice(j + 1, 0, c)
      return { mode: 'compose', compose: { ...s.compose, shapes: a, selShape: c.id } }
    })
  },

  deleteShape(id: number) {
    store.set((s) => ({ mode: 'compose', compose: { ...s.compose, shapes: s.compose.shapes.filter((x) => x.id !== id), selShape: null } }))
  },

  addShape(type: ShapeType) {
    const n = mkShape(type, { size: type === 'cylinder' ? [9, 9, 21] : type === 'torus' ? [25, 5, 25] : [11, 11, 11] })
    store.set((s) => ({ mode: 'compose', compose: { ...s.compose, shapes: [...s.compose.shapes, n], selShape: n.id } }))
  },

  rotateShape(id: number, axis: 'x' | 'y' | 'z' | null) {
    const sp = store.get().compose.shapes.find((x) => x.id === id)
    if (sp) actions.updateShape(id, { rot: axis ? rotMul(QUARTER[axis], sp.rot) : ROT_IDENTITY })
  },

  selectShape(id: number | null) {
    store.set((s) => ({ compose: { ...s.compose, selShape: id } }))
  },

  setEntries(entries: ListEntry[]) {
    store.set({ entries })
  },

  setIndex(game: DefRecord[], mods: ModMeta[], skins: SkinDef[] = [], glass: GlassDef[] = []) {
    gameDefs = game
    gameSkins = skins.map((x) => ({ ...x, source: 'game' }))
    gameGlass = glass.map((x) => ({ ...x, source: 'game' }))
    composeLookup = null
    if (composeModel) void voxelizeLatest()
    modMeta = mods
    modIndex = buildModIndex(mods)
    indexVersion++
    return resolveCurrent()
  },

  fillMods() {
    return fillEntryMods()
  },

  async openEntry(e: ListEntry) {
    try {
      const rec = await idbGet<{ fp: string; v?: number; parsed: ParsedBlueprint }>('bps', e.id).catch(() => undefined)
      if (rec && rec.fp === `${e.size}|${e.modified}` && (rec.v === PARSE_VERSION || !e.file)) {
        await actions.loadBlueprint({ name: e.name }, e, rec.parsed)
        return
      }
      if (!e.file) {
        actions.toast('This blueprint is not in the snapshot yet. Refresh the source to read it.')
        return
      }
      await actions.loadBlueprint({ file: e.file, name: e.name }, e)
    } catch (err) {
      actions.toast('Could not open blueprint: ' + (err instanceof Error ? err.message : String(err)))
    }
  },

  async loadBlueprint(arg: ParseArg, entry: ListEntry | null = null, cached: ParsedBlueprint | null = null) {
    const t0 = performance.now()
    perf.t0 = t0
    store.set({ loading: true })
    try {
      const bytes = arg.file?.size ?? arg.buffer?.byteLength ?? 0
      const transfer = arg.buffer ? [arg.buffer] : []
      const res: ParseResult = cached
        ? { parsed: cached, ms: { read: 0, decode: 0, parse: 0 } }
        : await parseRpc().call<ParseResult>('parseBlueprint', arg, transfer)
      current = { parsed: res.parsed, entry, picks: null, picksVersion: -1, resolved: { model: emptyModel(), rows: [] } }
      perf.last = { ...res.ms, resolve: 0, firstFrame: 0, total: 0, blocks: res.parsed.grids.reduce((n, g) => n + g.key.length, 0) }
      const pinned: ListEntry | null = entry
        ? null
        : { id: 'open:' + arg.name, name: res.parsed.name || arg.name, large: res.parsed.grids[0]?.large ?? true, size: bytes, mods: null, list: 'local', modified: 0, file: null }
      store.set((s) => ({ bp: entry ? entry.id : pinned!.id, pinned, loading: false, section: { ...s.section, pos: 0.5 } }))
      await resolveCurrent()
    } catch (err) {
      store.set({ loading: false })
      actions.toast('Could not read blueprint: ' + (err instanceof Error ? err.message : String(err)))
    }
  },

  rebuild() {
    return resolveCurrent()
  },

  async exportBlueprint() {
    const s = store.get()
    const name = s.compose.name.trim() || 'Drydock Hull'
    let res: WriteResult
    try {
      res = await composeRpc().call<WriteResult>('writeBlueprint', { shapes: vshapes(s.compose.shapes), name, size: s.compose.grid })
    } catch (err) {
      actions.toast(err instanceof Error ? err.message : String(err))
      return
    }
    const count = res.total.toLocaleString('en-US')
    download(res.blob, 'bp.sbc')
    actions.toast(`Downloaded bp.sbc · ${count} blocks · ${formatBytes(res.blob.size)}`)
  },

  exportComposition() {
    const c = store.get().compose
    const name = c.name.trim() || 'Drydock Hull'
    const file = `${name.replace(/[\\/:*?"<>|]+/g, '_')}.json`
    download(new Blob([compositionJson(c)], { type: 'application/json' }), file)
    actions.toast(`Downloaded ${file} · ${plural(c.shapes.length, 'shape')}`)
  },

  async importComposition(f: File) {
    try {
      const c = parseComposition(await f.text())
      const shapes = c.shapes.map((x) => ({ ...x, id: nextShapeId() }))
      frameNext = true
      store.set((s) => ({ mode: 'compose', compose: { ...s.compose, shapes, grid: c.grid, name: c.name || s.compose.name, selShape: null } }))
      actions.toast(`Opened ${f.name} · ${plural(shapes.length, 'shape')}`)
    } catch (err) {
      actions.toast(`Could not open ${f.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
}

function emptyModel(): RenderModel {
  return { name: '', gridLarge: true, dims: [0, 0, 0], lengthM: 0, cellMin: [0, 0, 0], mainCell: 2.5, blockCount: 0, boundsMin: [0, 0, 0], boundsMax: [0, 0, 0], grids: [] }
}

store.watch(
  (s) => s.render.missing,
  (v, prev) => {
    if (v !== prev) actions.rebuild()
  },
)

store.watch(
  (s) => s.mods,
  (v, prev) => {
    if (v !== prev) actions.rebuild()
  },
)

store.watch(
  (s) => [s.mode === 'compose', s.compose.shapes, s.compose.selShape, s.compose.grid, s.section.on, s.section.axis, s.section.pos, s.section.mode, s.section.flip, s.section.thick] as const,
  ([on]) => {
    if (on) void voxelizeLatest()
  },
  (a, b) => a.every((v, i) => v === b[i]),
)
