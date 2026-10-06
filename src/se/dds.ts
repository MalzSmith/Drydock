export type DdsFormat = 'bc1' | 'bc2' | 'bc3' | 'bc4' | 'bc5' | 'bc7' | 'rgba8' | 'bgra8' | 'bgrx8' | 'bgr8' | 'r8' | 'a8'

export type DdsInfo = { width: number; height: number; format: DdsFormat; offsets: number[] }

export const COMPRESSED = new Set<DdsFormat>(['bc1', 'bc2', 'bc3', 'bc4', 'bc5', 'bc7'])

const blockBytes = (f: DdsFormat) => (f === 'bc1' || f === 'bc4' ? 8 : 16)

export function levelBytes(f: DdsFormat, w: number, h: number): number {
  if (COMPRESSED.has(f)) return Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes(f)
  return w * h * (f === 'bgr8' ? 3 : f === 'r8' || f === 'a8' ? 1 : 4)
}

const DX10: Record<number, DdsFormat> = {
  70: 'bc1', 71: 'bc1', 72: 'bc1', 73: 'bc2', 74: 'bc2', 75: 'bc2', 76: 'bc3', 77: 'bc3', 78: 'bc3', 79: 'bc4', 80: 'bc4', 82: 'bc5', 83: 'bc5',
  97: 'bc7', 98: 'bc7', 99: 'bc7', 27: 'rgba8', 28: 'rgba8', 29: 'rgba8', 87: 'bgra8', 91: 'bgra8', 88: 'bgrx8', 93: 'bgrx8', 61: 'r8', 65: 'a8',
}

export function parseDdsHeader(buf: ArrayBuffer, size = buf.byteLength): DdsInfo | null {
  if (buf.byteLength < 128) return null
  const v = new DataView(buf)
  const U = (o: number) => v.getUint32(o, true)
  if (U(0) !== 0x20534444) return null
  const height = U(12)
  const width = U(16)
  const mips = Math.max(1, U(28))
  const pfFlags = U(80)
  const fourCc = U(84)
  const bits = U(88)
  const rMask = U(92)
  const bMask = U(100)
  const aMask = U(104)
  let dataStart = 128
  let format: DdsFormat | undefined
  const cc = fourCc === 0 ? '' : String.fromCharCode(fourCc & 255, (fourCc >> 8) & 255, (fourCc >> 16) & 255, fourCc >>> 24)
  if (pfFlags & 4) {
    switch (cc) {
      case 'DXT1': format = 'bc1'; break
      case 'DXT2':
      case 'DXT3': format = 'bc2'; break
      case 'DXT4':
      case 'DXT5': format = 'bc3'; break
      case 'BC4U':
      case 'ATI1': format = 'bc4'; break
      case 'BC5U':
      case 'ATI2': format = 'bc5'; break
      case 'DX10':
        if (buf.byteLength < 148) return null
        dataStart = 148
        format = DX10[U(128)]
        break
    }
  } else if (bits === 32) format = rMask === 0xff && bMask === 0xff0000 ? 'rgba8' : aMask !== 0 && pfFlags & 1 ? 'bgra8' : 'bgrx8'
  else if (bits === 24) format = 'bgr8'
  else if (bits === 8) format = pfFlags & 2 && rMask === 0 ? 'a8' : 'r8'
  if (!format || width <= 0 || height <= 0) return null
  const offsets: number[] = []
  let pos = dataStart
  for (let i = 0; i < mips; i++) {
    const lb = levelBytes(format, Math.max(1, width >> i), Math.max(1, height >> i))
    if (pos + lb > size) break
    offsets.push(pos)
    pos += lb
  }
  if (!offsets.length) return null
  return { width, height, format, offsets }
}

export function fullLevelCount(w: number, h: number): number {
  let n = 1
  while (Math.max(w, h) >> (n - 1) > 1) n++
  return n
}

function rgb565(c: number, out: number[], o: number) {
  const r = (c >> 11) & 31
  const g = (c >> 5) & 63
  const b = c & 31
  out[o] = (r << 3) | (r >> 2)
  out[o + 1] = (g << 2) | (g >> 4)
  out[o + 2] = (b << 3) | (b >> 2)
}

const pal = new Array<number>(16).fill(0)

