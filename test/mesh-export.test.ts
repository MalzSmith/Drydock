import { describe, expect, it } from 'vitest'
import table from '../src/data/tile-table.json'
import type { MeshData } from '../src/assets/build.ts'
import { KIND_DECAL, KIND_FIXED, KIND_GLASS, KIND_LIGHT, KIND_PAINT } from '../src/assets/material.ts'
import { FLAG_PLACEHOLDER, TOPO_BOX, type DefRecord, type RenderModel } from '../src/se/defs.ts'
import { identity } from '../src/se/orient.ts'
import type { TileTable } from '../src/se/tiles.ts'
import { bakeChunks, bakeStats, keptRange, type BakeInput, type Chunk, type Section } from '../src/render/bake.ts'
import { buildDetail, type MeshState } from '../src/render/detail.ts'
import { stlWriter } from '../src/util/stl.ts'
import { objWriter } from '../src/util/obj.ts'
import { crc32, zipStore } from '../src/util/zip.ts'

// A unit quad in the XY plane facing +Z, wound clockwise on purpose so the bake has to fix it.
const quad: MeshData = {
  pos: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  nrm: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uv: new Float32Array(8),
  idx: new Uint32Array([0, 2, 1, 0, 3, 2]),
  parts: [{ start: 0, count: 6, kind: KIND_PAINT, color: [0, 0, 0], material: 'Plate', technique: 'MESH', tex: null }],
  min: [0, 0, 0],
  max: [1, 1, 0],
  patternScale: 1,
  tris: 2,
}

const multi: MeshData = {
  pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0, 6, 0, 0, 7, 0, 0, 6, 1, 0]),
  nrm: new Float32Array(36),
  uv: new Float32Array(24),
  idx: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  parts: [
    { start: 0, count: 3, kind: KIND_PAINT, color: [0, 0, 0], material: 'Plate', technique: 'MESH', tex: null },
    { start: 3, count: 3, kind: KIND_FIXED, color: [0.86, 0.66, 0.12], material: 'Yellow', technique: 'MESH', tex: null },
    { start: 6, count: 3, kind: KIND_DECAL, color: [0, 0, 0], material: 'Decal', technique: 'DECAL', tex: null },
    { start: 9, count: 3, kind: KIND_LIGHT, color: [0, 0, 0], material: 'Emissive', technique: 'MESH', tex: null },
  ],
  min: [0, 0, 0],
  max: [7, 1, 0],
  patternScale: 1,
  tris: 4,
}

const armor: DefRecord = {
  type: 'CubeBlock',
  subtype: 'LargeBlockArmorBlock',
  large: true,
  size: [1, 1, 1],
  name: 'Light Armor Block',
  source: 'game',
  render: { topo: TOPO_BOX, sides: Array.from({ length: 6 }, () => ['models/plate.mwm', 4, 2, 1, 1] as [string, number, number, number, number]) },
}
const battery: DefRecord = { type: 'BatteryBlock', subtype: 'LargeBlockBatteryBlock', large: true, size: [1, 1, 1], name: 'Battery', source: 'game', render: { model: 'models/battery.mwm' } }

const RED = 255
const BLUE = 255 << 16

function model(cells: Array<[number, number, number, number, number?, number?]>, defs: DefRecord[]): RenderModel {
  const n = cells.length
  const inst = new Float32Array(n * 8)
  const def = new Int32Array(n)
  cells.forEach(([x, y, z, d, paint = RED, flags = 0], i) => {
    inst.set([x, y, z, 1, 1, 1, paint, flags], i * 8)
    def[i] = d
  })
  return {
    name: 't',
    gridLarge: true,
    dims: [3, 1, 1],
    lengthM: 7.5,
    cellMin: [0, 0, 0],
    mainCell: 2.5,
    blockCount: n,
    boundsMin: [0, 0, 0],
    boundsMax: [7.5, 2.5, 2.5],
    grids: [{ cell: 2.5, toMain: identity(), inst: inst.buffer, count: n, detail: { def, orient: new Uint8Array(n).fill(4), hsv: new Float32Array(n * 3), skin: new Uint16Array(n) } }],
    defs,
    skins: [],
  }
}

