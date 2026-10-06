import { describe, expect, it } from 'vitest'
import { crc32, zipStore } from '../src/util/zip.ts'

describe('zipStore', () => {
  it('computes the standard crc32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes local headers, a central directory and the end record', async () => {
    const files = [
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'b/c.bin', data: new Uint8Array([1, 2, 3]) },
    ]
    const buf = new Uint8Array(await zipStore(files).arrayBuffer())
    const v = new DataView(buf.buffer)
    expect(v.getUint32(0, true)).toBe(0x04034b50)
    const end = buf.length - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50)
    expect(v.getUint16(end + 10, true)).toBe(2)
    const cdOffset = v.getUint32(end + 16, true)
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50)
    expect(v.getUint32(cdOffset + 16, true)).toBe(crc32(files[0].data))
    expect(new TextDecoder().decode(buf.subarray(30, 35))).toBe('a.txt')
  })
})
