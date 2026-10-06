import { decodeLevel, downsample, fullLevelCount, levelBytes, parseDdsHeader } from '../se/dds.ts'
import { parseMwm } from '../se/mwm.ts'
import { mul } from '../se/orient.ts'
import { splitKey, textureCandidates } from './keys.ts'
import { KIND_DECAL, KIND_HIDDEN, classify, fixedColor } from './material.ts'

export type TexRefs = { cm?: string[]; ng?: string[]; add?: string[]; am?: string[] }

export type PartData = {
  start: number
  count: number
  kind: number
  color: [number, number, number]
  material: string
  technique: string
  tex: TexRefs | null
  glass?: string
}

export type MeshData = {
  pos: Float32Array
  nrm: Float32Array
  uv: Float32Array
  idx: Uint32Array
  parts: PartData[]
  min: [number, number, number]
  max: [number, number, number]
  patternScale: number
  tris: number
}

export type TexFormat = 'bc1' | 'bc2' | 'bc3' | 'bc7' | 'rgba'

export type TexLevel = { w: number; h: number; data: Uint8Array }

export type TexData = { w: number; h: number; fmt: TexFormat; levels: TexLevel[] }

export type Status = 'ok' | 'uncached' | 'missing' | 'error'

export type AssetResult<T> = { data: T | null; status: Status; key?: string; error?: string }

export type Caps = { s3tc: boolean; bptc: boolean }

export type AssetEnv = {
  file(key: string): File | undefined
  hasPrefix(prefix: string): boolean
  cacheGet<T>(store: 'meshes' | 'textures', key: string): Promise<T | undefined>
  cachePut(store: 'meshes' | 'textures', key: string, value: unknown): Promise<void>
}

export const MESH_V = 1
export const TEX_V = 1

type CacheRec<T> = { v: number; fp: string; data: T }

const fpOf = (f: File) => `${f.size}|${f.lastModified}`

async function resolve<T>(env: AssetEnv, store: 'meshes' | 'textures', cands: string[], v: number, build: (key: string, f: File) => Promise<T | null>): Promise<AssetResult<T>> {
  let anyFiles = false
  for (const key of cands) {
    const f = env.file(key)
    const hit = await env.cacheGet<CacheRec<T | null>>(store, key).catch(() => undefined)
    if (f) {
      if (hit && hit.v === v && hit.fp === fpOf(f)) return hit.data ? { data: hit.data, status: 'ok', key } : { data: null, status: 'error', key }
      try {
        const data = await build(key, f)
        await env.cachePut(store, key, { v, fp: fpOf(f), data } satisfies CacheRec<T | null>).catch(() => undefined)
        return data ? { data, status: 'ok', key } : { data: null, status: 'error', key, error: 'no geometry' }
      } catch (err) {
        return { data: null, status: 'error', key, error: err instanceof Error ? err.message : String(err) }
      }
    }
    if (hit && hit.v === v) return hit.data ? { data: hit.data, status: 'ok', key } : { data: null, status: 'error', key }
    if (env.hasPrefix(splitKey(key).prefix)) anyFiles = true
  }
  return { data: null, status: anyFiles ? 'missing' : 'uncached' }
}

function normalizeRows(m: Float32Array): Float32Array {
  const r = new Float32Array(16)
  for (let row = 0; row < 3; row++) {
    const x = m[row * 4], y = m[row * 4 + 1], z = m[row * 4 + 2]
    const l = Math.hypot(x, y, z)
    const k = l > 1e-12 ? 1 / l : 1
    r[row * 4] = x * k
    r[row * 4 + 1] = y * k
    r[row * 4 + 2] = z * k
  }
  r[12] = m[12]
  r[13] = m[13]
  r[14] = m[14]
  r[15] = 1
  return r
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

class Acc {
  pos: number[] = []
  nrm: number[] = []
  uv: number[] = []
  idx: number[] = []
  parts: PartData[] = []
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i + 1)
}

