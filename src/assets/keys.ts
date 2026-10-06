import type { DefTuple } from '../se/defs.ts'
import type { SourceKind } from '../sources/scan.ts'

export const isAssetFile = (name: string) => {
  const n = name.toLowerCase()
  return n.endsWith('.mwm') || n.endsWith('.dds')
}

const lower = (a: string[]) => a.map((x) => x.toLowerCase())

function startsWith(path: string[], prefix: string[]): boolean {
  if (path.length <= prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false
  return true
}

function workshopBase(rootName: string, rests: string[][], kind: SourceKind): string[] | null {
  if (rootName === '244850') return []
  const paths = kind === 'torch' ? [['content', '244850'], ['instance', 'content', '244850']] : [['244850'], ['content', '244850']]
  for (const p of paths) if (rests.some((r) => startsWith(r, p))) return p
  return kind === 'workshop' ? [] : null
}

export function assetKeys(kind: SourceKind, sourceId: number, files: File[]): Array<[string, File]> {
  const out: Array<[string, File]> = []
  if (kind === 'blueprints' || !files.length) return out
  const split = files.map((f) => (f.webkitRelativePath || f.name).split('/'))
  const rootName = split[0].length > 1 ? split[0][0] : ''
  const rests = split.map((p) => (p.length > 1 ? p.slice(1) : p))
  const low = rests.map(lower)
  if (kind === 'game') {
    const inContent = rootName.toLowerCase() === 'content'
    low.forEach((r, i) => {
      if (inContent) out.push(['c:' + r.join('/'), files[i]])
      else if (r.length > 1 && r[0] === 'content') out.push(['c:' + r.slice(1).join('/'), files[i]])
    })
    return out
  }
  const base = kind === 'mods' ? [] : workshopBase(rootName, low, kind)
  if (!base) return out
  rests.forEach((r, i) => {
    if (r.length < base.length + 2 || !startsWith(low[i], base)) return
    const folder = r[base.length]
    if (folder.startsWith('.')) return
    out.push([`m:${sourceId}/${folder}:` + low[i].slice(base.length + 1).join('/'), files[i]])
  })
  return out
}

export function modelCandidates(path: string, mod: string | null): string[] {
  const p = path.endsWith('.mwm') ? path : path + '.mwm'
  return mod ? [`m:${mod}:${p}`, `c:${p}`] : [`c:${p}`]
}

export function defModels(defs: DefTuple[], mod: string | null): string[][] {
  const out = new Map<string, string[]>()
  const add = (path: string) => {
    const c = modelCandidates(path, mod)
    out.set(c[0], c)
  }
  for (const d of defs) {
    const r = d[7]
    if (!r) continue
    if (r.model) add(r.model)
    if (r.topo !== undefined) for (const s of r.sides ?? []) add(s[0])
  }
  return [...out.values()]
}

export function splitKey(key: string): { prefix: string; rel: string } {
  const i = key.startsWith('c:') ? 1 : key.indexOf(':', 2)
  return { prefix: key.slice(0, i + 1), rel: key.slice(i + 1) }
}

export function textureCandidates(name: string, contentRoot: string | null): string[] {
  return contentRoot && contentRoot !== 'c:' ? [contentRoot + name, 'c:' + name] : ['c:' + name]
}
