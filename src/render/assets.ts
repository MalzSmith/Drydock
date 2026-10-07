import {
  BufferAttribute,
  CompressedTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapNearestFilter,
  NoColorSpace,
  RGBAFormat,
  RGBA_BPTC_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT3_Format,
  RGBA_S3TC_DXT5_Format,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
  type WebGLRenderer,
} from 'three'
import type { AssetResult, Caps, MeshData, Status, TexData } from '../assets/build.ts'
import { assetRpc } from '../workers/client.ts'
import type { MeshState } from './detail.ts'

export type MeshAttrs = { position: BufferAttribute; normal: BufferAttribute; uv: BufferAttribute; index: BufferAttribute }

export type MeshEntry = MeshState & { attrs?: MeshAttrs }

export type TexEntry = { status: Status | 'pending'; tex?: Texture; waiters: Set<() => void> }

export type AssetCounts = { meshes: number; meshesDone: number; textures: number; texturesDone: number; uncachedMeshes: number; uncachedTextures: number }

const FORMAT = { bc1: RGBA_S3TC_DXT1_Format, bc2: RGBA_S3TC_DXT3_Format, bc3: RGBA_S3TC_DXT5_Format, bc7: RGBA_BPTC_Format } as const

function makeTexture(t: TexData, srgb: boolean): Texture {
  const mips = t.levels.map((l) => ({ data: l.data, width: l.w, height: l.h }))
  const tex =
    t.fmt === 'rgba'
      ? Object.assign(new DataTexture(mips[0].data, t.w, t.h, RGBAFormat, UnsignedByteType), { mipmaps: mips })
      : new CompressedTexture(mips as never, t.w, t.h, FORMAT[t.fmt], UnsignedByteType)
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapNearestFilter
  tex.generateMipmaps = false
  tex.flipY = false
  tex.anisotropy = 1
  tex.needsUpdate = true
  return tex
}

function makeAttrs(d: MeshData): MeshAttrs {
  return {
    position: new BufferAttribute(d.pos, 3),
    normal: new BufferAttribute(d.nrm, 3),
    uv: new BufferAttribute(d.uv, 2),
    index: new BufferAttribute(d.idx, 1),
  }
}

export function capsOf(gl: WebGLRenderer): Caps {
  const ext = gl.extensions
  return {
    s3tc: ext.has('WEBGL_compressed_texture_s3tc') && ext.has('WEBGL_compressed_texture_s3tc_srgb'),
    bptc: ext.has('EXT_texture_compression_bptc'),
  }
}

export function createAssets(caps: Caps, upload: (t: Texture) => void, onMesh: () => void, onTexture: () => void, onCounts: (c: AssetCounts) => void) {
  const meshes = new Map<string, MeshEntry>()
  const textures = new Map<string, TexEntry>()
  const queue: Array<() => Promise<void>> = []
  let running = 0
  let gen = 0
  let meshTimer = 0
  let countTimer = 0
  const uploads: Array<() => void> = []
  let uploadRaf = 0

  const counts = (): AssetCounts => {
    let meshesDone = 0
    let texturesDone = 0
    let uncachedMeshes = 0
    let uncachedTextures = 0
    for (const m of meshes.values()) {
      if (m.status !== 'pending') meshesDone++
      if (m.status === 'uncached') uncachedMeshes++
    }
    for (const t of textures.values()) {
      if (t.status !== 'pending') texturesDone++
      if (t.status === 'uncached') uncachedTextures++
    }
    return { meshes: meshes.size, meshesDone, textures: textures.size, texturesDone, uncachedMeshes, uncachedTextures }
  }

  const report = () => {
    if (countTimer) return
    countTimer = window.setTimeout(() => {
      countTimer = 0
      onCounts(counts())
    }, 100)
  }

  const pump = () => {
    while (running < 6 && queue.length) {
      const job = queue.shift()!
      running++
      void job().finally(() => {
        running--
        pump()
      })
    }
  }

  const fireMesh = () => {
    meshTimer = 0
    onMesh()
  }

  const meshChanged = () => {
    report()
    for (const m of meshes.values())
      if (m.status === 'pending') {
        if (!meshTimer) meshTimer = window.setTimeout(fireMesh, 400)
        return
      }
    clearTimeout(meshTimer)
    meshTimer = window.setTimeout(fireMesh, 0)
  }

  const drainUploads = () => {
    uploadRaf = 0
    const t0 = performance.now()
    while (uploads.length && performance.now() - t0 < 6) uploads.shift()!()
    if (uploads.length) scheduleUploads()
  }

  const scheduleUploads = () => {
    uploadRaf = document.hidden ? window.setTimeout(drainUploads, 0) : requestAnimationFrame(drainUploads)
  }

  function mesh(cands: string[]): MeshEntry {
    const key = cands.join('|')
    let e = meshes.get(key)
    if (e) return e
    const entry: MeshEntry = { status: 'pending', key }
    meshes.set(key, entry)
    const my = gen
    queue.push(async () => {
      if (my !== gen) return
      let r: AssetResult<MeshData>
      try {
        r = await assetRpc().call<AssetResult<MeshData>>('loadMesh', { cands })
      } catch (err) {
        r = { data: null, status: 'error', error: String(err) }
      }
      if (meshes.get(key) !== entry) return
      entry.status = r.status
      if (r.data) {
        entry.data = r.data
        entry.attrs = makeAttrs(r.data)
      }
      meshChanged()
    })
    report()
    pump()
    return entry
  }

  function texture(cands: string[], srgb: boolean): TexEntry {
    const key = cands.join('|') + (srgb ? '#s' : '#l')
    let e = textures.get(key)
    if (e) return e
    const entry: TexEntry = { status: 'pending', waiters: new Set() }
    textures.set(key, entry)
    const my = gen
    queue.push(async () => {
      if (my !== gen) return
      let r: AssetResult<TexData>
      try {
        r = await assetRpc().call<AssetResult<TexData>>('loadTexture', { cands, caps })
      } catch (err) {
        r = { data: null, status: 'error', error: String(err) }
      }
      if (textures.get(key) !== entry) return
      const finish = () => {
        if (textures.get(key) !== entry) return
        entry.status = r.status
        if (r.data) {
          entry.tex = makeTexture(r.data, srgb)
          upload(entry.tex)
        }
        for (const w of entry.waiters) w()
        entry.waiters.clear()
        report()
        onTexture()
      }
      if (!r.data) return finish()
      uploads.push(finish)
      if (!uploadRaf) scheduleUploads()
    })
    report()
    pump()
    return entry
  }

  function retry() {
    gen++
    queue.length = 0
    for (const [k, m] of meshes) if (m.status !== 'ok') meshes.delete(k)
    for (const [k, t] of textures) if (t.status !== 'ok') textures.delete(k)
    report()
    onMesh()
  }

  function forget(keep: (key: string) => boolean) {
    for (const [k, t] of textures)
      if (!keep(k)) {
        t.tex?.dispose()
        textures.delete(k)
      }
  }

  function forgetMeshes(keep: (key: string) => boolean, dispose: (a: MeshAttrs) => void) {
    for (const [k, m] of meshes)
      if (!keep(k)) {
        if (m.attrs) dispose(m.attrs)
        meshes.delete(k)
      }
  }

  return { mesh, texture, retry, forget, forgetMeshes, counts }
}

export type Assets = ReturnType<typeof createAssets>
