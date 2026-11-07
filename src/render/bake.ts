import type { MeshData, PartData } from '../assets/build.ts'
import { KIND_DECAL, KIND_GLASS, KIND_HIDDEN, KIND_LIGHT, KIND_PAINT } from '../assets/material.ts'
import { FLAG_PLACEHOLDER, type RenderModel } from '../se/defs.ts'
import { cubeData } from './cube.ts'
import { FLAG_BEHIND, STRIDE, type DetailScene } from './detail.ts'

export type Section = { on: boolean; axis: number; cut: number; mode: 'cut' | 'slice'; flip: boolean; thick: number }

export type BakeMaterial = { key: string; kind: number; rgb: [number, number, number] }

export type Chunk = { mat: BakeMaterial; pos: Float32Array; nrm: Float32Array; idx: Uint32Array }

export type BakeInput = { model: RenderModel; scene: DetailScene | null; section: Section }

export type BakeStats = { tris: number; verts: number }

export const LIGHT_RGB: [number, number, number] = [0.95, 0.92, 0.78]
export const GLASS_RGB: [number, number, number] = [0.6, 0.74, 0.84]
export const PLACEHOLDER_RGB: [number, number, number] = [1, 0.1686, 0.8392]

// Chunks stay around a million vertices so a writer never needs one huge allocation per group.
const MAX_CHUNK_VERTS = 1 << 20

type PartBake = { kind: number; rgb: [number, number, number]; verts: Uint32Array; idx: Uint32Array }

type Job =
  | { kind: 'part'; inst: Float32Array; list: number[]; data: MeshData; part: PartBake; mat: BakeMaterial }
  | { kind: 'box'; inst: Float32Array; list: number[]; T: Float32Array; cell: number; mat: BakeMaterial }

const partCache = new WeakMap<MeshData, Array<PartBake | null>>()

function sortedUnique(a: number[]): Uint32Array {
  a.sort((x, y) => x - y)
  let n = 0
  for (let i = 0; i < a.length; i++) if (i === 0 || a[i] !== a[i - 1]) a[n++] = a[i]
  return Uint32Array.from(a.slice(0, n))
}

function bakePart(data: MeshData, part: PartData): PartBake | null {
  if (part.kind === KIND_HIDDEN || part.kind === KIND_DECAL) return null
  const src = data.idx.subarray(part.start, part.start + part.count)
  const verts = sortedUnique(Array.from(src))
  const remap = new Map<number, number>()
  verts.forEach((v, i) => remap.set(v, i))
  const idx = new Uint32Array(src.length)
  const p = data.pos
  const n = data.nrm
  for (let i = 0; i + 2 < src.length; i += 3) {
    const a = src[i], b = src[i + 1], c = src[i + 2]
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    const sx = n[a * 3] + n[b * 3] + n[c * 3], sy = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], sz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]
    // The renderer draws both sides, so MWM winding is unreliable; make it agree with the vertex normals.
    const flip = fx * sx + fy * sy + fz * sz < 0
    idx[i] = remap.get(a)!
    idx[i + 1] = remap.get(flip ? c : b)!
    idx[i + 2] = remap.get(flip ? b : c)!
  }
  const rgb: [number, number, number] = part.kind === KIND_LIGHT ? LIGHT_RGB : part.kind === KIND_GLASS ? GLASS_RGB : part.color
  return { kind: part.kind, rgb, verts, idx }
}

function partsOf(data: MeshData): Array<PartBake | null> {
  let p = partCache.get(data)
  if (!p) partCache.set(data, (p = data.parts.map((part) => bakePart(data, part))))
  return p
}

export function keptRange(lo: number, hi: number, s: Section): boolean {
  if (!s.on) return true
  const cut = s.cut
  const t = s.thick
  if (s.mode !== 'slice') return s.flip ? hi >= cut : lo < cut
  return s.flip ? lo <= cut + t - 1 && hi >= cut : lo <= cut - 1 && hi >= cut - t
}

function keptInstance(a: Float32Array, o: number, s: Section): boolean {
  if (!s.on) return (a[o + 24] & FLAG_BEHIND) === 0
  const ax = s.axis
  if (!keptRange(a[o + 18 + ax], a[o + 21 + ax], s)) return false
  return (a[o + 24] & FLAG_BEHIND) === 0 || !keptRange(a[o + 25 + ax], a[o + 28 + ax], s)
}

