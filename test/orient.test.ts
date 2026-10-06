import { describe, expect, it } from 'vitest'
import { createWorld, invertRigid, mul, rotatedExtent, transformPoint } from '../src/se/orient.ts'

describe('rotatedExtent', () => {
  const ext = new Int32Array(3)
  it('keeps size for identity orientation', () => {
    rotatedExtent(2, 3, 4, 0 * 6 + 4, ext)
    expect(Array.from(ext)).toEqual([2, 3, 4])
  })
  it('swaps x and z for a 90 degree yaw (Forward=Left)', () => {
    rotatedExtent(2, 3, 4, 2 * 6 + 4, ext)
    expect(Array.from(ext)).toEqual([4, 3, 2])
  })
  it('swaps y and z when Forward=Up, Up=Backward', () => {
    rotatedExtent(2, 3, 4, 4 * 6 + 1, ext)
    expect(Array.from(ext)).toEqual([2, 4, 3])
  })
  it('falls back to identity for parallel forward/up', () => {
    rotatedExtent(2, 3, 4, 4 * 6 + 5, ext)
    expect(Array.from(ext)).toEqual([2, 3, 4])
  })
})

describe('matrices', () => {
  it('createWorld with default axes is a translation', () => {
    const m = createWorld([1, 2, 3], [0, 0, -1], [0, 1, 0])
    expect(Array.from(transformPoint(m, 1, 1, 1))).toEqual([2, 3, 4])
  })
  it('invertRigid undoes a rotated world', () => {
    const w = createWorld([5, -3, 9], [-0.576, 0.591, -0.564], [0.135, -0.612, -0.779])
    const p = transformPoint(mul(w, invertRigid(w)), 3, 4, 5)
    expect(p[0]).toBeCloseTo(3, 3)
    expect(p[1]).toBeCloseTo(4, 3)
    expect(p[2]).toBeCloseTo(5, 3)
  })
})
