import { describe, expect, it } from 'vitest'
import { COMP_BLOCKS } from '../src/compose/blocks.ts'
import { MAX_DIM, QUARTER, inShape, rotMul, surfaceInstances, voxelize, type VShape } from '../src/compose/csg.ts'
import { parseBlueprint } from '../src/se/blueprint.ts'
import { estimateSbcBytes, formatBytes, writeSbc } from '../src/se/sbcWrite.ts'

const shape = (o: Partial<VShape>): VShape => ({ op: 'add', type: 'box', size: [5, 5, 5], pos: [0, 0, 0], block: 1, shell: 0, ...o })

describe('torus and pyramid', () => {
  it('makes a ring with a hole and a round tube', () => {
    const t = shape({ type: 'torus', size: [21, 5, 21], tube: 5 })
    expect(inShape(t, 0, 0, 0)).toBe(false)
    expect(inShape(t, 8, 0, 0)).toBe(true)
    expect(inShape(t, 0, 0, -8)).toBe(true)
    expect(inShape(t, 8, 2, 0)).toBe(true)
    expect(inShape(t, 8, 3, 0)).toBe(false)
    expect(inShape(t, 5, 0, 0)).toBe(false)
    const hollow = shape({ type: 'torus', size: [21, 7, 21], tube: 7, shell: 1 })
    expect(inShape(hollow, 7, 0, 0)).toBe(false)
    expect(inShape(hollow, 7, 3, 0)).toBe(true)
  })

  it('tapers a pyramid from a square base to the apex', () => {
    const p = shape({ type: 'pyramid', size: [11, 11, 11] })
    expect(inShape(p, 5, -5, 5)).toBe(true)
    expect(inShape(p, 5, 0, 0)).toBe(false)
    expect(inShape(p, 2, 0, 2)).toBe(true)
    expect(inShape(p, 0, 5, 0)).toBe(true)
    expect(inShape(p, 1, 5, 0)).toBe(false)
  })

  it('turns shapes in 90° steps and grows the bounds to match', () => {
    const down = shape({ type: 'pyramid', size: [11, 11, 11], rot: rotMul(QUARTER.x, QUARTER.x) })
    expect(inShape(down, 0, -5, 0)).toBe(true)
    expect(inShape(down, 1, -5, 0)).toBe(false)
    expect(inShape(down, 5, 5, 5)).toBe(true)
    const side = shape({ type: 'pyramid', size: [11, 11, 11], rot: QUARTER.z })
    expect(inShape(side, -5, 0, 0)).toBe(true)
    expect(inShape(side, 5, 4, 4)).toBe(true)
    const ring = voxelize([shape({ type: 'torus', size: [21, 5, 21], tube: 5, rot: QUARTER.x })])
    expect(ring.dims).toEqual([23, 23, 7])
    expect(rotMul(rotMul(QUARTER.y, QUARTER.y), rotMul(QUARTER.y, QUARTER.y))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })
})

function leaks(s: VShape): { cavity: number; reached: number } {
  const v = voxelize([s])
  const full = voxelize([{ ...s, shell: 0 }])
  const [X, Y, Z] = v.dims
  const seen = new Uint8Array(v.grid.length)
  const stack: number[] = []
  for (let z = 0, i = 0; z < Z; z++)
    for (let y = 0; y < Y; y++)
      for (let x = 0; x < X; x++, i++)
        if ((x === 0 || y === 0 || z === 0 || x === X - 1 || y === Y - 1 || z === Z - 1) && !v.grid[i]) {
          seen[i] = 1
          stack.push(i)
        }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % X
    const y = Math.floor(i / X) % Y
    const z = Math.floor(i / (X * Y))
    for (const [nx, ny, nz] of [[x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1]]) {
      if (nx < 0 || ny < 0 || nz < 0 || nx >= X || ny >= Y || nz >= Z) continue
      const j = nx + X * (ny + Y * nz)
      if (seen[j] || v.grid[j]) continue
      seen[j] = 1
      stack.push(j)
    }
  }
  let cavity = 0
  let reached = 0
  for (let i = 0; i < v.grid.length; i++)
    if (full.grid[i] && !v.grid[i]) {
      cavity++
      if (seen[i]) reached++
    }
  return { cavity, reached }
}

describe('hollow walls', () => {
  it('keeps one-block walls closed on slopes and stretched curves', () => {
    for (const s of [
      shape({ type: 'pyramid', size: [21, 15, 21], shell: 1 }),
      shape({ type: 'pyramid', size: [31, 9, 13], shell: 1, rot: QUARTER.z }),
      shape({ type: 'torus', size: [41, 9, 15], tube: 7, shell: 1 }),
      shape({ type: 'torus', size: [61, 11, 25], tube: 9, shell: 1, rot: QUARTER.x }),
      shape({ type: 'ellipsoid', size: [41, 9, 17], shell: 1 }),
    ]) {
      const r = leaks(s)
      expect(r.cavity).toBeGreaterThan(0)
      expect(r.reached).toBe(0)
    }
  })

  it('flags the surface blocks that belong to the selected shape', () => {
    const shapes = [shape({ size: [5, 5, 5] }), shape({ size: [3, 3, 3], pos: [4, 0, 0], block: 2 })]
    expect(voxelize(shapes).mark).toBeNull()
    const v = voxelize(shapes, 1)
    const s = surfaceInstances(v)
    const f = new Float32Array(s.inst)
    let flagged = 0
    for (let i = 0; i < s.count; i++) if (f[i * 8 + 7] === 16) {
      flagged++
      expect(f[i * 8]).toBeGreaterThanOrEqual(6)
    }
    expect(flagged).toBe(27 - 2)
  })

  it('makes a box wall exactly the requested thickness', () => {
    const v = voxelize([shape({ size: [9, 9, 9], shell: 2 })])
    expect(v.total).toBe(9 ** 3 - 5 ** 3)
  })
})

