import { modelCandidates } from '../assets/keys.ts'
import type { MeshData, Status } from '../assets/build.ts'
import { FLAG_MODDED, FLAG_PLACEHOLDER, FLAG_SELECTED, FLAG_SHRINK, TOPO_BOX, type DefRecord, type RenderModel, type SideDef, type SkinRecord } from '../se/defs.ts'
import { BASE6_VEC, createWorld } from '../se/orient.ts'
import { TILE_FULL, patternOffset, type TileTable } from '../se/tiles.ts'

export const STRIDE = 31
export const FLAG_BEHIND = 4

export type MeshState = { status: Status | 'pending'; data?: MeshData; key: string }

export type DetailGroup = { mesh: MeshState; skin: SkinRecord | null; inst: Float32Array; count: number; behind: boolean }

export type DetailBox = { grid: number; inst: Float32Array; count: number }

export type DetailScene = {
  groups: DetailGroup[]
  boxes: DetailBox[]
  lines: Float32Array
  used: string[]
  models: number
  pending: number
  missing: number
  uncached: number
}

class Grow {
  a = new Float32Array(1024)
  n = 0
  reserve(k: number) {
    if (this.n + k <= this.a.length) return
    let c = this.a.length * 2
    while (c < this.n + k) c *= 2
    const b = new Float32Array(c)
    b.set(this.a.subarray(0, this.n))
    this.a = b
  }
  done() {
    return this.a.slice(0, this.n)
  }
}

class SegSet {
  keys = new Int32Array(6 * 4096)
  used = new Uint8Array(4096)
  size = 0
  add(k: Int32Array): boolean {
    if ((this.size + 1) * 2 > this.used.length) this.grow()
    const mask = this.used.length - 1
    let h = 0x811c9dc5
    for (let i = 0; i < 6; i++) h = Math.imul(h ^ k[i], 0x01000193)
    h = (h ^ (h >>> 16)) & mask
    const a = this.keys
    for (;;) {
      const o = h * 6
      if (!this.used[h]) {
        this.used[h] = 1
        a.set(k, o)
        this.size++
        return true
      }
      if (a[o] === k[0] && a[o + 1] === k[1] && a[o + 2] === k[2] && a[o + 3] === k[3] && a[o + 4] === k[4] && a[o + 5] === k[5]) return false
      h = (h + 1) & mask
    }
  }
  grow() {
    const keys = this.keys
    const used = this.used
    this.keys = new Int32Array(keys.length * 2)
    this.used = new Uint8Array(used.length * 2)
    this.size = 0
    for (let i = 0; i < used.length; i++) if (used[i]) this.add(keys.subarray(i * 6, i * 6 + 6))
  }
}

const ORIENT: Float32Array[] = []
for (let f = 0; f < 6; f++)
  for (let u = 0; u < 6; u++) {
    const m = createWorld([0, 0, 0], BASE6_VEC[f], BASE6_VEC[u])
    ORIENT.push(new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]))
  }

function mul3(a: ArrayLike<number>, b: ArrayLike<number>, out: Float32Array) {
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
}

const sgn = (v: number) => (v > 1e-6 ? 1 : v < -1e-6 ? -1 : 0)

const cellKey = (x: number, y: number, z: number) => ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768)

const isMod = (d: DefRecord) => d.source !== 'vanilla' && d.source !== 'game'

export type MeshLookup = (cands: string[]) => MeshState

