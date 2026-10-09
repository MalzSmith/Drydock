import { describe, expect, it } from 'vitest'
import { QUARTER, voxelize, type VShape } from '../src/compose/csg.ts'
import { parseBlueprint } from '../src/se/blueprint.ts'
import { writeSbc } from '../src/se/sbcWrite.ts'

const shape = (o: Partial<VShape>): VShape => ({ op: 'add', type: 'box', size: [5, 5, 5], pos: [0, 0, 0], block: 1, shell: 0, ...o })

async function roundTrip(shapes: VShape[], grid: 'Large' | 'Small' = 'Large') {
  const v = voxelize(shapes)
  const bp = parseBlueprint(await writeSbc(v, 'Round Trip', grid).text())
  const g = bp.grids[0]
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < g.key.length; i++)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], g.min[i * 3 + a])
      hi[a] = Math.max(hi[a], g.min[i * 3 + a])
    }
  return { v, bp, blocks: g.key.length, size: hi.map((h, a) => h - lo[a] + 1) }
}

const SIZES: Array<[number, number, number]> = [
  [1, 1, 1],
  [2, 2, 2],
  [3, 3, 3],
  [8, 8, 8],
  [10, 10, 10],
  [20, 20, 20],
  [21, 21, 21],
  [20, 11, 8],
  [7, 12, 15],
]

describe('composed shapes survive export and import', () => {
  for (const size of SIZES)
    it(`places exactly ${size.join('×')} blocks for a box of that size`, async () => {
      const r = await roundTrip([shape({ size })])
      expect(r.size).toEqual(size)
      expect(r.blocks).toBe(size[0] * size[1] * size[2])
      expect(r.blocks).toBe(r.v.total)
      expect(r.v.dims).toEqual(size)
    })

  for (const type of ['sphere', 'ellipsoid', 'cylinder', 'pyramid'] as const)
    for (const size of SIZES)
      it(`keeps a ${type} of ${size.join('×')} inside and spanning its size`, async () => {
        const r = await roundTrip([shape({ type, size })])
        expect(r.size).toEqual(size)
        expect(r.v.dims).toEqual(size)
        expect(r.blocks).toBe(r.v.total)
        expect(r.blocks).toBeLessThanOrEqual(size[0] * size[1] * size[2])
      })

  for (const size of [[21, 5, 21], [20, 6, 20], [30, 8, 16]] as Array<[number, number, number]>)
    it(`keeps a torus of ${size.join('×')} spanning its size`, async () => {
      const r = await roundTrip([shape({ type: 'torus', size, tube: size[1] })])
      expect(r.size).toEqual(size)
      expect(r.blocks).toBe(r.v.total)
    })

  it('swaps the spanned axes of a quarter-turned shape', async () => {
    const r = await roundTrip([shape({ type: 'cylinder', size: [10, 7, 16], rot: QUARTER.x })])
    expect(r.size).toEqual([10, 16, 7])
    const t = await roundTrip([shape({ type: 'torus', size: [20, 6, 20], tube: 6, rot: QUARTER.z })])
    expect(t.size).toEqual([6, 20, 20])
  })

  it('keeps even and odd boxes the same size away from the origin', async () => {
    for (const pos of [[3, -7, 11], [-40, 0, 25]] as Array<[number, number, number]>) {
      const r = await roundTrip([shape({ size: [20, 9, 14], pos })])
      expect(r.size).toEqual([20, 9, 14])
      expect(r.blocks).toBe(20 * 9 * 14)
    }
  })

  it('cuts an exact hole and keeps a hollow wall count', async () => {
    const hole = await roundTrip([shape({ size: [20, 20, 20] }), shape({ op: 'subtract', size: [10, 10, 10] })])
    expect(hole.blocks).toBe(20 ** 3 - 10 ** 3)
    const shell = await roundTrip([shape({ size: [20, 20, 20], shell: 2 })])
    expect(shell.blocks).toBe(20 ** 3 - 16 ** 3)
    expect(shell.size).toEqual([20, 20, 20])
  })

  it('counts mixed block types and both grid sizes the same way', async () => {
    const shapes = [shape({ size: [12, 6, 12], block: 2 }), shape({ size: [6, 6, 6], pos: [0, 9, 0], block: 1 })]
    const large = await roundTrip(shapes, 'Large')
    const small = await roundTrip(shapes, 'Small')
    expect(large.blocks).toBe(12 * 6 * 12 + 6 * 6 * 6)
    expect(small.blocks).toBe(large.blocks)
    expect(large.bp.grids[0].large).toBe(true)
    expect(small.bp.grids[0].large).toBe(false)
    expect(large.v.counts).toEqual([6 * 6 * 6, 12 * 6 * 12, 0])
  })
})