function contentRootOf(key: string): string | null {
  const { prefix, rel } = splitKey(key)
  const i = rel.lastIndexOf('models')
  return i > 0 || (i === 0 && prefix !== 'c:') ? prefix + rel.slice(0, i) : prefix === 'c:' ? 'c:' : null
}

function textures(t: Record<string, string>, root: string | null): TexRefs | null {
  const get = (k: string) => {
    const v = t[k]
    if (!v || !v.trim()) return undefined
    const n = v.trim().replace(/[\\/]+/g, '/').replace(/^\//, '').toLowerCase()
    return textureCandidates(n, root)
  }
  const r: TexRefs = {}
  const cm = get('ColorMetalTexture') ?? get('DiffuseTexture')
  const ng = get('NormalGlossTexture')
  const add = get('AddMapsTexture')
  const am = get('AlphamaskTexture')
  if (cm) r.cm = cm
  if (ng) r.ng = ng
  if (add) r.add = add
  if (am) r.am = am
  return cm || ng || add || am ? r : null
}

async function append(env: AssetEnv, key: string, file: File, transform: Float32Array, acc: Acc, depth: number): Promise<number> {
  const mwm = parseMwm(await file.arrayBuffer())
  let geo = mwm
  if (mwm.positions.length === 0 && mwm.geometryAsset) {
    const { prefix, rel } = splitKey(key)
    let model = mwm.geometryAsset.replace(/[\\/]+/g, '/').replace(/^\//, '').toLowerCase()
    if (!model.includes('.mwm')) model += '.mwm'
    const i = rel.indexOf('models')
    const cands = i >= 0 ? [prefix + rel.slice(0, i) + model, 'c:' + model] : ['c:' + model]
    const f = cands.map((c) => env.file(c)).find((x) => x)
    if (f) geo = parseMwm(await f.arrayBuffer())
  }
  const n = geo.positions.length / 3
  const base = acc.pos.length / 3
  const m = transform
  const P = geo.positions
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
    acc.pos.push(x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14])
  }
  const hasNormals = geo.normals.length === geo.positions.length
  const N = geo.normals
  for (let i = 0; i < n; i++) {
    if (!hasNormals) {
      acc.nrm.push(0, 0, 0)
      continue
    }
    const x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2]
    const a = x * m[0] + y * m[4] + z * m[8]
    const b = x * m[1] + y * m[5] + z * m[9]
    const c = x * m[2] + y * m[6] + z * m[10]
    const l = Math.hypot(a, b, c)
    const k = l > 1e-12 ? 1 / l : 1
    acc.nrm.push(a * k, b * k, c * k)
  }
  const hasUvs = geo.uvs.length / 2 === n
  const uvScale = geo.patternScale !== 0 ? 1 / geo.patternScale : 1
  for (let i = 0; i < n; i++) {
    if (hasUvs) acc.uv.push(geo.uvs[i * 2] * uvScale, geo.uvs[i * 2 + 1] * uvScale)
    else acc.uv.push(0, 0)
  }
  const root = contentRootOf(key)
  for (const part of geo.parts) {
    if (part.indices.length < 3) continue
    const kind = classify(part.material, part.technique)
    if (kind === KIND_HIDDEN) continue
    const len = part.indices.length - (part.indices.length % 3)
    let ok = true
    for (let i = 0; i < len; i++)
      if (part.indices[i] >= n) {
        ok = false
        break
      }
    if (!ok) continue
    const start = acc.idx.length
    for (let i = 0; i < len; i++) acc.idx.push(part.indices[i] + base)
    acc.parts.push({
      start,
      count: len,
      kind,
      color: fixedColor(part.material),
      material: part.material,
      technique: part.technique,
      tex: hasUvs ? textures(part.textures, root) : null,
      ...(part.glassCcw ? { glass: part.glassCcw } : {}),
    })
  }
  if (depth >= 4) return mwm.patternScale
  const { prefix, rel } = splitKey(key)
  for (const d of mwm.dummies) {
    const sub = d.data['file']
    if (!d.name.includes('subpart_') || sub === undefined) continue
    const sk = prefix + (dirOf(rel) + sub.replace(/[\\/]+/g, '/') + '.mwm').toLowerCase()
    const f = env.file(sk)
    if (!f) continue
    try {
      await append(env, sk, f, mul(normalizeRows(d.matrix), transform), acc, depth + 1)
    } catch {
      continue
    }
  }
  return mwm.patternScale
}