function bc1(s: Uint8Array, o: number, dst: Uint8Array, allowAlpha: boolean) {
  const c0 = s[o] | (s[o + 1] << 8)
  const c1 = s[o + 2] | (s[o + 3] << 8)
  rgb565(c0, pal, 0)
  rgb565(c1, pal, 4)
  pal[3] = 255
  pal[7] = 255
  if (c0 > c1 || !allowAlpha) {
    for (let c = 0; c < 3; c++) {
      pal[8 + c] = Math.trunc((2 * pal[c] + pal[4 + c] + 1) / 3)
      pal[12 + c] = Math.trunc((pal[c] + 2 * pal[4 + c] + 1) / 3)
    }
    pal[11] = 255
    pal[15] = 255
  } else {
    for (let c = 0; c < 3; c++) pal[8 + c] = Math.trunc((pal[c] + pal[4 + c]) / 2)
    pal[11] = 255
    pal[12] = pal[13] = pal[14] = pal[15] = 0
  }
  const idx = (s[o + 4] | (s[o + 5] << 8) | (s[o + 6] << 16) | (s[o + 7] << 24)) >>> 0
  for (let i = 0; i < 16; i++) {
    const k = ((idx >>> (2 * i)) & 3) * 4
    dst[i * 4] = pal[k]
    dst[i * 4 + 1] = pal[k + 1]
    dst[i * 4 + 2] = pal[k + 2]
    dst[i * 4 + 3] = pal[k + 3]
  }
}

const apal = new Array<number>(8).fill(0)

function channel(s: Uint8Array, o: number, dst: Uint8Array, ch: number) {
  const a0 = s[o]
  const a1 = s[o + 1]
  apal[0] = a0
  apal[1] = a1
  if (a0 > a1) for (let i = 1; i < 7; i++) apal[i + 1] = Math.trunc(((7 - i) * a0 + i * a1 + 3) / 7)
  else {
    for (let i = 1; i < 5; i++) apal[i + 1] = Math.trunc(((5 - i) * a0 + i * a1 + 2) / 5)
    apal[6] = 0
    apal[7] = 255
  }
  const lo = s[o + 2] | (s[o + 3] << 8) | (s[o + 4] << 16)
  const hi = s[o + 5] | (s[o + 6] << 8) | (s[o + 7] << 16)
  for (let i = 0; i < 16; i++) {
    const v = i < 8 ? (lo >> (3 * i)) & 7 : (hi >> (3 * (i - 8))) & 7
    dst[i * 4 + ch] = apal[v]
  }
}

const PARTITION2 = [
  0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000,
  0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce, 0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c,
  0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a, 0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660,
  0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c, 0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22,
]

const PARTITION3 =
  '0011001102212222' + '0001001122112221' + '0000200122112211' + '0222002200110111' +
  '0000000011221122' + '0011001100220022' + '0022002211111111' + '0011001122112211' +
  '0000000011112222' + '0000111111112222' + '0000111122222222' + '0012001200120012' +
  '0112011201120112' + '0122012201220122' + '0011011211221222' + '0011200122002220' +
  '0001001101121122' + '0111001120012200' + '0000112211221122' + '0022002200221111' +
  '0111011102220222' + '0001000122212221' + '0000001101220122' + '0000110022102210' +
  '0122012200110000' + '0012001211222222' + '0110122112210110' + '0000011012211221' +
  '0022110211020022' + '0110011020022222' + '0011012201220011' + '0000200022112221' +
  '0000000211221222' + '0222002200120011' + '0011001200220222' + '0120012001200120' +
  '0000111122220000' + '0120120120120120' + '0120201212010120' + '0011220011220011' +
  '0011112222000011' + '0101010122222222' + '0000000021212121' + '0022112200221122' +
  '0022001100220011' + '0220122102201221' + '0101222222220101' + '0000212121212121' +
  '0101010101012222' + '0222011102220111' + '0002111200021112' + '0000211221122112' +
  '0222011101110222' + '0002111211120002' + '0110011001102222' + '0000000021122112' +
  '0110011022222222' + '0022001100110022' + '0022112211220022' + '0000000000002112' +
  '0002000100020001' + '0222122202221222' + '0101222222222222' + '0111201122012220'

const ANCHOR2 = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
  15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
]
const ANCHOR3A = [
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
  8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
]
const ANCHOR3B = [
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
  15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
]
const W2 = [0, 21, 43, 64]
const W3 = [0, 9, 18, 27, 37, 46, 55, 64]
const W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]

const subsetOf = (subsets: number, partition: number, px: number) =>
  subsets === 2 ? (PARTITION2[partition] >> px) & 1 : subsets === 3 ? PARTITION3.charCodeAt(partition * 16 + px) - 48 : 0

function isAnchor(subsets: number, partition: number, px: number): boolean {
  if (px === 0) return true
  if (subsets === 2) return px === ANCHOR2[partition]
  if (subsets === 3) return px === ANCHOR3A[partition] || px === ANCHOR3B[partition]
  return false
}

