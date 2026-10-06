import { decodeLevel, downsample, levelBytes, parseDdsHeader, type DdsFormat } from '../se/dds.ts'
import type { Caps } from './build.ts'

export const SKY_V = 1
export const SKY_FACE = 1024
export const SKY_THUMB = { w: 192, h: 96, face: 64 }

export type SkyFormat = 'bc1' | 'bc2' | 'bc3' | 'bc7' | 'rgba'

export type SkyData = { size: number; fmt: SkyFormat; faces: Uint8Array[] }

export type SkyOrient = [number, number, number]

export type SkyMeta = { key: string; name: string; src: string; orient: SkyOrient; thumb: Blob | null }

export type SkyRec = { v: number; fp: string; data: SkyData }

const KEEP = new Set<DdsFormat>(['bc1', 'bc2', 'bc3', 'bc7'])

export async function readSky(f: File, target: number, compressed: boolean): Promise<SkyData | null> {
  const head = await f.slice(0, 148).arrayBuffer()
  const info = parseDdsHeader(head, f.size)
  if (!info || info.width !== info.height) return null
  const v = new DataView(head)
  const cube = info.offsets[0] === 148 ? (v.getUint32(136, true) & 4) !== 0 : (v.getUint32(112, true) & 0x200) !== 0
  if (!cube) return null
  const mips = info.offsets.length
  let stride = 0
  for (let i = 0; i < mips; i++) stride += levelBytes(info.format, Math.max(1, info.width >> i), Math.max(1, info.height >> i))
  if (info.offsets[0] + stride * 6 > f.size) return null
  let level = 0
  while (level < mips - 1 && info.width >> level > target) level++
  const size = Math.max(1, info.width >> level)
  const lb = levelBytes(info.format, size, size)
  const faces = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(async (i) => {
      const at = info.offsets[level] + i * stride
      return new Uint8Array(await f.slice(at, at + lb).arrayBuffer())
    }),
  )
  if (compressed && KEEP.has(info.format) && size <= target) return { size, fmt: info.format as SkyFormat, faces }
  let s = size
  let out = faces.map((d) => (info.format === 'rgba8' ? d : decodeLevel(info.format, d, s, s)))
  while (s > target) {
    out = out.map((d) => downsample(d, s, s).data)
    s = Math.max(1, s >> 1)
  }
  return { size: s, fmt: 'rgba', faces: out }
}

export function skyForCaps(d: SkyData, caps: Caps): SkyData {
  if (d.fmt === 'rgba' || (d.fmt === 'bc7' ? caps.bptc : caps.s3tc)) return d
  return { size: d.size, fmt: 'rgba', faces: d.faces.map((f) => decodeLevel(d.fmt as DdsFormat, f, d.size, d.size)) }
}

export function skyMatrix(o: SkyOrient): number[] {
  const [yaw, pitch, roll] = o
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  const r = [
    cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
    cp * sr, cp * cr, -sp,
    -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp,
  ]
  return [r[0], r[3], r[6], r[1], r[4], r[7], -r[2], -r[5], -r[8]]
}

export function cubeTexel(faces: Uint8Array[], size: number, x: number, y: number, z: number, out: Uint8Array, o: number) {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  let face: number
  let sc: number
  let tc: number
  let ma: number
  if (ax >= ay && ax >= az) {
    ma = ax
    face = x > 0 ? 0 : 1
    sc = x > 0 ? -z : z
    tc = -y
  } else if (ay >= az) {
    ma = ay
    face = y > 0 ? 2 : 3
    sc = x
    tc = y > 0 ? z : -z
  } else {
    ma = az
    face = z > 0 ? 4 : 5
    sc = z > 0 ? x : -x
    tc = -y
  }
  const u = Math.min(size - 1, Math.max(0, Math.floor(((sc / ma + 1) / 2) * size)))
  const v = Math.min(size - 1, Math.max(0, Math.floor(((tc / ma + 1) / 2) * size)))
  const i = (v * size + u) * 4
  const f = faces[face]
  out[o] = f[i]
  out[o + 1] = f[i + 1]
  out[o + 2] = f[i + 2]
  out[o + 3] = 255
}

export function panorama(d: SkyData, o: SkyOrient, w: number, h: number): Uint8Array {
  const m = skyMatrix(o)
  const out = new Uint8Array(w * h * 4)
  for (let py = 0; py < h; py++) {
    const lat = (0.5 - (py + 0.5) / h) * Math.PI
    for (let px = 0; px < w; px++) {
      const lon = ((px + 0.5) / w - 0.5) * 2 * Math.PI
      const x = Math.cos(lat) * Math.sin(lon)
      const y = Math.sin(lat)
      const z = -Math.cos(lat) * Math.cos(lon)
      cubeTexel(d.faces, d.size, m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z, out, (py * w + px) * 4)
    }
  }
  return out
}
