import { notePilot, type ParsedBlueprint } from './blueprint.ts'
import { paintRgb24 } from './color.ts'
import { BASE6_VEC, createWorld, identity, invertRigid, mul, rotatedExtent, transformPoint } from './orient.ts'
import { child, descendants, parseXml, type XEl } from './xml.ts'

export type SideDef = [model: string, patW: number, patH: number, scaleU: number, scaleV: number]

export type RenderDef = { model?: string; offset?: [number, number, number]; topo?: number; sides?: SideDef[] }

export type DefRecord = {
  type: string
  subtype: string
  large: boolean
  size: [number, number, number]
  name: string
  source: string
  render?: RenderDef
}

export type SkinTex = { cm?: string; ng?: string; add?: string; am?: string }

export type SkinDef = { sub: string; metalColorable: boolean; hsv?: [number, number, number]; changes: Record<string, SkinTex> }

export type SkinRecord = SkinDef & { source: string }

export type GlassDef = {
  sub: string
  tex?: string
  gloss?: string
  color: [number, number, number, number]
  add: [number, number, number, number]
  reflectivity: number
  fresnel: number
  glossAdd: number
  light: number
}

export type GlassRecord = GlassDef & { source: string }

export type Lookup = { find(type: string, subtype: string, large: boolean): DefRecord | undefined }

export type MissingMode = 'placeholder' | 'substitute' | 'hide'

export type TableRow = { name: string; source: string; qty: number; missing: boolean; modded: boolean }

export type GridDetail = { def: Int32Array; orient: Uint8Array; hsv: Float32Array; skin: Uint16Array }

export type ModelGrid = { cell: number; toMain: Float32Array; inst: ArrayBuffer; count: number; detail?: GridDetail }

export type RenderModel = {
  name: string
  gridLarge: boolean
  dims: [number, number, number]
  lengthM: number
  cellMin: [number, number, number]
  mainCell: number
  blockCount: number
  boundsMin: [number, number, number]
  boundsMax: [number, number, number]
  grids: ModelGrid[]
  defs?: DefRecord[]
  skins?: Array<SkinRecord | null>
  glass?: Record<string, GlassRecord>
}

export type Resolved = {
  model: RenderModel
  rows: TableRow[]
}

export type DefTuple = [string, string, number, number, number, number, string, RenderDef?]

export function toTuple(d: DefRecord): DefTuple {
  const t: DefTuple = [d.type, d.subtype, d.large ? 1 : 0, d.size[0], d.size[1], d.size[2], d.name]
  if (d.render) t.push(d.render)
  return t
}

export function fromTuples(list: DefTuple[], source: string): DefRecord[] {
  return list.map(([type, subtype, large, sx, sy, sz, name, render]) => ({ type, subtype, large: large === 1, size: [sx, sy, sz], name, source, render }))
}

export const TOPOLOGIES = [
  'Box', 'Slope', 'Corner', 'InvCorner', 'StandaloneBox', 'RoundedSlope', 'RoundSlope', 'RoundCorner', 'RoundInvCorner', 'RotatedSlope',
  'RotatedCorner', 'Slope2Base', 'Slope2Tip', 'Corner2Base', 'Corner2Tip', 'InvCorner2Base', 'InvCorner2Tip', 'HalfBox', 'HalfSlopeBox',
  'HalfSlopeInverted', 'HalfSlopeCorner', 'HalfSlopeCornerInverted', 'SlopedCornerTip', 'SlopedCornerBase', 'SlopedCorner',
  'HalfSlopedCornerBase', 'HalfCorner', 'CornerSquare', 'CornerSquareInverted', 'HalfSlopedCorner', 'RaisedSlopedCorner',
  'SlopeTransition', 'SlopeTransitionBase', 'SlopeTransitionBaseMirrored', 'SlopeTransitionMirrored', 'SlopeTransitionTip',
  'SlopeTransitionTipMirrored', 'SquareSlopedCornerBase', 'SquareSlopedCornerTip', 'SquareSlopedCornerTipInv',
]

export const TOPO_BOX = 0
export const TOPO_SLOPE2BASE = 11
export const TOPO_SLOPE2TIP = 12

