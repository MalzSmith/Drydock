import { FLAG_SELECTED } from '../se/defs.ts'
import { COMP_BLOCKS } from './blocks.ts'

export type VShape = {
  op: 'add' | 'subtract' | 'intersect'
  type: 'box' | 'sphere' | 'cylinder' | 'ellipsoid' | 'torus' | 'pyramid'
  size: [number, number, number]
  pos: [number, number, number]
  block: number
  shell: number
  tube?: number
  rot?: number[]
}

export type Voxels = {
  grid: Uint8Array
  dims: [number, number, number]
  counts: number[]
  total: number
  mark: Uint8Array | null
}

export const MAX_DIM = 160

const KIND = { box: 0, cylinder: 1, sphere: 2, ellipsoid: 2, torus: 3, pyramid: 4 } as const

type Prep = {
  op: number
  kind: number
  px: number
  py: number
  pz: number
  a: number
  b: number
  c: number
  k: number
  t: number
  rot: number[] | null
  block: number
  lo: number[]
  hi: number[]
  mask: Uint8Array | null
  mlo: number[]
  mdim: number[]
}

function blockIndex(t: number): number {
  const i = COMP_BLOCKS.findIndex((b) => b.t === t)
  return i < 0 ? 0 : i
}

function inside(kind: number, u: number, v: number, w: number): boolean {
  if (kind === 0) return Math.max(Math.abs(u), Math.abs(v), Math.abs(w)) <= 1
  if (kind === 1) return u * u + v * v <= 1 && Math.abs(w) <= 1
  return u * u + v * v + w * w <= 1
}

function inPyramid(p: Prep, x: number, y: number, z: number): boolean {
  const t = ((y - 0.5) / p.b + 1) / 2
  if (t < -1e-9 || t > 1) return false
  return Math.abs(x) <= Math.max((1 - t) * p.a, 0.5) + 1e-9 && Math.abs(z) <= Math.max((1 - t) * p.c, 0.5) + 1e-9
}

function inTorus(p: Prep, x: number, y: number, z: number): boolean {
  const d = Math.hypot(x, z)
  const r = Math.hypot(x / p.a, z / p.c)
  const mid = (d > 0 ? d / r : Math.min(p.a, p.c)) - p.t
  const u = (d - mid) / p.t
  const v = y / p.b
  return u * u + v * v <= 1
}

export const ROT_IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export const QUARTER: Record<'x' | 'y' | 'z', number[]> = {
  x: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  y: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  z: [0, -1, 0, 1, 0, 0, 0, 0, 1],
}

export function rotMul(a: number[], b: number[]): number[] {
  const o = new Array<number>(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o
}

const isIdentity = (m: number[]) => m.every((v, i) => v === ROT_IDENTITY[i])

function extent(s: VShape): [number, number, number] {
  const h = [s.size[0] / 2, s.size[1] / 2, s.size[2] / 2]
  const m = s.rot ?? ROT_IDENTITY
  return [0, 1, 2].map((r) => Math.abs(m[r * 3]) * h[0] + Math.abs(m[r * 3 + 1]) * h[1] + Math.abs(m[r * 3 + 2]) * h[2]) as [number, number, number]
}

function center(s: VShape, e: number[]): number[] {
  return s.pos.map((v, i) => (Math.round(e[i] * 2) % 2 === 0 ? v + 0.5 : v))
}

function prep(s: VShape): Prep {
  const a = Math.max(0.5, s.size[0] / 2)
  const b = Math.max(0.5, s.size[1] / 2)
  const c = Math.max(0.5, s.size[2] / 2)
  const kind = KIND[s.type]
  const t = Math.max(0.5, Math.min(s.tube ?? 1, Math.min(s.size[0], s.size[2]) / 2) / 2)
  const e = extent(s)
  const c0 = center(s, e)
  return {
    op: s.op === 'add' ? 0 : s.op === 'subtract' ? 1 : 2,
    kind,
    px: c0[0],
    py: c0[1],
    pz: c0[2],
    a,
    b,
    c,
    k: Math.max(0, Math.round(s.shell)),
    t,
    rot: s.rot && !isIdentity(s.rot) ? s.rot : null,
    block: blockIndex(s.block) + 1,
    lo: c0.map((v, i) => Math.floor(v - e[i])),
    hi: c0.map((v, i) => Math.ceil(v + e[i])),
    mask: null,
    mlo: [0, 0, 0],
    mdim: [0, 0, 0],
  }
}

export function inShape(s: VShape, x: number, y: number, z: number): boolean {
  const p = prep(s)
  if (p.k) shellMask(p, p.lo, p.hi)
  return test(p, x, y, z)
}

function shellMask(p: Prep, gLo: number[], gHi: number[]) {
  const pad = p.k + 1
  const lo = p.lo.map((v, i) => Math.max(v - 1, gLo[i] - pad))
  const hi = p.hi.map((v, i) => Math.min(v + 1, gHi[i] + pad))
  const [X, Y, Z] = lo.map((v, i) => Math.max(0, hi[i] - v + 1))
  const n = X * Y * Z
  p.mlo = lo
  p.mdim = [X, Y, Z]
  p.mask = new Uint8Array(n)
  if (!n) return
  const solid = new Uint8Array(n)
  for (let z = 0, i = 0; z < Z; z++) for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++, i++) solid[i] = solidAt(p, x + lo[0], y + lo[1], z + lo[2]) ? 1 : 0
  const k = p.k
  const far = k * k + 1
  const pass = (src: Float32Array | null, stride: number, len: number, at: (i: number) => number) => {
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const c = at(i)
      let m = far
      for (let d = -k; d <= k; d++) {
        if (c + d < 0 || c + d >= len) continue
        const j = i + d * stride
        const v = (src ? src[j] : solid[j] ? far : 0) + d * d
        if (v < m) m = v
      }
      out[i] = m
    }
    return out
  }
  const dx = pass(null, 1, X, (i) => i % X)
  const dy = pass(dx, X, Y, (i) => Math.floor(i / X) % Y)
  const dz = pass(dy, X * Y, Z, (i) => Math.floor(i / (X * Y)))
  for (let i = 0; i < n; i++) p.mask[i] = solid[i] && dz[i] <= k * k ? 1 : 0
}