function keptBox(a: Float32Array, o: number, T: Float32Array, cell: number, model: RenderModel, s: Section): boolean {
  if (!s.on) return true
  const ax = s.axis
  const sx = a[o + 3], sy = a[o + 4], sz = a[o + 5]
  const cx = (a[o] + (sx - 1) * 0.5) * cell, cy = (a[o + 1] + (sy - 1) * 0.5) * cell, cz = (a[o + 2] + (sz - 1) * 0.5) * cell
  const c = cx * T[ax] + cy * T[4 + ax] + cz * T[8 + ax] + T[12 + ax]
  const h = 0.5 * cell * (Math.abs(T[ax]) * sx + Math.abs(T[4 + ax]) * sy + Math.abs(T[8 + ax]) * sz)
  const mc = model.mainCell
  const lo = Math.floor((c - h) / mc + 0.51) - model.cellMin[ax]
  const hi = Math.floor((c + h) / mc - 0.49) - model.cellMin[ax]
  return keptRange(lo, hi, s)
}

const hex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0')

function plan(input: BakeInput): Job[] {
  const { model, section } = input
  const scene = input.scene && input.scene.groups.length ? input.scene : null
  const mats = new Map<string, BakeMaterial>()
  const matOf = (kind: number, rgb: [number, number, number]) => {
    const key = `${kind}:${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`
    let m = mats.get(key)
    if (!m) mats.set(key, (m = { key, kind, rgb }))
    return m
  }
  const paintOf = (c: number): [number, number, number] => [(c & 255) / 255, ((c >> 8) & 255) / 255, ((c >> 16) & 255) / 255]
  const jobs: Job[] = []
  const boxes = (inst: Float32Array, count: number, T: Float32Array, cell: number) => {
    const byMat = new Map<BakeMaterial, number[]>()
    for (let i = 0; i < count; i++) {
      const o = i * 8
      if (!keptBox(inst, o, T, cell, model, section)) continue
      const mat = inst[o + 7] & FLAG_PLACEHOLDER ? matOf(KIND_PAINT, PLACEHOLDER_RGB) : matOf(KIND_PAINT, paintOf(inst[o + 6]))
      let list = byMat.get(mat)
      if (!list) byMat.set(mat, (list = []))
      list.push(i)
    }
    for (const [mat, list] of byMat) jobs.push({ kind: 'box', inst, list, T, cell, mat })
  }
  if (!scene) {
    for (const g of model.grids) boxes(new Float32Array(g.inst), g.count, g.toMain, g.cell)
    return jobs
  }
  for (const gr of scene.groups) {
    const data = gr.mesh.data
    if (!data) continue
    const parts = partsOf(data)
    const a = gr.inst
    const kept: number[] = []
    const byPaint = new Map<number, number[]>()
    for (let i = 0; i < gr.count; i++) {
      const o = i * STRIDE
      if (!keptInstance(a, o, section)) continue
      kept.push(i)
      const p = a[o + 15]
      let list = byPaint.get(p)
      if (!list) byPaint.set(p, (list = []))
      list.push(i)
    }
    if (!kept.length) continue
    for (const part of parts) {
      if (!part || !part.idx.length) continue
      if (part.kind === KIND_PAINT) for (const [paint, list] of byPaint) jobs.push({ kind: 'part', inst: a, list, data, part, mat: matOf(KIND_PAINT, paintOf(paint)) })
      else jobs.push({ kind: 'part', inst: a, list: kept, data, part, mat: matOf(part.kind, part.rgb) })
    }
  }
  for (const b of scene.boxes) {
    const g = model.grids[b.grid]
    boxes(b.inst, b.count, g.toMain, g.cell)
  }
  return jobs
}

export function bakeStats(input: BakeInput): BakeStats {
  let tris = 0
  let verts = 0
  for (const j of plan(input)) {
    if (j.kind === 'box') {
      tris += j.list.length * 12
      verts += j.list.length * 24
    } else {
      tris += (j.list.length * j.part.idx.length) / 3
      verts += j.list.length * j.part.verts.length
    }
  }
  return { tris, verts }
}