const interp = (e0: number, e1: number, w: number) => ((64 - w) * e0 + w * e1 + 32) >> 6
const weights = (bits: number) => (bits === 2 ? W2 : bits === 3 ? W3 : W4)

const ep = new Int32Array(24)
const idx1 = new Int32Array(16)
const idx2 = new Int32Array(16)

export function bc7(s: Uint8Array, o: number, dst: Uint8Array) {
  let mode = 0
  while (mode < 8 && (s[o] & (1 << mode)) === 0) mode++
  if (mode === 8) {
    dst.fill(0, 0, 64)
    return
  }
  let pos = 0
  const read = (n: number) => {
    let v = 0
    for (let i = 0; i < n; i++) {
      v |= ((s[o + (pos >> 3)] >> (pos & 7)) & 1) << i
      pos++
    }
    return v
  }
  read(mode + 1)
  const subsets = mode === 0 || mode === 2 ? 3 : mode === 1 || mode === 3 || mode === 7 ? 2 : 1
  const partitionBits = mode === 0 ? 4 : mode === 1 || mode === 2 || mode === 3 || mode === 7 ? 6 : 0
  const rotationBits = mode === 4 || mode === 5 ? 2 : 0
  const indexSelBits = mode === 4 ? 1 : 0
  const colorBits = [4, 6, 5, 7, 5, 7, 7, 5][mode]
  const alphaBits = mode === 4 ? 6 : mode === 5 ? 8 : mode === 6 ? 7 : mode === 7 ? 5 : 0
  const endpointP = mode === 0 || mode === 3 || mode === 6 || mode === 7
  const sharedP = mode === 1
  const indexBits = mode === 0 || mode === 1 ? 3 : mode === 6 ? 4 : 2
  const index2Bits = mode === 4 ? 3 : mode === 5 ? 2 : 0
  const partition = read(partitionBits)
  const rotation = read(rotationBits)
  const indexSel = read(indexSelBits)
  const endpoints = subsets * 2
  for (let c = 0; c < 3; c++) for (let e = 0; e < endpoints; e++) ep[e * 4 + c] = read(colorBits)
  for (let e = 0; e < endpoints; e++) ep[e * 4 + 3] = alphaBits > 0 ? read(alphaBits) : 255
  let cb = colorBits
  let ab = alphaBits
  if (endpointP) {
    for (let e = 0; e < endpoints; e++) {
      const p = read(1)
      for (let c = 0; c < 3; c++) ep[e * 4 + c] = (ep[e * 4 + c] << 1) | p
      if (alphaBits > 0) ep[e * 4 + 3] = (ep[e * 4 + 3] << 1) | p
    }
    cb++
    if (alphaBits > 0) ab++
  } else if (sharedP) {
    for (let sub = 0; sub < subsets; sub++) {
      const p = read(1)
      for (let e = sub * 2; e < sub * 2 + 2; e++) for (let c = 0; c < 3; c++) ep[e * 4 + c] = (ep[e * 4 + c] << 1) | p
    }
    cb++
  }
  for (let e = 0; e < endpoints; e++) {
    for (let c = 0; c < 3; c++) {
      const v = ep[e * 4 + c] << (8 - cb)
      ep[e * 4 + c] = v | (v >> cb)
    }
    if (alphaBits > 0) {
      const v = ep[e * 4 + 3] << (8 - ab)
      ep[e * 4 + 3] = v | (v >> ab)
    }
  }
  for (let i = 0; i < 16; i++) idx1[i] = read(isAnchor(subsets, partition, i) ? indexBits - 1 : indexBits)
  if (index2Bits > 0) for (let i = 0; i < 16; i++) idx2[i] = read(i === 0 ? index2Bits - 1 : index2Bits)
  const w1 = weights(indexBits)
  const w2 = index2Bits > 0 ? weights(index2Bits) : w1
  for (let i = 0; i < 16; i++) {
    const sub = subsetOf(subsets, partition, i)
    const e0 = sub * 8
    const e1 = sub * 8 + 4
    let r: number, g: number, b: number, a: number
    if (index2Bits === 0) {
      const w = w1[idx1[i]]
      r = interp(ep[e0], ep[e1], w)
      g = interp(ep[e0 + 1], ep[e1 + 1], w)
      b = interp(ep[e0 + 2], ep[e1 + 2], w)
      a = interp(ep[e0 + 3], ep[e1 + 3], w)
    } else {
      const wc = indexSel === 0 ? w1[idx1[i]] : w2[idx2[i]]
      const wa = indexSel === 0 ? w2[idx2[i]] : w1[idx1[i]]
      r = interp(ep[e0], ep[e1], wc)
      g = interp(ep[e0 + 1], ep[e1 + 1], wc)
      b = interp(ep[e0 + 2], ep[e1 + 2], wc)
      a = interp(ep[e0 + 3], ep[e1 + 3], wa)
    }
    if (rotation === 1) [a, r] = [r, a]
    else if (rotation === 2) [a, g] = [g, a]
    else if (rotation === 3) [a, b] = [b, a]
    dst[i * 4] = r
    dst[i * 4 + 1] = g
    dst[i * 4 + 2] = b
    dst[i * 4 + 3] = a
  }
}

