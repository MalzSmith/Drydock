import { parseDefinitions, parseGlass, parseResx, parseSkins, toTuple, type DefTuple, type GlassDef, type SkinDef } from '../se/defs.ts'
import { VANILLA_SEASONAL, VANILLA_SKY, parseSkies, type SkyDef } from '../se/env.ts'
import { child, parseXml } from '../se/xml.ts'
import {
  childDirs,
  findBlueprintsRoot,
  findGameData,
  findPath,
  findWorkshopRoot,
  mapPool,
  sbcFiles,
  tryDir,
  tryFile,
  type FsDir,
} from './fs.ts'

export type SourceKind = 'game' | 'workshop' | 'torch' | 'mods' | 'blueprints'

export type BpEntry = {
  id: string
  sourceId: number
  folder: string
  name: string
  large: boolean
  size: number
  modified: number
  mods: number | null
  file: File | null
}

export type ModInfo = { key: string; sourceId: number; folder: string; name: string; subs: string[] }

export type ModCacheRec = { fp: string; name: string; subs: string[]; defs: DefTuple[]; skins?: SkinDef[]; glass?: GlassDef[]; skies?: SkyDef[] }

export type ModSkies = { key: string; name: string; skies: SkyDef[] }

export type ScanCache = {
  getMod(key: string): Promise<ModCacheRec | undefined>
  putMod(key: string, rec: ModCacheRec): Promise<void>
  getBpMods(key: string): Promise<number | undefined>
}

export type ScanResult = {
  kind: SourceKind
  found: boolean
  defs: DefTuple[]
  skins?: SkinDef[]
  glass?: GlassDef[]
  skies?: SkyDef[]
  entries: BpEntry[]
  mods: ModInfo[]
  modSkies?: ModSkies[]
  seenMods: string[]
}

export type Progress = (text: string, frac: number | null) => void

export type ScanOpts = { kind: SourceKind; sourceId: number; cache: ScanCache; progress?: Progress }

const num = (n: number) => n.toLocaleString('en-US')

function fingerprint(lines: string[]): string {
  let h = 0x811c9dc5
  for (const l of lines)
    for (let i = 0; i < l.length; i++) h = Math.imul(h ^ l.charCodeAt(i), 0x01000193)
  return `r2:${lines.length}:${(h >>> 0).toString(36)}`
}

const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

export function withSeasonal(skies: SkyDef[]): SkyDef[] {
  const base = skies.find((s) => s.path.toLowerCase() === VANILLA_SKY.toLowerCase())
  return base ? [...skies, ...VANILLA_SEASONAL.map((path) => ({ ...base, path }))] : skies
}

export async function scanGame(root: FsDir, progress?: Progress): Promise<{ found: boolean; defs: DefTuple[]; skins: SkinDef[]; glass: GlassDef[]; skies: SkyDef[] }> {
  const data = await findGameData(root)
  if (!data) return { found: false, defs: [], skins: [], glass: [], skies: [] }
  const loc = await findPath(data, 'Localization')
  const rf = loc ? await tryFile(loc, 'MyTexts.resx') : null
  const names = rf ? parseResx(await (await rf.getFile()).text()) : new Map<string, string>()
  const files: Array<() => Promise<File>> = []
  for await (const [, f] of sbcFiles(data)) files.push(() => f.getFile())
  let done = 0
  const parts = await mapPool(files, 8, async (get) => {
    const text = await (await get()).text()
    progress?.(`Parsing definitions ${num(++done)}/${num(files.length)}`, done / files.length)
    return { defs: text.includes('<CubeBlocks') ? parseDefinitions(text, 'game', names).map(toTuple) : [], skins: parseSkins(text), glass: parseGlass(text), skies: parseSkies(text) }
  })
  return { found: true, defs: parts.flatMap((p) => p.defs), skins: parts.flatMap((p) => p.skins), glass: parts.flatMap((p) => p.glass), skies: withSeasonal(parts.flatMap((p) => p.skies)) }
}

async function readEntry(sourceId: number, dir: FsDir, cache: ScanCache): Promise<BpEntry | null> {
  const fh = await tryFile(dir, 'bp.sbc')
  if (!fh) return null
  const file = await fh.getFile()
  const head = await file.slice(0, 4096).text()
  const idAt = head.indexOf('<Id ')
  let name = dir.name
  if (idAt >= 0) {
    const m = /Subtype="([^"]*)"/.exec(head.slice(idAt, head.indexOf('>', idAt) + 1))
    if (m && m[1]) name = unescape(m[1])
  }
  const big = file.size > 4096 ? await file.slice(0, 65536).text() : head
  const g = /<GridSizeEnum>\s*(\w+)/.exec(big)
  const id = `${sourceId}/${dir.name}`
  const mods = (await cache.getBpMods(`${id}|${file.lastModified}`)) ?? null
  return { id, sourceId, folder: dir.name, name, large: g ? g[1] !== 'Small' : true, size: file.size, modified: file.lastModified, mods, file }
}

