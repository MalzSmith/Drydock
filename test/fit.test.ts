import { describe, expect, it } from 'vitest'
import { centerOfMass, computeFit, FIT_FILL, FOV } from '../src/render/camera.ts'
import { identity } from '../src/se/orient.ts'

const grid = (blocks: Array<[number, number, number]>) => {
  const f = new Float32Array(blocks.length * 8)
  blocks.forEach(([x, y, z], i) => f.set([x, y, z, 1, 1, 1, 0, 0], i * 8))
  return { cell: 2.5, toMain: identity(), inst: f, count: blocks.length }
}

describe('computeFit', () => {
  it('fills the limiting dimension of a long front view to the target ratio', () => {
    const g = grid(Array.from({ length: 40 }, (_, i) => [i, 0, 0] as [number, number, number]))
    const fit = computeFit(Math.PI, 0, [g], [48.75, 0, 0], 16 / 9)
    const halfWidth = 20 * 2.5
    expect(fit.half).toBeCloseTo(halfWidth / (16 / 9) / FIT_FILL, 1)
    const tan = Math.tan((FOV * Math.PI) / 360)
    expect(fit.dist).toBeGreaterThan(halfWidth / (tan * (16 / 9) * FIT_FILL))
  })

  it('is symmetric for a centred cube', () => {
    const g = grid([[0, 0, 0]])
    const a = computeFit(0.3, 0.2, [g], [0, 0, 0], 1)
    const b = computeFit(-0.3, -0.2, [g], [0, 0, 0], 1)
    expect(a.half).toBeCloseTo(b.half, 3)
  })
})

describe('centerOfMass', () => {
  it('weights every block equally, so a long thin arm barely moves it', () => {
    const body = Array.from({ length: 27 }, (_, i) => [i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9)] as [number, number, number])
    const arm = Array.from({ length: 3 }, (_, i) => [3 + i * 10, 1, 1] as [number, number, number])
    const c = centerOfMass([grid([...body, ...arm])])
    expect(c[0]).toBeCloseTo(((27 * 1 + 3 + 13 + 23) / 30) * 2.5, 4)
    expect(c[1]).toBeCloseTo(2.5, 4)
    expect(c[2]).toBeCloseTo(2.5, 4)
  })

  it('uses the block centre of multi-cell blocks and the grid transform', () => {
    const f = new Float32Array([0, 0, 0, 3, 1, 1, 0, 0])
    const m = identity()
    m[12] = 10
    expect(centerOfMass([{ cell: 0.5, toMain: m, inst: f, count: 1 }])).toEqual([10.5, 0, 0])
  })
})
