import { crc32 } from './zip.ts'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const IDAT_BYTES = 1 << 20
const BLOB_BYTES = 64 << 20

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

export function pngHead(w: number, h: number, alpha: boolean): Uint8Array {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, w)
  v.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = alpha ? 6 : 2
  const chunk = pngChunk('IHDR', ihdr)
  const out = new Uint8Array(SIGNATURE.length + chunk.length)
  out.set(SIGNATURE)
  out.set(chunk, SIGNATURE.length)
  return out
}

export function scanlines(rgba: Uint8Array, w: number, rows: number, alpha: boolean, prev: Uint8Array): Uint8Array {
  const ch = alpha ? 4 : 3
  const stride = w * ch
  const out = new Uint8Array(rows * (stride + 1))
  const cur = new Uint8Array(stride)
  for (let y = 0; y < rows; y++) {
    let s = y * w * 4
    if (alpha) cur.set(rgba.subarray(s, s + stride))
    else
      for (let i = 0; i < stride; i += 3, s += 4) {
        cur[i] = rgba[s]
        cur[i + 1] = rgba[s + 1]
        cur[i + 2] = rgba[s + 2]
      }
    let o = y * (stride + 1)
    out[o++] = 4
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      const pa = Math.abs(b - c)
      const pb = Math.abs(a - c)
      const pc = Math.abs(a + b - 2 * c)
      out[o++] = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
    }
    prev.set(cur)
  }
  return out
}

export type PngStream = {
  rows(rgba: Uint8Array, rows: number): Promise<void>
  finish(): Promise<Blob>
  abort(): void
}

export function pngStream(w: number, h: number, alpha: boolean): PngStream {
  const deflate = new CompressionStream('deflate')
  const writer = deflate.writable.getWriter()
  const prev = new Uint8Array(w * (alpha ? 4 : 3))
  const blobs: Blob[] = [new Blob([pngHead(w, h, alpha) as BlobPart])]
  let parts: BlobPart[] = []
  let partBytes = 0
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let written = 0

  const idat = () => {
    if (!pendingBytes) return
    const data = new Uint8Array(pendingBytes)
    let o = 0
    for (const p of pending) {
      data.set(p, o)
      o += p.length
    }
    pending = []
    pendingBytes = 0
    parts.push(pngChunk('IDAT', data) as BlobPart)
    partBytes += data.length + 12
    if (partBytes >= BLOB_BYTES) fold()
  }
  const fold = () => {
    blobs.push(new Blob(parts))
    parts = []
    partBytes = 0
  }

  const drained = (async () => {
    const reader = deflate.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending.push(value)
      pendingBytes += value.length
      if (pendingBytes >= IDAT_BYTES) idat()
    }
    idat()
    fold()
  })()
  drained.catch(() => {})

  return {
    async rows(rgba, rows) {
      written += rows
      if (written > h) throw new Error(`PNG got ${written} of ${h} rows`)
      await writer.write(scanlines(rgba, w, rows, alpha, prev) as Uint8Array<ArrayBuffer>)
    },
    async finish() {
      if (written !== h) throw new Error(`PNG got ${written} of ${h} rows`)
      await writer.close()
      await drained
      blobs.push(new Blob([pngChunk('IEND', new Uint8Array(0)) as BlobPart]))
      return new Blob(blobs, { type: 'image/png' })
    },
    abort() {
      writer.abort().catch(() => {})
    },
  }
}
