import { describe, expect, it } from 'vitest'
import { shrinkTile } from '../src/render/shrink.ts'

const px = (rows: number[][][]) => new Uint8Array(rows.flat(2))

describe('shrinkTile', () => {
  it('flips rows when not shrinking', () => {
    const out = shrinkTile(px([[[1, 2, 3, 255]], [[4, 5, 6, 255]]]), 1, 2, 1, false)
    expect([...out]).toEqual([4, 5, 6, 255, 1, 2, 3, 255])
  })
  it('box-averages each ss×ss block, bottom-up input to top-down output', () => {
    const a = [0, 0, 0, 255]
    const b = [200, 100, 40, 255]
    const out = shrinkTile(px([[a, a, b, b], [a, a, b, b]]), 4, 2, 2, false)
    expect([...out]).toEqual([0, 0, 0, 255, 200, 100, 40, 255])
    const tall = shrinkTile(px([[b, b], [b, b], [a, a], [a, a]]), 2, 4, 2, false)
    expect([...tall]).toEqual([0, 0, 0, 255, 200, 100, 40, 255])
  })
  it('averages premultiplied pixels before un-premultiplying', () => {
    const red = [255, 0, 0, 255]
    const clear = [0, 0, 0, 0]
    const out = shrinkTile(px([[red, clear], [clear, clear]]), 2, 2, 2, true)
    expect(out[3]).toBe(64)
    expect(out[0]).toBe(255)
    expect(out[1]).toBe(0)
  })
})
