export type MwmPart = { material: string; technique: string; textures: Record<string, string>; indices: Uint32Array }

export type MwmDummy = { name: string; matrix: Float32Array; data: Record<string, string> }

export type MwmFile = {
  version: number
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  patternScale: number
  parts: MwmPart[]
  dummies: MwmDummy[]
  geometryAsset: string | null
}

const utf8 = new TextDecoder('utf-8')

const HALF = (() => {
  const t = new Float32Array(65536)
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1
    const e = (h >> 10) & 31
    const f = h & 1023
    t[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15)
  }
  return t
})()

class Reader {
  p = 0
  v: DataView
  b: Uint8Array
  constructor(buf: ArrayBuffer) {
    this.v = new DataView(buf)
    this.b = new Uint8Array(buf)
  }
  i32() {
    const x = this.v.getInt32(this.p, true)
    this.p += 4
    return x
  }
  u32() {
    const x = this.v.getUint32(this.p, true)
    this.p += 4
    return x
  }
  f32() {
    const x = this.v.getFloat32(this.p, true)
    this.p += 4
    return x
  }
  bool() {
    return this.b[this.p++] !== 0
  }
  str() {
    let n = 0
    let shift = 0
    for (;;) {
      const c = this.b[this.p++]
      n |= (c & 127) << shift
      if (c < 128) break
      shift += 7
    }
    const s = utf8.decode(this.b.subarray(this.p, this.p + n))
    this.p += n
    return s
  }
  skip(n: number) {
    this.p += n
  }
}

function readStrings(r: Reader): string[] {
  const n = r.i32()
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(r.str())
  return out
}

function readPositions(r: Reader): Float32Array {
  const n = r.i32()
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const lo = r.u32()
    const hi = r.u32()
    const w = HALF[hi >>> 16]
    out[i * 3] = HALF[lo & 0xffff] * w
    out[i * 3 + 1] = HALF[lo >>> 16] * w
    out[i * 3 + 2] = HALF[hi & 0xffff] * w
  }
  return out
}

function readNormals(r: Reader): Float32Array {
  const n = r.i32()
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const p = r.u32()
    const bx = p & 255
    let by = (p >>> 8) & 255
    const bz = (p >>> 16) & 255
    const bw = p >>> 24
    const sign = by > 127.5 ? 1 : -1
    if (sign > 0) by -= 128
    const x = Math.fround(2 * Math.fround((bx + 256 * by) / 32767) - 1)
    const y = Math.fround(2 * Math.fround((bz + 256 * bw) / 32767) - 1)
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = sign * Math.sqrt(Math.max(0, 1 - x * x - y * y))
  }
  return out
}

function readTexCoords(r: Reader): Float32Array {
  const n = r.i32()
  const out = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const p = r.u32()
    out[i * 2] = HALF[p & 0xffff]
    out[i * 2 + 1] = HALF[p >>> 16]
  }
  return out
}

function readMatrix(r: Reader): Float32Array {
  const m = new Float32Array(16)
  for (let i = 0; i < 16; i++) m[i] = r.f32()
  return m
}

function readDummies(r: Reader): MwmDummy[] {
  const n = r.i32()
  const out: MwmDummy[] = []
  for (let i = 0; i < n; i++) {
    const name = r.str()
    const matrix = readMatrix(r)
    const m = r.i32()
    const data: Record<string, string> = {}
    for (let j = 0; j < m; j++) {
      const k = r.str()
      data[k] = r.str()
    }
    out.push({ name, matrix, data })
  }
  return out
}

const OLD_TECHNIQUES = ['MESH', 'VOXELS_DEBRIS', 'VOXEL_MAP', 'ALPHA_MASKED', 'FOLIAGE', 'DECAL', 'DECAL_CUTOUT', 'HOLO', 'VOXEL_MAP_SINGLE', 'VOXEL_MAP_MULTI', 'SKINNED', 'GLASS']

function readMaterial(r: Reader, version: number, part: MwmPart) {
  part.material = r.str()
  if (version < 1052002) {
    const diffuse = r.str()
    const normal = r.str()
    if (diffuse) part.textures['DiffuseTexture'] = diffuse
    if (normal) part.textures['NormalTexture'] = normal
  } else {
    const n = r.i32()
    for (let i = 0; i < n; i++) {
      const k = r.str()
      const v = r.str()
      if (v) part.textures[k] = v
    }
  }
  if (version >= 1068001) {
    const n = r.i32()
    for (let i = 0; i < n; i++) {
      r.str()
      r.str()
    }
  }
  if (version < 1157001) r.skip(28)
  if (version < 1052001) {
    const t = r.i32()
    part.technique = t >= 0 && t < OLD_TECHNIQUES.length ? OLD_TECHNIQUES[t] : 'MESH'
  } else part.technique = r.str()
  if (part.technique === 'GLASS') {
    if (version >= 1043001) {
      r.str()
      r.str()
      r.bool()
    } else r.skip(16)
  }
}

function readMeshParts(r: Reader, version: number): MwmPart[] {
  const n = r.i32()
  const out: MwmPart[] = []
  for (let i = 0; i < n; i++) {
    const part: MwmPart = { material: '', technique: '', textures: {}, indices: new Uint32Array(0) }
    r.i32()
    if (version < 1052001) r.i32()
    const count = r.i32()
    const idx = new Uint32Array(count)
    for (let j = 0; j < count; j++) idx[j] = r.i32()
    part.indices = idx
    if (r.bool()) readMaterial(r, version, part)
    out.push(part)
  }
  return out
}

function skipArray(r: Reader, size: number) {
  r.skip(r.i32() * size)
}

export function parseMwm(buf: ArrayBuffer): MwmFile {
  const r = new Reader(buf)
  const m: MwmFile = {
    version: 0,
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    patternScale: 1,
    parts: [],
    dummies: [],
    geometryAsset: null,
  }
  r.str()
  const header = readStrings(r)
  if (header.length && header[0].includes('Version:')) m.version = parseInt(header[0].replace('Version:', ''), 10) || 0
  if (m.version >= 1066002) {
    const index = new Map<string, number>()
    const count = r.i32()
    for (let i = 0; i < count; i++) {
      const k = r.str()
      index.set(k, r.i32())
    }
    const seek = (tag: string) => {
      const o = index.get(tag)
      if (o === undefined) return false
      r.p = o
      r.str()
      return true
    }
    if (seek('Dummies')) m.dummies = readDummies(r)
    if (seek('Vertices')) m.positions = readPositions(r)
    if (seek('Normals')) m.normals = readNormals(r)
    if (seek('TexCoords0')) m.uvs = readTexCoords(r)
    if (seek('PatternScale')) m.patternScale = r.f32()
    if (seek('MeshParts')) m.parts = readMeshParts(r, m.version)
    if (seek('GeometryDataAsset')) m.geometryAsset = r.str()
    return m
  }
  r.str()
  m.dummies = readDummies(r)
  r.str()
  m.positions = readPositions(r)
  r.str()
  m.normals = readNormals(r)
  r.str()
  m.uvs = readTexCoords(r)
  r.str()
  skipArray(r, 4)
  r.str()
  skipArray(r, 4)
  r.str()
  skipArray(r, 4)
  r.str()
  r.bool()
  r.str()
  r.f32()
  r.str()
  r.f32()
  r.str()
  r.bool()
  r.str()
  r.bool()
  r.str()
  r.f32()
  r.str()
  r.f32()
  r.str()
  r.skip(24)
  r.str()
  r.skip(16)
  r.str()
  r.bool()
  r.str()
  m.parts = readMeshParts(r, m.version)
  return m
}
