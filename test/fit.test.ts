import { describe, expect, it } from 'vitest'
import { computeFit, FIT_FILL, FOV } from '../src/render/camera.ts'
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