function test(p: Prep, x: number, y: number, z: number): boolean {
  if (!p.mask) return solidAt(p, x, y, z)
  const lx = x - p.mlo[0]
  const ly = y - p.mlo[1]
  const lz = z - p.mlo[2]
  const [X, Y, Z] = p.mdim
  if (lx < 0 || ly < 0 || lz < 0 || lx >= X || ly >= Y || lz >= Z) return false
  return p.mask[lx + X * (ly + Y * lz)] === 1
}

function solidAt(p: Prep, x: number, y: number, z: number): boolean {
  let dx = x - p.px
  let dy = y - p.py
  let dz = z - p.pz
  const m = p.rot
  if (m) {
    const lx = m[0] * dx + m[3] * dy + m[6] * dz
    const ly = m[1] * dx + m[4] * dy + m[7] * dz
    dz = m[2] * dx + m[5] * dy + m[8] * dz
    dx = lx
    dy = ly
  }
  if (p.kind === 3) return inTorus(p, dx, dy, dz)
  if (p.kind === 4) return inPyramid(p, dx, dy, dz)
  return inside(p.kind, dx / p.a, dy / p.b, dz / p.c)
}

export function voxelize(shapes: VShape[], sel = -1): Voxels {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  let anyAdd = false
  for (const s of shapes) {
    if (s.op !== 'add') continue
    anyAdd = true
    const e = extent(s)
    const c = center(s, e)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], c[i] - e[i])
      hi[i] = Math.max(hi[i], c[i] + e[i])
    }
  }
  if (!anyAdd) {
    lo.fill(0)
    hi.fill(0)
  }
  const o = lo.map(Math.ceil)
  const dims = hi.map((h, i) => Math.min(MAX_DIM, Math.max(1, Math.floor(h) - o[i] + 1))) as [number, number, number]
  const [X, Y, Z] = dims
  const grid = new Uint8Array(X * Y * Z)
  const ps = shapes.map(prep)
  const gHi = o.map((v, i) => v + dims[i] - 1)
  for (const p of ps) if (p.k) shellMask(p, o, gHi)
  const counts = new Array<number>(COMP_BLOCKS.length).fill(0)
  const sp = ps[sel] ?? null
  const mark = sp ? new Uint8Array(X * Y * Z) : null
  let total = 0
  let i = 0
  for (let z = 0; z < Z; z++)
    for (let y = 0; y < Y; y++)
      for (let x = 0; x < X; x++, i++) {
        const gx = x + o[0]
        const gy = y + o[1]
        const gz = z + o[2]
        let t = 0
        for (const p of ps) {
          const inn = test(p, gx, gy, gz)
          if (p.op === 0) {
            if (inn && !t) t = p.block
          } else if (p.op === 1) {
            if (inn) t = 0
          } else if (!inn) t = 0
        }
        if (t) {
          grid[i] = t
          if (mark && test(sp!, gx, gy, gz)) mark[i] = 1
          counts[t - 1]++
          total++
        }
      }
  return crop({ grid, dims, counts, total, mark })
}