export async function scanBlueprints(root: FsDir, kind: SourceKind, sourceId: number, cache: ScanCache, progress?: Progress): Promise<BpEntry[]> {
  const base = kind === 'blueprints' ? await findBlueprintsRoot(root) : kind === 'workshop' ? await findWorkshopRoot(root, 'workshop') : null
  if (!base) return []
  const dirs = await childDirs(base)
  let done = 0
  const list = await mapPool(dirs, 12, async (d) => {
    const e = await readEntry(sourceId, d, cache).catch(() => null)
    progress?.(`Reading blueprints ${num(++done)}/${num(dirs.length)}`, done / dirs.length)
    return e
  })
  return list.filter((e): e is BpEntry => e !== null).sort((a, b) => a.name.localeCompare(b.name))
}

type Indexed = { info: ModInfo | null; skies: ModSkies | null }

const indexed = (key: string, sourceId: number, folder: string, rec: ModCacheRec): Indexed => ({
  info: rec.subs.length ? { key, sourceId, folder, name: rec.name, subs: rec.subs } : null,
  skies: rec.skies?.length ? { key, name: rec.name, skies: rec.skies } : null,
})

async function indexMod(sourceId: number, dir: FsDir, cache: ScanCache): Promise<Indexed | null> {
  const data = await tryDir(dir, 'Data')
  if (!data) return null
  const files: File[] = []
  const lines: string[] = []
  for await (const [path, f] of sbcFiles(data)) {
    const file = await f.getFile()
    files.push(file)
    lines.push(`${path}|${file.size}|${file.lastModified}`)
  }
  lines.sort()
  const fp = fingerprint(lines)
  const key = `${sourceId}/${dir.name}`
  const hit = await cache.getMod(key)
  if (hit && hit.fp === fp && hit.skies && hit.glass?.every((g) => g.light !== undefined)) return indexed(key, sourceId, dir.name, hit)
  const defs: DefTuple[] = []
  const skins: SkinDef[] = []
  const glass: GlassDef[] = []
  const skies: SkyDef[] = []
  const subs = new Set<string>()
  for (const f of files) {
    const text = await f.text()
    skins.push(...parseSkins(text))
    glass.push(...parseGlass(text))
    skies.push(...parseSkies(text))
    if (!text.includes('<CubeBlocks')) continue
    for (const d of parseDefinitions(text, key)) {
      defs.push(toTuple(d))
      subs.add(d.subtype.toLowerCase())
    }
  }
  let name = dir.name
  const info = await tryFile(dir, 'modinfo.sbmi')
  if (info) {
    try {
      const n = child(parseXml(await (await info.getFile()).text()).children[0], 'Name')?.text
      if (n) name = n
    } catch {
      name = dir.name
    }
  }
  const rec: ModCacheRec = { fp, name, subs: [...subs], defs, skins, glass, skies }
  await cache.putMod(key, rec)
  return indexed(key, sourceId, dir.name, rec)
}

export async function scanMods(root: FsDir, kind: SourceKind, sourceId: number, cache: ScanCache, progress?: Progress): Promise<{ mods: ModInfo[]; skies: ModSkies[]; seen: string[] }> {
  const base = kind === 'mods' ? root : await findWorkshopRoot(root, kind === 'torch' ? 'torch' : 'workshop')
  if (!base) return { mods: [], skies: [], seen: [] }
  const dirs = await childDirs(base)
  let done = 0
  const list = await mapPool(dirs, 8, async (d) => {
    const m = await indexMod(sourceId, d, cache).catch(() => null)
    progress?.(`Indexing mods ${num(++done)}/${num(dirs.length)}`, done / dirs.length)
    return m
  })
  return {
    mods: list.flatMap((m) => (m?.info ? [m.info] : [])),
    skies: list.flatMap((m) => (m?.skies ? [m.skies] : [])),
    seen: dirs.map((d) => d.name),
  }
}

export async function scanSource(root: FsDir, o: ScanOpts): Promise<ScanResult> {
  const r: ScanResult = { kind: o.kind, found: true, defs: [], entries: [], mods: [], seenMods: [] }
  if (o.kind === 'game') {
    const g = await scanGame(root, o.progress)
    r.found = g.found
    r.defs = g.defs
    r.skins = g.skins
    r.glass = g.glass
    r.skies = g.skies
  } else {
    if (o.kind === 'blueprints' || o.kind === 'workshop') r.entries = await scanBlueprints(root, o.kind, o.sourceId, o.cache, o.progress)
    if (o.kind !== 'blueprints') {
      const m = await scanMods(root, o.kind, o.sourceId, o.cache, o.progress)
      r.mods = m.mods
      r.modSkies = m.skies
      r.seenMods = m.seen
    }
  }
  return r
}