describe('voxelize', () => {
  it('fills a box and sizes the grid from the add AABBs plus one', () => {
    const v = voxelize([shape({ size: [4, 3, 2] })])
    expect(v.dims).toEqual([5, 5, 3])
    expect(v.total).toBe(v.grid.reduce((n, c) => n + (c ? 1 : 0), 0))
    expect(v.total).toBeGreaterThanOrEqual(4 * 3 * 2)
  })

  it('subtract clears and intersect keeps only the overlap', () => {
    const base = shape({ size: [9, 9, 9] })
    const hole = voxelize([base, shape({ op: 'subtract', size: [3, 3, 3] })])
    const full = voxelize([base])
    expect(hole.total).toBeLessThan(full.total)
    const inter = voxelize([base, shape({ op: 'intersect', type: 'sphere', size: [9, 9, 9] })])
    expect(inter.total).toBeLessThan(full.total)
    expect(inter.total).toBeGreaterThan(0)
  })

  it('evaluates top to bottom', () => {
    const a = voxelize([shape({ size: [5, 5, 5] }), shape({ op: 'subtract', size: [5, 5, 5] })])
    const b = voxelize([shape({ op: 'subtract', size: [5, 5, 5] }), shape({ size: [5, 5, 5] })])
    expect(a.total).toBe(0)
    expect(b.total).toBeGreaterThan(0)
  })

  it('hollows with a wall thickness', () => {
    const solid = voxelize([shape({ type: 'sphere', size: [21, 21, 21] })])
    const shell = voxelize([shape({ type: 'sphere', size: [21, 21, 21], shell: 2 })])
    expect(shell.total).toBeLessThan(solid.total / 2)
    const centre = Math.floor(shell.dims[0] / 2)
    expect(shell.grid[centre + shell.dims[0] * (centre + shell.dims[1] * centre)]).toBe(0)
  })

  it('caps the grid at 160 per axis and maps block types to indices', () => {
    const v = voxelize([shape({ size: [400, 1, 1], block: 2 })])
    expect(v.dims[0]).toBe(MAX_DIM)
    expect(v.counts[COMP_BLOCKS.findIndex((b) => b.t === 2)]).toBe(v.total)
  })

  it('emits only exposed voxels as instances', () => {
    const v = voxelize([shape({ size: [6, 6, 6] })])
    const s = surfaceInstances(v)
    expect(s.count).toBeLessThan(v.total)
    expect(s.inst.byteLength).toBe(s.count * 32)
  })
})

describe('union overlap', () => {
  it('keeps the earlier shape block type where add shapes overlap', () => {
    const a = shape({ size: [5, 5, 5], pos: [0, 0, 0], block: 1 })
    const b = shape({ size: [5, 5, 5], pos: [2, 0, 0], block: 2 })
    const at = (v: ReturnType<typeof voxelize>) => v.grid[4 + v.dims[0] * (3 + v.dims[1] * 3)]
    const ab = voxelize([a, b])
    const ba = voxelize([b, a])
    expect(at(ab)).toBe(1)
    expect(at(ba)).toBe(2)
    expect(ab.total).toBe(ba.total)
  })
})

describe('writeSbc round trip', () => {
  it('writes a blueprint our parser reads back with the same blocks', async () => {
    const v = voxelize([shape({ type: 'ellipsoid', size: [11, 7, 15], shell: 1 }), shape({ size: [3, 3, 3], pos: [0, 5, 0], block: 2 })])
    const text = await writeSbc(v, 'Test <&> Hull', 'Large').text()
    const bp = parseBlueprint(text)
    expect(bp.name).toBe('Test &lt;&amp;&gt; Hull')
    expect(bp.grids.length).toBe(1)
    expect(bp.grids[0].large).toBe(true)
    expect(bp.grids[0].key.length).toBe(v.total)
    const [X, Y] = v.dims
    const cells = new Set<number>()
    for (let i = 0; i < bp.grids[0].key.length; i++) cells.add(bp.grids[0].min[i * 3] + X * (bp.grids[0].min[i * 3 + 1] + Y * bp.grids[0].min[i * 3 + 2]))
    for (let i = 0; i < v.grid.length; i++) expect(cells.has(i)).toBe(v.grid[i] !== 0)
    expect(bp.strings.sort()).toEqual(['CubeBlock/LargeBlockArmorBlock', 'CubeBlock/LargeHeavyBlockArmorBlock'])
  })

  it('refuses Interior Wall on the small grid', () => {
    const v = voxelize([shape({ block: 12 })])
    expect(() => writeSbc(v, 'x', 'Small')).toThrow(/no small-grid variant/)
    expect(() => writeSbc(v, 'x', 'Large')).not.toThrow()
  })
})

describe('estimateSbcBytes', () => {
  it('tracks the real file size', async () => {
    for (const large of [true, false]) {
      const v = voxelize([shape({ type: 'ellipsoid', size: [60, 40, 90], shell: 2 }), shape({ size: [12, 12, 12], pos: [0, 30, 0], block: 2 })])
      const size = large ? 'Large' : 'Small'
      const real = writeSbc(v, 'Estimate Hull', size).size
      const est = estimateSbcBytes(v.counts, v.dims, 'Estimate Hull', size)
      expect(Math.abs(est - real) / real).toBeLessThan(0.01)
    }
  })

  it('formats units', () => {
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.1 * 1024 ** 2)).toBe('3.1 MB')
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.00 GB')
  })
})
