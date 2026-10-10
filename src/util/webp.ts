const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

function put24(v: DataView, o: number, n: number) {
  v.setUint8(o, n & 255)
  v.setUint8(o + 1, (n >> 8) & 255)
  v.setUint8(o + 2, (n >> 16) & 255)
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length & 1))
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i)
  new DataView(out.buffer).setUint32(4, body.length, true)
  out.set(body, 8)
  return out
}

export function imageChunks(file: Uint8Array): Uint8Array[] {
  if (file.length < 12 || tag(file, 0) !== 'RIFF' || tag(file, 8) !== 'WEBP') throw new Error('not a WebP file')
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const out: Uint8Array[] = []
  let o = 12
  while (o + 8 <= file.length) {
    const id = tag(file, o)
    const size = v.getUint32(o + 4, true)
    const end = o + 8 + size + (size & 1)
    if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') out.push(file.subarray(o, Math.min(end, file.length)))
    o = end
  }
  if (!out.some((c) => tag(c, 0) !== 'ALPH')) throw new Error('WebP file has no image data')
  return out
}

export function animatedWebp(frames: Uint8Array[], w: number, h: number, frameMs: number, alpha: boolean): Blob {
  const head = new Uint8Array(10)
  const hv = new DataView(head.buffer)
  hv.setUint8(0, 0x02 | (alpha ? 0x10 : 0))
  put24(hv, 4, w - 1)
  put24(hv, 7, h - 1)
  const anim = new Uint8Array(6)
  const parts: Uint8Array[] = [chunk('VP8X', head), chunk('ANIM', anim)]
  for (const f of frames) {
    const data = imageChunks(f)
    const len = data.reduce((n, c) => n + c.length, 0)
    const body = new Uint8Array(16 + len)
    const bv = new DataView(body.buffer)
    put24(bv, 6, w - 1)
    put24(bv, 9, h - 1)
    put24(bv, 12, Math.round(frameMs))
    bv.setUint8(15, 0x02)
    let o = 16
    for (const c of data) {
      body.set(c, o)
      o += c.length
    }
    parts.push(chunk('ANMF', body))
  }
  const size = 4 + parts.reduce((n, c) => n + c.length, 0)
  const riff = new Uint8Array(12)
  riff.set([0x52, 0x49, 0x46, 0x46])
  new DataView(riff.buffer).setUint32(4, size, true)
  riff.set([0x57, 0x45, 0x42, 0x50], 8)
  return new Blob([riff, ...parts] as BlobPart[], { type: 'image/webp' })
}