export function normPath(p: string): string {
  return p.trim().replace(/[\\/]+/g, '/').replace(/^\//, '').toLowerCase()
}

const int = (v: string | undefined, d: number) => {
  const n = v === undefined ? NaN : parseInt(v, 10)
  return Number.isFinite(n) ? n : d
}

function renderDef(el: XEl): RenderDef | undefined {
  const r: RenderDef = {}
  const model = child(el, 'Model')?.text?.trim()
  if (model) r.model = normPath(model)
  const off = vecOf(child(el, 'ModelOffset'))
  if (off && (off[0] || off[1] || off[2])) r.offset = off
  const topology = child(el, 'BlockTopology')?.text?.trim() ?? 'TriangleMesh'
  const cube = child(el, 'CubeDefinition')
  if (cube && (topology === 'Cube' || !r.model)) {
    const t = TOPOLOGIES.indexOf(child(cube, 'CubeTopology')?.text?.trim() ?? '')
    if (t >= 0) {
      r.topo = t
      const sides = child(cube, 'Sides')
      if (sides)
        r.sides = sides.children
          .filter((x) => x.name === 'Side')
          .map((x): SideDef => [normPath(x.attrs['Model'] ?? ''), int(x.attrs['PatternWidth'], 1), int(x.attrs['PatternHeight'], 1), int(x.attrs['ScaleTileU'], 1), int(x.attrs['ScaleTileV'], 1)])
    }
  }
  return r.model !== undefined || r.topo !== undefined ? r : undefined
}

export function colorToHsvDx11(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let hue = 0
  if (max !== min) {
    const d = max - min
    if (max === r) hue = 60 * ((g - b) / d)
    else if (max === g) hue = 60 * ((b - r) / d + 2)
    else hue = 60 * ((r - g) / d + 4)
    if (hue < 0) hue += 360
  }
  return [hue / 360, max === 0 ? -1 : 1 - (2 * min) / max, -1 + (2 * max) / 255]
}

export function parseSkins(text: string): SkinDef[] {
  const out: SkinDef[] = []
  if (!text.includes('<AssetModifier')) return out
  for (const el of descendants(parseXml(text), 'AssetModifier')) {
    const id = child(el, 'Id')
    const sub = (id?.attrs['Subtype'] ?? (id ? child(id, 'SubtypeId')?.text : undefined))?.trim()
    if (!sub) continue
    const skin: SkinDef = { sub, metalColorable: child(el, 'MetalnessColorable')?.text?.trim() === 'true', changes: {} }
    const color = child(el, 'DefaultColor')
    if (color) {
      const c = (n: string) => int(child(color, n)?.text ?? color.attrs[n], 0)
      skin.hsv = colorToHsvDx11(c('R'), c('G'), c('B'))
    }
    const textures = child(el, 'Textures')
    if (textures)
      for (const t of textures.children) {
        if (t.name !== 'Texture') continue
        const loc = t.attrs['Location']
        const file = t.attrs['Filepath']
        if (!loc || !file) continue
        const ch = (skin.changes[loc] ??= {})
        const f = normPath(file)
        switch (t.attrs['Type']) {
          case 'ColorMetal': ch.cm = f; break
          case 'NormalGloss': ch.ng = f; break
          case 'Extensions': ch.add = f; break
          case 'Alphamask': ch.am = f; break
        }
      }
    out.push(skin)
  }
  return out
}

function vec4Of(el: XEl | undefined, d: number): [number, number, number, number] {
  const g = (n: string) => {
    const v = el ? (child(el, n)?.text ?? el.attrs[n]) : undefined
    const f = v === undefined ? NaN : parseFloat(v)
    return Number.isFinite(f) ? f : d
  }
  return [g('X'), g('Y'), g('Z'), g('W')]
}

export function parseGlass(text: string): GlassDef[] {
  const out: GlassDef[] = []
  if (!text.includes('<TransparentMaterial')) return out
  for (const el of descendants(parseXml(text), 'TransparentMaterial')) {
    const id = child(el, 'Id')
    const sub = (id?.attrs['Subtype'] ?? (id ? child(id, 'SubtypeId')?.text : undefined))?.trim()
    if (!sub) continue
    const num = (n: string) => {
      const f = parseFloat(child(el, n)?.text ?? '')
      return Number.isFinite(f) ? f : 0
    }
    const tex = child(el, 'Texture')?.text?.trim()
    const gloss = child(el, 'GlossTexture')?.text?.trim()
    const g: GlassDef = {
      sub,
      color: vec4Of(child(el, 'Color'), 1),
      add: vec4Of(child(el, 'ColorAdd'), 0),
      reflectivity: num('Reflectivity'),
      fresnel: num('Fresnel'),
      glossAdd: num('GlossTextureAdd'),
      light: vec4Of(child(el, 'LightMultiplier'), 1)[0],
    }
    if (tex) g.tex = normPath(tex)
    if (gloss) g.gloss = normPath(gloss)
    out.push(g)
  }
  return out
}

export function parseResx(text: string): Map<string, string> {
  const names = new Map<string, string>()
  for (const m of text.matchAll(/<data name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g))
    names.set(m[1], m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
  return names
}

export const FLAG_PLACEHOLDER = 1
export const FLAG_MODDED = 2
export const FLAG_HIDDEN = 4
export const FLAG_SHRINK = 8
export const FLAG_SELECTED = 16

function strip(t: string): string {
  return t.startsWith('MyObjectBuilder_') ? t.slice(16) : t
}

function vecOf(el: XEl | undefined): [number, number, number] | undefined {
  if (!el) return undefined
  const g = (a: string) => {
    const v = el.attrs[a] ?? child(el, a.toUpperCase())?.text
    return v === undefined ? 0 : parseFloat(v) || 0
  }
  return [g('x'), g('y'), g('z')]
}

export function parseDefinitions(text: string, source: string, names?: Map<string, string>): DefRecord[] {
  const out: DefRecord[] = []
  if (!text.includes('<CubeBlocks')) return out
  const root = parseXml(text)
  for (const cb of descendants(root, 'CubeBlocks'))
    for (const el of cb.children) {
      if (el.name !== 'Definition') continue
      const id = child(el, 'Id')
      if (!id) continue
      const type = id.attrs['Type'] ?? child(id, 'TypeId')?.text
      if (!type) continue
      const subtype = (id.attrs['Subtype'] ?? child(id, 'SubtypeId')?.text ?? '').trim()
      const sz = vecOf(child(el, 'Size'))
      const size: [number, number, number] = sz
        ? [Math.max(1, sz[0] | 0), Math.max(1, sz[1] | 0), Math.max(1, sz[2] | 0)]
        : [1, 1, 1]
      let name = child(el, 'DisplayName')?.text ?? ''
      if (names && names.has(name)) name = names.get(name)!
      if (!name || name.startsWith('DisplayName_')) name = subtype
      const d: DefRecord = {
        type: strip(type.trim()),
        subtype,
        large: (child(el, 'CubeSize')?.text ?? 'Large').trim() !== 'Small',
        size,
        name,
        source,
      }
      const r = renderDef(el)
      if (r) d.render = r
      out.push(d)
    }
  return out
}

export function buildLookup(layers: DefRecord[][]): Lookup {
  const exact = new Map<string, DefRecord>()
  const bySub = new Map<string, DefRecord[]>()
  for (const layer of layers)
    for (const d of layer) {
      exact.set((d.type + '/' + d.subtype).toLowerCase(), d)
      const k = d.subtype.toLowerCase()
      const l = bySub.get(k)
      if (l) l.unshift(d)
      else bySub.set(k, [d])
    }
  return {
    find(type, subtype, large) {
      const d = exact.get((type + '/' + subtype).toLowerCase())
      if (d) return d
      if (!subtype) return undefined
      const l = bySub.get(subtype.toLowerCase())
      return l ? (l.find((x) => x.large === large) ?? l[0]) : undefined
    },
  }
}

type VanillaFile = { v: number; blocks: Array<[string, string, number, number, number, number, string]> }

export async function loadVanilla(): Promise<DefRecord[]> {
  const mod = (await import('../data/vanilla-blocks.json')) as unknown as { default: VanillaFile }
  return fromTuples(mod.default.blocks, 'vanilla')
}

export function pilotBlock(parsed: ParsedBlueprint): number {
  const g = parsed.grids[0]
  if (!g) return -1
  let p = g.pilot
  if (!p) {
    p = new Int32Array(4).fill(-1)
    for (let i = 0; i < g.key.length; i++) {
      const s = parsed.strings[g.key[i]]
      const at = s.indexOf('/')
      notePilot(p, i, s.slice(0, at), s.slice(at + 1), false)
    }
  }
  for (const i of p) if (i >= 0) return i
  return -1
}

export function pilotFrame(parsed: ParsedBlueprint): Float32Array {
  const i = pilotBlock(parsed)
  if (i < 0) return identity()
  const o = parsed.grids[0].orient[i]
  const f = Math.floor(o / 6)
  const u = o % 6
  const F = BASE6_VEC[f]
  const U = BASE6_VEC[u]
  if (Math.abs(F[0] * U[0] + F[1] * U[1] + F[2] * U[2]) > 0.5) return identity()
  return invertRigid(createWorld([0, 0, 0], F, U))
}

const CELL_LARGE = 2.5
const CELL_SMALL = 0.5

export function resolveBlueprint(
  parsed: ParsedBlueprint,
  lookup: Lookup,
  missing: MissingMode,
  labels: Map<string, string> = new Map(),
  skinOf: (sub: string) => SkinRecord | undefined = () => undefined,
): Resolved {
  const defList: DefRecord[] = []
  const defIndex = new Map<DefRecord, number>()
  const counts = new Map<number, number>()
  const defCache = new Map<number, DefRecord | null>()
  const grids: ModelGrid[] = []
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const typeParts = parsed.strings.map((s) => {
    const i = s.indexOf('/')
    return [s.slice(0, i), s.slice(i + 1)] as const
  })
  const mainInv = parsed.grids.length ? invertRigid(parsed.grids[0].world) : identity()
  const reorient = pilotFrame(parsed)
  const ext = new Int32Array(3)
  let mainDims: [number, number, number] = [0, 0, 0]
  let mainMin: [number, number, number] = [0, 0, 0]
  let mainCell = CELL_LARGE
  let blockCount = 0

  parsed.grids.forEach((g, gi) => {
    const n = g.key.length
    blockCount += n
    const cell = g.large ? CELL_LARGE : CELL_SMALL
    const toMain = mul(gi === 0 ? identity() : mul(g.world, mainInv), reorient)
    const buf = new ArrayBuffer(n * 32)
    const f32 = new Float32Array(buf)
    const dDef = new Int32Array(n)
    const dOrient = new Uint8Array(n)
    const dHsv = new Float32Array(n * 3)
    const dSkin = new Uint16Array(n)
    const cacheBase = g.large ? 0 : 1
    let w = 0
    let cmin = [Infinity, Infinity, Infinity]
    let cmax = [-Infinity, -Infinity, -Infinity]
    let lastH = NaN, lastS = NaN, lastV = NaN, lastColor = 0
    for (let i = 0; i < n; i++) {
      const k = g.key[i]
      const ck = k * 2 + cacheBase
      let def = defCache.get(ck)
      if (def === undefined) {
        const [t, s] = typeParts[k]
        def = lookup.find(t, s, g.large) ?? null
        defCache.set(ck, def)
      }
      counts.set(ck, (counts.get(ck) ?? 0) + 1)
      let flags = 0
      let sx = 1, sy = 1, sz = 1
      if (def) {
        rotatedExtent(def.size[0], def.size[1], def.size[2], g.orient[i], ext)
        sx = ext[0]; sy = ext[1]; sz = ext[2]
        if (def.source !== 'vanilla' && def.source !== 'game') flags |= FLAG_MODDED
      } else {
        if (missing === 'hide') continue
        if (missing === 'placeholder') flags |= FLAG_PLACEHOLDER
      }
      const h = g.hsv[i * 3], s = g.hsv[i * 3 + 1], v = g.hsv[i * 3 + 2]
      if (h !== lastH || s !== lastS || v !== lastV) {
        lastColor = paintRgb24(h, s, v)
        lastH = h; lastS = s; lastV = v
      }
      const mx = g.min[i * 3], my = g.min[i * 3 + 1], mz = g.min[i * 3 + 2]
      const o = w * 8
      f32[o] = mx; f32[o + 1] = my; f32[o + 2] = mz
      f32[o + 3] = sx; f32[o + 4] = sy; f32[o + 5] = sz
      f32[o + 6] = lastColor
      f32[o + 7] = flags
      let di = -1
      if (def) {
        di = defIndex.get(def) ?? -1
        if (di < 0) {
          di = defList.length
          defList.push(def)
          defIndex.set(def, di)
        }
      }
      dDef[w] = di
      dOrient[w] = g.orient[i]
      dHsv[w * 3] = h
      dHsv[w * 3 + 1] = s
      dHsv[w * 3 + 2] = v
      dSkin[w] = g.skin ? g.skin[i] : 0
      w++
      if (mx < cmin[0]) cmin[0] = mx
      if (my < cmin[1]) cmin[1] = my
      if (mz < cmin[2]) cmin[2] = mz
      if (mx + sx - 1 > cmax[0]) cmax[0] = mx + sx - 1
      if (my + sy - 1 > cmax[1]) cmax[1] = my + sy - 1
      if (mz + sz - 1 > cmax[2]) cmax[2] = mz + sz - 1
    }
    if (w === 0) return
    if (gi === 0) {
      const a = transformPoint(reorient, cmin[0], cmin[1], cmin[2])
      const b = transformPoint(reorient, cmax[0], cmax[1], cmax[2])
      const lo3 = [0, 1, 2].map((k) => Math.round(Math.min(a[k], b[k])))
      const hi3 = [0, 1, 2].map((k) => Math.round(Math.max(a[k], b[k])))
      mainDims = [hi3[0] - lo3[0] + 1, hi3[1] - lo3[1] + 1, hi3[2] - lo3[2] + 1]
      mainCell = cell
      mainMin = [lo3[0], lo3[1], lo3[2]]
    }
    for (let c = 0; c < 8; c++) {
      const p = transformPoint(
        toMain,
        ((c & 1 ? cmax[0] + 0.5 : cmin[0] - 0.5)) * cell,
        ((c & 2 ? cmax[1] + 0.5 : cmin[1] - 0.5)) * cell,
        ((c & 4 ? cmax[2] + 0.5 : cmin[2] - 0.5)) * cell,
      )
      for (let a = 0; a < 3; a++) {
        if (p[a] < lo[a]) lo[a] = p[a]
        if (p[a] > hi[a]) hi[a] = p[a]
      }
    }
    grids.push({
      cell,
      toMain,
      inst: buf.slice(0, w * 32),
      count: w,
      detail: { def: dDef.slice(0, w), orient: dOrient.slice(0, w), hsv: dHsv.slice(0, w * 3), skin: dSkin.slice(0, w) },
    })
  })

  if (!grids.length) {
    lo.fill(0)
    hi.fill(0)
  }

  const rows: TableRow[] = []
  const keyTotals = new Map<string, TableRow>()
  for (const [ck, qty] of counts) {
    const def = defCache.get(ck)!
    const k = Math.floor(ck / 2)
    const [, sub] = typeParts[k]
    const name = def ? def.name : sub
    const source = def ? (labels.get(def.source) ?? sourceLabel(def.source)) : 'Unknown'
    const id = name + '\u0000' + source
    const row = keyTotals.get(id)
    if (row) row.qty += qty
    else {
      const r: TableRow = { name, source, qty, missing: !def, modded: !!def && def.source !== 'vanilla' && def.source !== 'game' }
      keyTotals.set(id, r)
      rows.push(r)
    }
  }
  rows.sort((a, b) => b.qty - a.qty)

  return {
    model: {
      name: parsed.name,
      gridLarge: parsed.grids[0]?.large ?? true,
      dims: mainDims,
      lengthM: mainDims[2] * mainCell,
      cellMin: mainMin,
      mainCell,
      blockCount,
      boundsMin: lo,
      boundsMax: hi,
      grids,
      defs: defList,
      skins: (parsed.skins ?? []).map((sub) => skinOf(sub) ?? null),
    },
    rows,
  }
}

function sourceLabel(s: string): string {
  return s === 'vanilla' || s === 'game' ? 'Vanilla' : s
}
