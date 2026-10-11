import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32 } from '../src/util/zip.ts'
import { pngStream } from '../src/util/png.ts'

function chunks(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: Array<{ type: string; data: Uint8Array; crcOk: boolean }> = []
  for (let o = 8; o < buf.length; ) {
    const len = v.getUint32(o)
    const type = String.fromCharCode(...buf.subarray(o + 4, o + 8))
    const data = buf.subarray(o + 8, o + 8 + len)
    out.push({ type, data, crcOk: crc32(buf.subarray(o + 4, o + 8 + len)) === v.getUint32(o + 8 + len) })
    o += 12 + len
  }
  return out
}

function unfilter(raw: Uint8Array, w: number, h: number, ch: number): Uint8Array {
  const stride = w * ch
  const out = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]
      const a = i >= ch ? out[y * stride + i - ch] : 0
      const b = y > 0 ? out[(y - 1) * stride + i] : 0
      const c = i >= ch && y > 0 ? out[(y - 1) * stride + i - ch] : 0
      const p = a + b - c
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      out[y * stride + i] = (x + pred) & 255
    }
  }
  return out
}

function image(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  let s = 12345
  for (let i = 0; i < px.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0
    px[i] = (s >>> 16) & 255
  }
  return px
}

async function encode(px: Uint8Array, w: number, h: number, alpha: boolean, bands: number[]) {
  const png = pngStream(w, h, alpha)
  let y = 0
  for (const rows of bands) {
    await png.rows(px.subarray(y * w * 4, (y + rows) * w * 4), rows)
    y += rows
  }
  return new Uint8Array(await (await png.finish()).arrayBuffer())
}

describe('pngStream', () => {
  it('writes a valid RGBA PNG across several bands', async () => {
    const w = 37
    const h = 23
    const px = image(w, h)
    const buf = await encode(px, w, h, true, [5, 1, 17])
    expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const cs = chunks(buf)
    expect(cs.every((c) => c.crcOk)).toBe(true)
    expect(cs[0].type).toBe('IHDR')
    expect(cs.at(-1)!.type).toBe('IEND')
    const ihdr = new DataView(cs[0].data.buffer, cs[0].data.byteOffset)
    expect([ihdr.getUint32(0), ihdr.getUint32(4), cs[0].data[8], cs[0].data[9]]).toEqual([w, h, 8, 6])
    const idat = Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data))
    expect([...unfilter(inflateSync(idat), w, h, 4)]).toEqual([...px])
  })

  it('drops alpha for opaque images', async () => {
    const w = 9
    const h = 4
    const px = image(w, h)
    const cs = chunks(await encode(px, w, h, false, [4]))
    expect(cs[0].data[9]).toBe(2)
    const rgb = unfilter(inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data))), w, h, 3)
    expect([...rgb]).toEqual([...px].filter((_, i) => i % 4 !== 3))
  })

  it('refuses a short image', async () => {
    const png = pngStream(2, 3, true)
    await png.rows(new Uint8Array(2 * 2 * 4), 2)
    await expect(png.finish()).rejects.toThrow()
  })
})