const lookup = (mesh: MeshData) => (c: string[]): MeshState => ({ status: 'ok', key: c.join('|'), data: mesh })

const off: Section = { on: false, axis: 0, cut: 0, mode: 'cut', flip: false, thick: 1 }

function all(input: BakeInput): Chunk[] {
  return [...bakeChunks(input)]
}

const tris = (chunks: Chunk[]) => chunks.reduce((n, c) => n + c.idx.length / 3, 0)

function faceNormal(c: Chunk, t: number): [number, number, number] {
  const a = c.idx[t * 3] * 3, b = c.idx[t * 3 + 1] * 3, d = c.idx[t * 3 + 2] * 3
  const ux = c.pos[b] - c.pos[a], uy = c.pos[b + 1] - c.pos[a + 1], uz = c.pos[b + 2] - c.pos[a + 2]
  const vx = c.pos[d] - c.pos[a], vy = c.pos[d + 1] - c.pos[a + 1], vz = c.pos[d + 2] - c.pos[a + 2]
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}

describe('bake', () => {
  it('counts and emits the visible armor tiles of two cubes', () => {
    const m = model([[0, 0, 0, 0], [1, 0, 0, 0]], [armor])
    const scene = buildDetail(m, table as unknown as TileTable, lookup(quad))
    const input = { model: m, scene, section: off }
    const stats = bakeStats(input)
    expect(stats.tris).toBe(20)
    expect(stats.verts).toBe(40)
    const chunks = all(input)
    expect(tris(chunks)).toBe(20)
    expect(chunks.every((c) => c.mat.key === `${KIND_PAINT}:ff0000`)).toBe(true)
  })

  it('keeps the winding in line with the vertex normals, also on mirrored tiles', () => {
    const m = model([[0, 0, 0, 0]], [armor])
    const scene = buildDetail(m, table as unknown as TileTable, lookup(quad))
    const chunks = all({ model: m, scene, section: off })
    for (const c of chunks)
      for (let t = 0; t < c.idx.length / 3; t++) {
        const n = faceNormal(c, t)
        const v = c.idx[t * 3] * 3
        expect(n[0] * c.nrm[v] + n[1] * c.nrm[v + 1] + n[2] * c.nrm[v + 2]).toBeGreaterThan(0)
      }
  })

  it('applies the section and brings back the faces between cut cubes', () => {
    const m = model([[0, 0, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0]], [armor])
    const scene = buildDetail(m, table as unknown as TileTable, lookup(quad))
    const cut = { ...off, on: true, axis: 0, cut: 2 }
    expect(bakeStats({ model: m, scene, section: cut }).tris).toBe(20)
    const slice = { ...off, on: true, axis: 0, cut: 2, mode: 'slice' as const, thick: 1 }
    expect(bakeStats({ model: m, scene, section: slice }).tris).toBe(12)
  })

  it('splits paint and fixed parts into materials and drops decals', () => {
    const m = model([[0, 0, 0, 0, RED], [1, 0, 0, 0, BLUE]], [battery])
    const scene = buildDetail(m, table as unknown as TileTable, lookup(multi))
    const chunks = all({ model: m, scene, section: off })
    const keys = chunks.map((c) => c.mat.key).sort()
    expect(keys).toEqual([`${KIND_PAINT}:0000ff`, `${KIND_PAINT}:ff0000`, `${KIND_FIXED}:dba81f`, `${KIND_LIGHT}:f2ebc7`])
    expect(tris(chunks)).toBe(6)
    expect(chunks.find((c) => c.mat.kind === KIND_LIGHT)!.idx.length / 3).toBe(2)
  })

  it('exports boxes when no model is loaded, placeholders in magenta', () => {
    const m = model([[0, 0, 0, 0, RED], [1, 0, 0, -1, BLUE, FLAG_PLACEHOLDER]], [battery])
    const chunks = all({ model: m, scene: null, section: off })
    expect(tris(chunks)).toBe(24)
    const ph = chunks.find((c) => c.mat.key === `${KIND_PAINT}:ff2bd6`)!
    expect(ph.pos.length / 3).toBe(24)
    expect(Math.min(...ph.pos.filter((_, i) => i % 3 === 0))).toBeCloseTo(1.25)
    expect(Math.max(...ph.pos.filter((_, i) => i % 3 === 0))).toBeCloseTo(3.75)
    const cut = { ...off, on: true, axis: 0, cut: 1 }
    expect(bakeStats({ model: m, scene: null, section: cut }).tris).toBe(12)
  })

  it('matches the shader section test', () => {
    expect(keptRange(0, 0, { ...off, on: true, cut: 1 })).toBe(true)
    expect(keptRange(1, 1, { ...off, on: true, cut: 1 })).toBe(false)
    expect(keptRange(1, 1, { ...off, on: true, cut: 1, flip: true })).toBe(true)
    expect(keptRange(3, 3, { ...off, on: true, cut: 4, mode: 'slice', thick: 2 })).toBe(true)
    expect(keptRange(1, 1, { ...off, on: true, cut: 4, mode: 'slice', thick: 2 })).toBe(false)
  })
})