function crop(v: Voxels): Voxels {
  const [X, Y, Z] = v.dims
  const lo = [X, Y, Z]
  const hi = [-1, -1, -1]
  for (let z = 0, i = 0; z < Z; z++)
    for (let y = 0; y < Y; y++)
      for (let x = 0; x < X; x++, i++) {
        if (!v.grid[i]) continue
        if (x < lo[0]) lo[0] = x
        if (x > hi[0]) hi[0] = x
        if (y < lo[1]) lo[1] = y
        if (y > hi[1]) hi[1] = y
        if (z < lo[2]) lo[2] = z
        if (z > hi[2]) hi[2] = z
      }
  if (hi[0] < 0) return { ...v, grid: new Uint8Array(1), dims: [1, 1, 1], mark: v.mark && new Uint8Array(1) }
  const dims = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1] as [number, number, number]
  if (dims[0] === X && dims[1] === Y && dims[2] === Z) return v
  const [CX, CY, CZ] = dims
  const grid = new Uint8Array(CX * CY * CZ)
  const mark = v.mark && new Uint8Array(CX * CY * CZ)
  for (let z = 0, j = 0; z < CZ; z++)
    for (let y = 0; y < CY; y++) {
      const from = lo[0] + (y + lo[1]) * X + (z + lo[2]) * X * Y
      grid.set(v.grid.subarray(from, from + CX), j)
      if (mark) mark.set(v.mark!.subarray(from, from + CX), j)
      j += CX
    }
  return { grid, dims, counts: v.counts, total: v.total, mark }
}

export type CutSpec = { axis: number; pos: number; mode: 'cut' | 'slice'; flip: boolean; thick: number }

function keeper(cut: CutSpec | null, n: number): (l: number) => boolean {
  if (!cut) return () => true
  const c = Math.round(cut.pos * n)
  const t = cut.thick
  if (cut.mode === 'cut') return cut.flip ? (l) => l >= c : (l) => l < c
  return cut.flip ? (l) => l >= c && l <= c + t - 1 : (l) => l <= c - 1 && l >= c - t
}

export function surfaceInstances(v: Voxels, cut: CutSpec | null = null): { inst: ArrayBuffer; types: Uint8Array; count: number } {
  const [X, Y, Z] = v.dims
  const g = v.grid
  const sx = 1
  const sy = X
  const sz = X * Y
  const ax = cut ? cut.axis : 0
  const kept = keeper(cut, v.dims[ax])
  const L = (x: number, y: number, z: number) => (ax === 0 ? x : ax === 1 ? y : z)
  const solid = (i: number, l: number) => g[i] !== 0 && kept(l)
  let n = 0
  const exposed = (i: number, x: number, y: number, z: number) =>
    x === 0 || y === 0 || z === 0 || x === X - 1 || y === Y - 1 || z === Z - 1 ||
    !solid(i - sx, L(x - 1, y, z)) || !solid(i + sx, L(x + 1, y, z)) ||
    !solid(i - sy, L(x, y - 1, z)) || !solid(i + sy, L(x, y + 1, z)) ||
    !solid(i - sz, L(x, y, z - 1)) || !solid(i + sz, L(x, y, z + 1))
  const emit = (i: number, x: number, y: number, z: number) => g[i] !== 0 && kept(L(x, y, z)) && exposed(i, x, y, z)
  for (let z = 0, i = 0; z < Z; z++) for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++, i++) if (emit(i, x, y, z)) n++
  const buf = new ArrayBuffer(n * 32)
  const f = new Float32Array(buf)
  const types = new Uint8Array(n)
  const color = 191 | (191 << 8) | (191 << 16)
  let w = 0
  for (let z = 0, i = 0; z < Z; z++)
    for (let y = 0; y < Y; y++)
      for (let x = 0; x < X; x++, i++) {
        if (!emit(i, x, y, z)) continue
        types[w] = g[i] - 1
        const o = w++ * 8
        f[o] = x
        f[o + 1] = y
        f[o + 2] = z
        f[o + 3] = 1
        f[o + 4] = 1
        f[o + 5] = 1
        f[o + 6] = color
        f[o + 7] = v.mark?.[i] ? FLAG_SELECTED : 0
      }
  return { inst: buf, types, count: n }
}