function* partChunks(j: Job & { kind: 'part' }): Generator<Chunk> {
  const { inst: a, data, part } = j
  const nv = part.verts.length
  const ni = part.idx.length
  const per = Math.max(1, Math.floor(MAX_CHUNK_VERTS / nv))
  for (let s = 0; s < j.list.length; s += per) {
    const batch = j.list.slice(s, s + per)
    const pos = new Float32Array(batch.length * nv * 3)
    const nrm = new Float32Array(batch.length * nv * 3)
    const idx = new Uint32Array(batch.length * ni)
    batch.forEach((i, k) => {
      const o = i * STRIDE
      const r0x = a[o], r0y = a[o + 1], r0z = a[o + 2]
      const r1x = a[o + 3], r1y = a[o + 4], r1z = a[o + 5]
      const r2x = a[o + 6], r2y = a[o + 7], r2z = a[o + 8]
      const tx = a[o + 9], ty = a[o + 10], tz = a[o + 11]
      const det = r0x * (r1y * r2z - r1z * r2y) - r0y * (r1x * r2z - r1z * r2x) + r0z * (r1x * r2y - r1y * r2x)
      const vb = k * nv
      for (let v = 0; v < nv; v++) {
        const src = part.verts[v] * 3
        const px = data.pos[src], py = data.pos[src + 1], pz = data.pos[src + 2]
        const nx = data.nrm[src], ny = data.nrm[src + 1], nz = data.nrm[src + 2]
        const d = (vb + v) * 3
        pos[d] = px * r0x + py * r1x + pz * r2x + tx
        pos[d + 1] = px * r0y + py * r1y + pz * r2y + ty
        pos[d + 2] = px * r0z + py * r1z + pz * r2z + tz
        nrm[d] = nx * r0x + ny * r1x + nz * r2x
        nrm[d + 1] = nx * r0y + ny * r1y + nz * r2y
        nrm[d + 2] = nx * r0z + ny * r1z + nz * r2z
      }
      const ib = k * ni
      // A mirrored instance reverses the winding, so swap two corners to keep faces outward.
      if (det < 0) for (let t = 0; t < ni; t += 3) {
        idx[ib + t] = part.idx[t] + vb
        idx[ib + t + 1] = part.idx[t + 2] + vb
        idx[ib + t + 2] = part.idx[t + 1] + vb
      }
      else for (let t = 0; t < ni; t++) idx[ib + t] = part.idx[t] + vb
    })
    yield { mat: j.mat, pos, nrm, idx }
  }
}

const cube = cubeData()

function* boxChunks(j: Job & { kind: 'box' }): Generator<Chunk> {
  const { inst: a, T, cell } = j
  const per = Math.floor(MAX_CHUNK_VERTS / 24)
  for (let s = 0; s < j.list.length; s += per) {
    const batch = j.list.slice(s, s + per)
    const pos = new Float32Array(batch.length * 72)
    const nrm = new Float32Array(batch.length * 72)
    const idx = new Uint32Array(batch.length * 36)
    batch.forEach((i, k) => {
      const o = i * 8
      const mx = a[o] - 0.5, my = a[o + 1] - 0.5, mz = a[o + 2] - 0.5
      const sx = a[o + 3], sy = a[o + 4], sz = a[o + 5]
      for (let v = 0; v < 24; v++) {
        const lx = (mx + cube.pos[v * 3] * sx) * cell, ly = (my + cube.pos[v * 3 + 1] * sy) * cell, lz = (mz + cube.pos[v * 3 + 2] * sz) * cell
        const nx = cube.nrm[v * 3], ny = cube.nrm[v * 3 + 1], nz = cube.nrm[v * 3 + 2]
        const d = (k * 24 + v) * 3
        pos[d] = lx * T[0] + ly * T[4] + lz * T[8] + T[12]
        pos[d + 1] = lx * T[1] + ly * T[5] + lz * T[9] + T[13]
        pos[d + 2] = lx * T[2] + ly * T[6] + lz * T[10] + T[14]
        nrm[d] = nx * T[0] + ny * T[4] + nz * T[8]
        nrm[d + 1] = nx * T[1] + ny * T[5] + nz * T[9]
        nrm[d + 2] = nx * T[2] + ny * T[6] + nz * T[10]
      }
      for (let t = 0; t < 36; t++) idx[k * 36 + t] = cube.idx[t] + k * 24
    })
    yield { mat: j.mat, pos, nrm, idx }
  }
}

export function* bakeChunks(input: BakeInput): Generator<Chunk> {
  for (const j of plan(input)) {
    if (j.kind === 'box') yield* boxChunks(j)
    else yield* partChunks(j)
  }
}