async function buildMesh(env: AssetEnv, key: string, file: File): Promise<MeshData | null> {
  const acc = new Acc()
  const patternScale = await append(env, key, file, IDENTITY, acc, 0)
  if (acc.pos.length === 0 || acc.parts.every((p) => p.kind === KIND_DECAL)) return null
  const pos = new Float32Array(acc.pos)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let tris = 0
  for (const p of acc.parts) {
    if (p.kind === KIND_DECAL) continue
    for (let i = p.start; i < p.start + p.count; i++) {
      const v = acc.idx[i] * 3
      for (let a = 0; a < 3; a++) {
        if (pos[v + a] < min[a]) min[a] = pos[v + a]
        if (pos[v + a] > max[a]) max[a] = pos[v + a]
      }
    }
    tris += p.count / 3
  }
  return { pos, nrm: new Float32Array(acc.nrm), uv: new Float32Array(acc.uv), idx: new Uint32Array(acc.idx), parts: acc.parts, min, max, patternScale, tris }
}

export function loadMesh(env: AssetEnv, cands: string[]): Promise<AssetResult<MeshData>> {
  return resolve(env, 'meshes', cands, MESH_V, (key, f) => buildMesh(env, key, f))
}

const GPU_FORMATS = new Set(['bc1', 'bc2', 'bc3', 'bc7'])

async function buildTexture(file: File): Promise<TexData | null> {
  const buf = await file.arrayBuffer()
  const info = parseDdsHeader(buf)
  if (!info) return null
  const bytes = new Uint8Array(buf)
  const full = fullLevelCount(info.width, info.height)
  const levelAt = (i: number) => {
    const w = Math.max(1, info.width >> i)
    const h = Math.max(1, info.height >> i)
    return { w, h, data: bytes.slice(info.offsets[i], info.offsets[i] + levelBytes(info.format, w, h)) }
  }
  const blockable = (n: number) => n <= 2 || n % 4 === 0
  let gpuOk = GPU_FORMATS.has(info.format) && info.offsets.length === full
  for (let i = 0; gpuOk && i < full; i++) gpuOk = blockable(Math.max(1, info.width >> i)) && blockable(Math.max(1, info.height >> i))
  if (gpuOk) {
    const levels: TexLevel[] = []
    for (let i = 0; i < full; i++) {
      levels.push(levelAt(i))
    }
    return { w: info.width, h: info.height, fmt: info.format as TexFormat, levels }
  }
  const levels: TexLevel[] = []
  for (let i = 0; i < info.offsets.length; i++) {
    const l = levelAt(i)
    levels.push({ w: l.w, h: l.h, data: decodeLevel(info.format, l.data, l.w, l.h) })
  }
  while (levels.length < full) {
    const last = levels[levels.length - 1]
    const d = downsample(last.data, last.w, last.h)
    levels.push({ w: d.w, h: d.h, data: d.data })
  }
  return { w: info.width, h: info.height, fmt: 'rgba', levels }
}

export function forCaps(t: TexData, caps: Caps): TexData {
  if (t.fmt === 'rgba') return t
  if (t.fmt === 'bc7' ? caps.bptc : caps.s3tc) return t
  return { w: t.w, h: t.h, fmt: 'rgba', levels: t.levels.map((l) => ({ w: l.w, h: l.h, data: decodeLevel(t.fmt as 'bc1', l.data, l.w, l.h) })) }
}

export async function loadTexture(env: AssetEnv, cands: string[], caps: Caps): Promise<AssetResult<TexData>> {
  const r = await resolve(env, 'textures', cands, TEX_V, (_key, f) => buildTexture(f))
  return r.data ? { ...r, data: forCaps(r.data, caps) } : r
}