export function buildDetail(model: RenderModel, table: TileTable, lookup: MeshLookup): DetailScene {
  type Group = { mesh: MeshState; skin: SkinRecord | null; buf: Grow; behind: boolean }
  const groups: Group[] = []
  const groupIndex = new Map<string, Map<string, Array<Group | undefined>>>()
  const groupOf = (mesh: MeshState, skin: SkinRecord | null, behind: boolean) => {
    let bySkin = groupIndex.get(mesh.key)
    if (!bySkin) groupIndex.set(mesh.key, (bySkin = new Map()))
    const sub = skin?.sub ?? ''
    let pair = bySkin.get(sub)
    if (!pair) bySkin.set(sub, (pair = [undefined, undefined]))
    let gr = pair[behind ? 1 : 0]
    if (!gr) {
      gr = { mesh, skin, buf: new Grow(), behind }
      pair[behind ? 1 : 0] = gr
      groups.push(gr)
    }
    return gr
  }
  const boxes: DetailBox[] = []
  const lines = new Grow()
  const seen = new SegSet()
  const wv = new Float64Array(6)
  const qk = new Int32Array(6)
  const used = new Map<string, MeshState>()
  const defs = model.defs ?? []
  const skins = model.skins ?? []
  const mc = model.mainCell
  const cmin = model.cellMin
  const tileM = new Float32Array(9)
  const uvo = new Float32Array(2)
  const meshOf = (path: string, def: DefRecord) => {
    const c = modelCandidates(path, isMod(def) ? def.source : null)
    const m = lookup(c)
    used.set(m.key, m)
    return m
  }
  const modelCache = new Map<DefRecord, MeshState>()
  const modelOf = (path: string, def: DefRecord) => {
    let m = modelCache.get(def)
    if (!m) modelCache.set(def, (m = meshOf(path, def)))
    return m
  }
  const sideCache = new Map<DefRecord, { meshes: MeshState[]; pending: boolean; ok: boolean }>()
  const sidesOf = (def: DefRecord, sides: SideDef[], n: number) => {
    let s = sideCache.get(def)
    if (!s) {
      const meshes: MeshState[] = []
      for (let t = 0; t < n; t++) meshes.push(meshOf(sides[t][0], def))
      sideCache.set(def, (s = { meshes, pending: meshes.some((m) => m.status === 'pending'), ok: meshes.every((m) => m.status === 'ok') }))
    }
    return s
  }

  model.grids.forEach((g, gi) => {
    const d = g.detail
    const box = new Float32Array(g.inst)
    if (!d) {
      boxes.push({ grid: gi, inst: box, count: g.count })
      return
    }
    const T = g.toMain
    const cell = g.cell
    const half = cell * 0.5
    const full = new Set<number>()
    for (let i = 0; i < g.count; i++) {
      const di = d.def[i]
      if (di < 0) continue
      const def = defs[di]
      if (def.render?.topo === TOPO_BOX && def.size[0] * def.size[1] * def.size[2] === 1) full.add(cellKey(box[i * 8], box[i * 8 + 1], box[i * 8 + 2]))
    }
    const keepBox = new Float32Array(g.count * 8)
    let nb = 0
    const pushBox = (i: number, shrink: boolean) => {
      keepBox.set(box.subarray(i * 8, i * 8 + 8), nb * 8)
      if (shrink) keepBox[nb * 8 + 7] = (box[i * 8 + 7] | FLAG_SHRINK) & ~FLAG_PLACEHOLDER
      nb++
    }
    const lo = [0, 0, 0]
    const hi = [0, 0, 0]
    const nlo = [0, 0, 0]
    const nhi = [0, 0, 0]
    const point = (o: number, px: number, py: number, pz: number, R: Float32Array, tx: number, ty: number, tz: number) => {
      const x = px * half, y = py * half, z = pz * half
      const lx = x * R[0] + y * R[3] + z * R[6] + tx
      const ly = x * R[1] + y * R[4] + z * R[7] + ty
      const lz = x * R[2] + y * R[5] + z * R[8] + tz
      wv[o] = lx * T[0] + ly * T[4] + lz * T[8] + T[12]
      wv[o + 1] = lx * T[1] + ly * T[5] + lz * T[9] + T[13]
      wv[o + 2] = lx * T[2] + ly * T[6] + lz * T[10] + T[14]
    }
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, R: Float32Array, tx: number, ty: number, tz: number) => {
      point(0, ax, ay, az, R, tx, ty, tz)
      point(3, bx, by, bz, R, tx, ty, tz)
      for (let i = 0; i < 6; i++) qk[i] = Math.round(wv[i] * 1000)
      if (qk[0] > qk[3] || (qk[0] === qk[3] && (qk[1] > qk[4] || (qk[1] === qk[4] && qk[2] > qk[5]))))
        for (let i = 0; i < 3; i++) {
          const t = qk[i]
          qk[i] = qk[i + 3]
          qk[i + 3] = t
        }
      if (!seen.add(qk)) return
      lines.reserve(6)
      lines.a.set(wv, lines.n)
      lines.n += 6
    }
    const emit = (mesh: MeshState, skin: SkinRecord | null, M: ArrayLike<number>, tx: number, ty: number, tz: number, hsv: ArrayLike<number>, ho: number, paint: number, u: number, v: number, flags: number) => {
      const b = groupOf(mesh, skin, (flags & FLAG_BEHIND) !== 0).buf
      b.reserve(STRIDE)
      const o = b.n
      const a = b.a
      for (let r = 0; r < 3; r++) {
        a[o + r * 3] = M[r * 3] * T[0] + M[r * 3 + 1] * T[4] + M[r * 3 + 2] * T[8]
        a[o + r * 3 + 1] = M[r * 3] * T[1] + M[r * 3 + 1] * T[5] + M[r * 3 + 2] * T[9]
        a[o + r * 3 + 2] = M[r * 3] * T[2] + M[r * 3 + 1] * T[6] + M[r * 3 + 2] * T[10]
      }
      a[o + 9] = tx * T[0] + ty * T[4] + tz * T[8] + T[12]
      a[o + 10] = tx * T[1] + ty * T[5] + tz * T[9] + T[13]
      a[o + 11] = tx * T[2] + ty * T[6] + tz * T[10] + T[14]
      a[o + 12] = hsv[ho]
      a[o + 13] = hsv[ho + 1]
      a[o + 14] = hsv[ho + 2]
      a[o + 15] = paint
      a[o + 16] = u
      a[o + 17] = v
      a[o + 18] = lo[0]
      a[o + 19] = lo[1]
      a[o + 20] = lo[2]
      a[o + 21] = hi[0]
      a[o + 22] = hi[1]
      a[o + 23] = hi[2]
      a[o + 24] = flags
      a[o + 25] = nlo[0]
      a[o + 26] = nlo[1]
      a[o + 27] = nlo[2]
      a[o + 28] = nhi[0]
      a[o + 29] = nhi[1]
      a[o + 30] = nhi[2]
      b.n += STRIDE
    }

    for (let i = 0; i < g.count; i++) {
      const o = i * 8
      const di = d.def[i]
      const def = di >= 0 ? defs[di] : null
      const r = def?.render
      if (!def || !r) {
        pushBox(i, !!def)
        continue
      }
      const mx = box[o], my = box[o + 1], mz = box[o + 2]
      const sx = box[o + 3], sy = box[o + 4], sz = box[o + 5]
      const Mx = mx + sx - 1, My = my + sy - 1, Mz = mz + sz - 1
      const paint = box[o + 6]
      const flags = box[o + 7] & (FLAG_MODDED | FLAG_SELECTED)
      const R = ORIENT[d.orient[i]]
      const sk = d.skin[i] ? (skins[d.skin[i] - 1] ?? null) : null
      const key = sk?.hsv ?? d.hsv
      const ko = sk?.hsv ? 0 : i * 3
      const cx = (mx + Mx) * 0.5 * cell, cy = (my + My) * 0.5 * cell, cz = (mz + Mz) * 0.5 * cell
      for (let ax = 0; ax < 3; ax++) {
        const c = cx * T[ax] + cy * T[4 + ax] + cz * T[8 + ax] + T[12 + ax]
        const h = 0.5 * cell * (Math.abs(T[ax]) * sx + Math.abs(T[4 + ax]) * sy + Math.abs(T[8 + ax]) * sz)
        lo[ax] = Math.floor((c - h) / mc + 0.51) - cmin[ax]
        hi[ax] = Math.floor((c + h) / mc - 0.49) - cmin[ax]
      }
      if (r.topo !== undefined && r.sides?.length) {
        const topo = table.topologies[r.topo]
        const U = ORIENT[topo.uniq?.[d.orient[i]] ?? d.orient[i]]
        const n = Math.min(topo.tiles.length, r.sides.length)
        const { meshes, pending, ok } = sidesOf(def, r.sides, n)
        if (!ok) {
          pushBox(i, !pending)
          continue
        }
        for (let x = mx; x <= Mx; x++)
          for (let y = my; y <= My; y++)
            for (let z = mz; z <= Mz; z++) {
              const tx = x * cell, ty = y * cell, tz = z * cell
              const edges = topo.edges
              for (let e = 0; e < edges.length; e++) {
                const a = edges[e][0]
                const b = edges[e][1]
                line(a[0], a[1], a[2], b[0], b[1], b[2], R, tx, ty, tz)
              }
              for (let t = 0; t < n; t++) {
                const tile = topo.tiles[t]
                const tn = tile.n
                const nx = tn[0] * U[0] + tn[1] * U[3] + tn[2] * U[6]
                const ny = tn[0] * U[1] + tn[1] * U[4] + tn[2] * U[7]
                const nz = tn[0] * U[2] + tn[1] * U[5] + tn[2] * U[8]
                let tf = flags
                if (tile.f & TILE_FULL || r.topo === TOPO_BOX) {
                  const ix = Math.round(nx), iy = Math.round(ny), iz = Math.round(nz)
                  if (Math.abs(ix) + Math.abs(iy) + Math.abs(iz) === 1 && full.has(cellKey(x + ix, y + iy, z + iz))) {
                    tf |= FLAG_BEHIND
                    const qx = (x + ix) * cell, qy = (y + iy) * cell, qz = (z + iz) * cell
                    for (let ax = 0; ax < 3; ax++) {
                      const c = qx * T[ax] + qy * T[4 + ax] + qz * T[8 + ax] + T[12 + ax]
                      const h = 0.5 * cell * (Math.abs(T[ax]) + Math.abs(T[4 + ax]) + Math.abs(T[8 + ax]))
                      nlo[ax] = Math.floor((c - h) / mc + 0.51) - cmin[ax]
                      nhi[ax] = Math.floor((c + h) / mc - 0.49) - cmin[ax]
                    }
                  }
                }
                const m = meshes[t]
                let fixed: number[] | null = null
                const fixes = tile.id ? table.grid[tile.id] : undefined
                if (fixes) {
                  const snx = sgn(nx), sny = sgn(ny), snz = sgn(nz)
                  for (let k = 0; k < fixes.length; k++)
                    if (fixes[k].s[0] === snx && fixes[k].s[1] === sny && fixes[k].s[2] === snz) {
                      fixed = fixes[k].m
                      break
                    }
                }
                if (fixed) for (let k = 0; k < 9; k++) tileM[k] = fixed[k]
                else mul3(tile.m, U, tileM)
                const side = r.sides[t]
                patternOffset(r.topo, tile, nx, ny, nz, x, y, z, side[1], side[2], side[3], side[4], m.data!.patternScale, uvo, 0)
                emit(m, sk, tileM, tx, ty, tz, key, ko, paint, uvo[0], uvo[1], tf)
              }
            }
        continue
      }
      if (!r.model) {
        pushBox(i, true)
        continue
      }
      const m = modelOf(r.model, def)
      if (m.status !== 'ok') {
        pushBox(i, m.status !== 'pending')
        continue
      }
      const off = r.offset ?? [0, 0, 0]
      emit(
        m,
        sk,
        R,
        cx + off[0] * R[0] + off[1] * R[3] + off[2] * R[6],
        cy + off[0] * R[1] + off[1] * R[4] + off[2] * R[7],
        cz + off[0] * R[2] + off[1] * R[5] + off[2] * R[8],
        key,
        ko,
        paint,
        0,
        0,
        flags,
      )
    }
    if (nb) boxes.push({ grid: gi, inst: keepBox.slice(0, nb * 8), count: nb })
  })

  let pending = 0
  let missing = 0
  let uncached = 0
  for (const m of used.values()) {
    if (m.status === 'pending') pending++
    else if (m.status === 'uncached') uncached++
    else if (m.status !== 'ok') missing++
  }
  return {
    groups: groups.map((g) => ({ mesh: g.mesh, skin: g.skin, inst: g.buf.done(), count: g.buf.n / STRIDE, behind: g.behind })),
    boxes,
    lines: lines.done(),
    used: [...used.keys()],
    models: used.size,
    pending,
    missing,
    uncached,
  }
}
