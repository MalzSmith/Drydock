const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array, prev = 0): number {
  let c = (prev ^ 0xffffffff) >>> 0
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ZipFile = { name: string; data: Uint8Array | Uint8Array[] }

// Store-only zip; a file given as chunks is written as they are, so a large text never has to be joined first.
export function zipStore(files: ZipFile[]): Blob {
  const enc = new TextEncoder()
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const chunks = Array.isArray(f.data) ? f.data : [f.data]
    let crc = 0
    let size = 0
    for (const c of chunks) {
      crc = crc32(c, crc)
      size += c.length
    }
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, size, true)
    head.setUint32(22, size, true)
    head.setUint16(26, name.length, true)
    parts.push(head.buffer, name as BlobPart, ...(chunks as BlobPart[]))
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, size, true)
    c.setUint32(24, size, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + size
  }
  let size = 0
  for (const c of central) {
    parts.push(c as BlobPart)
    size += c.length
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  parts.push(end.buffer)
  return new Blob(parts, { type: 'application/zip' })
}