describe('stlWriter', () => {
  it('writes the header, count and per-triangle records, turned to Z up', async () => {
    const w = stlWriter()
    w.add(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]))
    const buf = new Uint8Array(await w.finish().arrayBuffer())
    expect(buf.length).toBe(84 + 50)
    const v = new DataView(buf.buffer)
    expect(v.getUint32(80, true)).toBe(1)
    expect([v.getFloat32(84, true), v.getFloat32(88, true), v.getFloat32(92, true)]).toEqual([0, -1, 0])
    expect(v.getFloat32(96 + 12, true)).toBe(1)
    expect(v.getFloat32(96 + 24 + 8, true)).toBe(1)
    expect(v.getUint16(84 + 48, true)).toBe(0)
  })
})

describe('objWriter', () => {
  it('writes vertices, normals, faces and the materials', () => {
    const w = objWriter('ship.mtl')
    const mat = { key: '0:ff0000', kind: KIND_PAINT, rgb: [1, 0, 0] as [number, number, number] }
    w.add(mat, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), new Uint32Array([0, 1, 2]))
    w.add({ key: '1:99bdd6', kind: KIND_GLASS, rgb: [0.6, 0.74, 0.84] }, new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]), new Float32Array(9), new Uint32Array([0, 1, 2]))
    const { obj, mtl } = w.finish()
    const text = obj.map((c) => new TextDecoder().decode(c)).join('')
    expect(text).toContain('mtllib ship.mtl')
    expect(text).toContain('usemtl 0:ff0000\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1')
    expect(text).toContain('f 1//1 2//2 3//3')
    expect(text).toContain('usemtl 1:99bdd6')
    expect(text).toContain('f 4//4 5//5 6//6')
    const m = new TextDecoder().decode(mtl)
    expect(m).toContain('newmtl 0:ff0000\nKd 1 0 0')
    expect(m).toContain('newmtl 1:99bdd6\nKd 0.6 0.74 0.84')
    expect(m).toContain('d 0.5')
  })
})

describe('zipStore chunks', () => {
  it('stores a chunked file with one crc and size', async () => {
    const a = new TextEncoder().encode('hello ')
    const b = new TextEncoder().encode('world')
    const buf = new Uint8Array(await zipStore([{ name: 'x.txt', data: [a, b] }]).arrayBuffer())
    const v = new DataView(buf.buffer)
    expect(v.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('hello world')))
    expect(v.getUint32(18, true)).toBe(11)
    expect(new TextDecoder().decode(buf.subarray(35, 46))).toBe('hello world')
  })
})
