import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three'
import { KIND_GLASS, KIND_LIGHT } from '../assets/material.ts'
import { actions, plural, sectionOpts, store } from '../state/app.ts'
import { keyed } from '../util/keyed.ts'
import { objWriter } from '../util/obj.ts'
import { download } from '../util/save.ts'
import { stlWriter } from '../util/stl.ts'
import { zipStore } from '../util/zip.ts'
import { bakeChunks, bakeStats, type BakeInput, type BakeMaterial, type BakeStats, type Chunk } from './bake.ts'
import { CANCELLED, fileName, guarded, isCancelled } from './exportImage.ts'
import type { Renderer } from './renderer.ts'

export type ModelFormat = 'glb' | 'stl' | 'obj'

export const MODEL_FORMATS: ModelFormat[] = ['glb', 'stl', 'obj']

// GLB is assembled in memory by the exporter, the other two stream into a Blob, so GLB gets the tightest cap.
export const MAX_TRIS: Record<ModelFormat, number> = { glb: 20_000_000, stl: 60_000_000, obj: 40_000_000 }

const LABEL: Record<ModelFormat, string> = { glb: 'GLB', stl: 'STL', obj: 'OBJ' }

function input(r: Renderer): BakeInput | null {
  const m = r.exportModelInput()
  return m ? { ...m, section: sectionOpts(store.get()) } : null
}

export function modelStats(r: Renderer): BakeStats | null {
  const i = input(r)
  return i ? bakeStats(i) : null
}

export function modelBytes(fmt: ModelFormat, s: BakeStats): number {
  if (fmt === 'stl') return 84 + 50 * s.tris
  if (fmt === 'glb') return 2048 + 24 * s.verts + 12 * s.tris
  return 48 * s.verts + 30 * s.tris
}

const yieldFrame = () => new Promise<void>((ok) => setTimeout(ok, 0))

async function bake(i: BakeInput, total: number, each: (c: Chunk) => void) {
  let done = 0
  for (const c of bakeChunks(i)) {
    each(c)
    done += c.idx.length / 3
    store.set({ progress: Math.min(1, done / Math.max(1, total)) })
    await yieldFrame()
    if (isCancelled()) throw CANCELLED
  }
}

function merged(chunks: Chunk[]): BufferGeometry {
  let nv = 0
  let ni = 0
  for (const c of chunks) {
    nv += c.pos.length
    ni += c.idx.length
  }
  const pos = new Float32Array(nv)
  const nrm = new Float32Array(nv)
  const idx = new Uint32Array(ni)
  let ov = 0
  let oi = 0
  for (const c of chunks) {
    pos.set(c.pos, ov)
    nrm.set(c.nrm, ov)
    const base = ov / 3
    for (let k = 0; k < c.idx.length; k++) idx[oi + k] = c.idx[k] + base
    ov += c.pos.length
    oi += c.idx.length
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('normal', new BufferAttribute(nrm, 3))
  g.setIndex(new BufferAttribute(idx, 1))
  return g
}

function material(m: BakeMaterial): MeshStandardMaterial {
  const color = new Color().setRGB(m.rgb[0], m.rgb[1], m.rgb[2], SRGBColorSpace)
  const mat = new MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.6 })
  mat.name = m.key
  if (m.kind === KIND_GLASS) {
    mat.transparent = true
    mat.opacity = 0.5
  }
  if (m.kind === KIND_LIGHT) {
    mat.emissive = color.clone()
    mat.emissiveIntensity = 1
  }
  return mat
}

async function writeGlb(i: BakeInput, total: number): Promise<Blob> {
  const byMat = new Map<string, { mat: BakeMaterial; chunks: Chunk[] }>()
  await bake(i, total, (c) => {
    let e = byMat.get(c.mat.key)
    if (!e) byMat.set(c.mat.key, (e = { mat: c.mat, chunks: [] }))
    e.chunks.push(c)
  })
  const root = new Group()
  root.name = 'drydock'
  const geos: BufferGeometry[] = []
  for (const e of byMat.values()) {
    const g = merged(e.chunks)
    e.chunks.length = 0
    geos.push(g)
    const mesh = new Mesh(g, material(e.mat))
    mesh.name = e.mat.key
    root.add(mesh)
  }
  try {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
    const buf = (await new GLTFExporter().parseAsync(root, { binary: true })) as ArrayBuffer
    return new Blob([buf], { type: 'model/gltf-binary' })
  } finally {
    for (const g of geos) g.dispose()
  }
}

async function writeStl(i: BakeInput, total: number): Promise<Blob> {
  const w = stlWriter()
  await bake(i, total, (c) => w.add(c.pos, c.idx))
  return w.finish()
}

async function writeObj(i: BakeInput, total: number, base: string): Promise<Blob> {
  const w = objWriter(`${base}.mtl`)
  await bake(i, total, (c) => w.add(c.mat, c.pos, c.nrm, c.idx))
  const { obj, mtl } = w.finish()
  return zipStore([
    { name: `${base}.obj`, data: obj },
    { name: `${base}.mtl`, data: mtl },
  ])
}

export function exportModel(r: Renderer, fmt: ModelFormat) {
  return guarded(
    async () => {
      const i = input(r)
      if (!i) return
      const stats = bakeStats(i)
      if (stats.tris > MAX_TRIS[fmt]) return actions.toast(keyed('toast.tooManyTriangles', { fmt: LABEL[fmt], count: stats.tris, max: MAX_TRIS[fmt] }), true)
      const base = fileName()
      const name = fmt === 'obj' ? `${base}_obj.zip` : `${base}.${fmt}`
      const blob = fmt === 'glb' ? await writeGlb(i, stats.tris) : fmt === 'stl' ? await writeStl(i, stats.tris) : await writeObj(i, stats.tris, base)
      download(blob, name)
      actions.toast(keyed('toast.downloadedFile', { file: name, detail: plural('triangles', stats.tris) }))
    },
    'toast.modelFailed',
    keyed('export.modelProgress', { fmt: LABEL[fmt] }),
  )
}