function decodeBlock(f: DdsFormat, s: Uint8Array, o: number, dst: Uint8Array) {
  switch (f) {
    case 'bc1':
      bc1(s, o, dst, true)
      break
    case 'bc2':
      bc1(s, o + 8, dst, false)
      for (let i = 0; i < 16; i++) dst[i * 4 + 3] = ((s[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17
      break
    case 'bc3':
      bc1(s, o + 8, dst, false)
      channel(s, o, dst, 3)
      break
    case 'bc4':
      channel(s, o, dst, 0)
      for (let i = 0; i < 16; i++) {
        dst[i * 4 + 1] = dst[i * 4 + 2] = dst[i * 4]
        dst[i * 4 + 3] = 255
      }
      break
    case 'bc5':
      channel(s, o, dst, 0)
      channel(s, o + 8, dst, 1)
      for (let i = 0; i < 16; i++) {
        const x = Math.fround(dst[i * 4] / 127.5 - 1)
        const y = Math.fround(dst[i * 4 + 1] / 127.5 - 1)
        const z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
        dst[i * 4 + 2] = Math.min(255, Math.max(0, Math.trunc((z * 0.5 + 0.5) * 255 + 0.5)))
        dst[i * 4 + 3] = 255
      }
      break
    case 'bc7':
      bc7(s, o, dst)
      break
  }
}

export function decodeLevel(f: DdsFormat, data: Uint8Array, w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4)
  if (COMPRESSED.has(f)) {
    const bw = Math.ceil(w / 4)
    const bh = Math.ceil(h / 4)
    const bb = blockBytes(f)
    const block = new Uint8Array(64)
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++) {
        decodeBlock(f, data, (by * bw + bx) * bb, block)
        for (let py = 0; py < 4; py++) {
          const y = by * 4 + py
          if (y >= h) break
          for (let px = 0; px < 4; px++) {
            const x = bx * 4 + px
            if (x >= w) break
            rgba.set(block.subarray((py * 4 + px) * 4, (py * 4 + px) * 4 + 4), (y * w + x) * 4)
          }
        }
      }
    return rgba
  }
  for (let i = 0; i < w * h; i++) {
    const d = i * 4
    switch (f) {
      case 'rgba8':
        rgba[d] = data[d]
        rgba[d + 1] = data[d + 1]
        rgba[d + 2] = data[d + 2]
        rgba[d + 3] = data[d + 3]
        break
      case 'bgra8':
      case 'bgrx8':
        rgba[d] = data[d + 2]
        rgba[d + 1] = data[d + 1]
        rgba[d + 2] = data[d]
        rgba[d + 3] = f === 'bgra8' ? data[d + 3] : 255
        break
      case 'bgr8':
        rgba[d] = data[i * 3 + 2]
        rgba[d + 1] = data[i * 3 + 1]
        rgba[d + 2] = data[i * 3]
        rgba[d + 3] = 255
        break
      case 'r8':
        rgba[d] = data[i]
        rgba[d + 3] = 255
        break
      case 'a8':
        rgba[d + 3] = data[i]
        break
    }
  }
  return rgba
}

export function downsample(src: Uint8Array, sw: number, sh: number): { data: Uint8Array; w: number; h: number } {
  const w = Math.max(1, sw >> 1)
  const h = Math.max(1, sh >> 1)
  const dst = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(x * 2, sw - 1)
      const x1 = Math.min(x * 2 + 1, sw - 1)
      const y0 = Math.min(y * 2, sh - 1)
      const y1 = Math.min(y * 2 + 1, sh - 1)
      for (let c = 0; c < 4; c++) {
        const sum = src[(y0 * sw + x0) * 4 + c] + src[(y0 * sw + x1) * 4 + c] + src[(y1 * sw + x0) * 4 + c] + src[(y1 * sw + x1) * 4 + c]
        dst[(y * w + x) * 4 + c] = (sum + 2) >> 2
      }
    }
  return { data: dst, w, h }
}
