import { describe, expect, it } from 'vitest'
import { animatedWebp, imageChunks } from '../src/util/webp.ts'

function riff(chunks: Array<[string, number[]]>): Uint8Array {
  const body: number[] = [...'WEBP'].map((c) => c.charCodeAt(0))
  for (const [id, data] of chunks) {
    body.push(...[...id].map((c) => c.charCodeAt(0)), data.length & 255, (data.length >> 8) & 255, 0, 0, ...data)
    if (data.length & 1) body.push(0)
  }
  const n = body.length
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, n & 255, (n >> 8) & 255, 0, 0, ...body])
}

const tag = (b: Uint8Array, o: number) => String.fromCharCode(...b.subarray(o, o + 4))
const u24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)

describe('animatedWebp', () => {
  it('keeps only the image chunks of a still frame', () => {
    const f = riff([['VP8X', new Array(10).fill(0)], ['ALPH', [1, 2, 3]], ['VP8 ', [4, 5, 6, 7]], ['EXIF', [9]]])
    expect(imageChunks(f).map((c) => tag(c, 0))).toEqual(['ALPH', 'VP8 '])
    expect(imageChunks(f)[0].length).toBe(12)
  })

  it('rejects files without image data', () => {
    expect(() => imageChunks(new Uint8Array([1, 2, 3]))).toThrow()
    expect(() => imageChunks(riff([['EXIF', [1]]]))).toThrow()
  })

  it('writes a looping animation with one ANMF per frame', async () => {
    const frames = [riff([['VP8 ', [1, 2, 3]]]), riff([['VP8L', [4, 5]]])]
    const b = new Uint8Array(await animatedWebp(frames, 640, 360, 1000 / 24, true).arrayBuffer())
    const v = new DataView(b.buffer)
    expect(tag(b, 0)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(b.length - 8)
    expect(tag(b, 8)).toBe('WEBP')
    expect(tag(b, 12)).toBe('VP8X')
    expect(b[20]).toBe(0x12)
    expect(u24(b, 24)).toBe(639)
    expect(u24(b, 27)).toBe(359)
    expect(tag(b, 30)).toBe('ANIM')
    expect(v.getUint16(42, true)).toBe(0)
    let o = 44
    const kinds: string[] = []
    while (o < b.length) {
      expect(tag(b, o)).toBe('ANMF')
      const size = v.getUint32(o + 4, true)
      expect(u24(b, o + 14)).toBe(639)
      expect(u24(b, o + 17)).toBe(359)
      expect(u24(b, o + 20)).toBe(42)
      kinds.push(tag(b, o + 24))
      o += 8 + size + (size & 1)
    }
    expect(o).toBe(b.length)
    expect(kinds).toEqual(['VP8 ', 'VP8L'])
  })
})
