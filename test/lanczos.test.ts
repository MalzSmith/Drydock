import { describe, expect, it } from 'vitest'
import { lanczosApron, tilePlan } from '../src/render/lanczos.ts'

describe('tilePlan', () => {
  it('keeps the rendered tile, apron included, within the max tile size', () => {
    for (const ss of [1, 2, 4, 8]) {
      const p = tilePlan(61440, ss, 4096)
      expect(p.apron).toBe(lanczosApron(ss))
      expect(p.apron).toBeGreaterThanOrEqual(3 * ss + 1)
      expect(p.tw).toBe(p.ow * ss + 2 * p.apron)
      expect(p.th).toBe(p.oh * ss + 2 * p.apron)
      expect(p.tw).toBeLessThanOrEqual(4096)
      expect(p.th).toBeLessThanOrEqual(4096)
    }
  })

  it('caps a band of output rows at 128 MB', () => {
    const p = tilePlan(80640, 1, 4096)
    expect(80640 * p.oh * 4).toBeLessThanOrEqual(128 << 20)
    expect(p.oh).toBeGreaterThan(300)
  })

  it('never makes a tile wider than the image', () => {
    expect(tilePlan(100, 2, 4096).ow).toBe(100)
  })
})
