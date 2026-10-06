import { describe, expect, it } from 'vitest'
import { paintColor, paintRgb24 } from '../src/se/color.ts'

describe('paintColor', () => {
  it('default paint is a grey of value 0.75', () => {
    const [r, g, b] = paintColor(0, -0.8, 0)
    expect(r).toBeCloseTo(0.75)
    expect(g).toBeCloseTo(0.75)
    expect(b).toBeCloseTo(0.75)
  })
  it('white and black extremes clamp', () => {
    expect(paintColor(0, -1, 1).every((c) => Math.abs(c - 1) < 1e-6)).toBe(true)
    expect(paintColor(0, -1, -1).every((c) => c === 0)).toBe(true)
  })
  it('hue 0 saturated is red', () => {
    const [r, g, b] = paintColor(0, 0.2, 0.15)
    expect(r).toBeCloseTo(0.9)
    expect(g).toBeLessThan(0.01)
    expect(b).toBeLessThan(0.01)
  })
  it('packs RGB into 24 bits', () => {
    const p = paintRgb24(0, -0.8, 0)
    expect(p & 255).toBe(191)
    expect((p >> 8) & 255).toBe(191)
    expect(p >> 24).toBe(0)
  })
})
