import { KIND_GLASS, KIND_LIGHT } from '../assets/material.ts'

export type ObjMaterial = { key: string; kind: number; rgb: [number, number, number] }

export type ObjWriter = {
  add(mat: ObjMaterial, pos: Float32Array, nrm: Float32Array, idx: Uint32Array): void
  finish(): { obj: Uint8Array[]; mtl: Uint8Array }
}

const f3 = (v: number) => (Math.round(v * 10000) / 10000).toString()
const f2 = (v: number) => (Math.round(v * 1000) / 1000).toString()

// Wavefront OBJ with a companion MTL: one `usemtl` block per chunk, vertex indices global and 1-based.
export function objWriter(mtlFile: string): ObjWriter {
  const enc = new TextEncoder()
  const obj: Uint8Array[] = [enc.encode(`# Drydock, metres, Y up\nmtllib ${mtlFile}\n`)]
  const mats = new Map<string, ObjMaterial>()
  let base = 1
  let last = ''
  return {
    add(mat, pos, nrm, idx) {
      mats.set(mat.key, mat)
      const lines: string[] = []
      if (mat.key !== last) {
        lines.push(`usemtl ${mat.key}`)
        last = mat.key
      }
      const nv = pos.length / 3
      for (let i = 0; i < nv; i++) lines.push(`v ${f3(pos[i * 3])} ${f3(pos[i * 3 + 1])} ${f3(pos[i * 3 + 2])}`)
      for (let i = 0; i < nv; i++) lines.push(`vn ${f2(nrm[i * 3])} ${f2(nrm[i * 3 + 1])} ${f2(nrm[i * 3 + 2])}`)
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = idx[t] + base, b = idx[t + 1] + base, c = idx[t + 2] + base
        lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`)
      }
      lines.push('')
      obj.push(enc.encode(lines.join('\n')))
      base += nv
    },
    finish() {
      const out: string[] = ['# Drydock materials']
      for (const m of mats.values()) {
        const [r, g, b] = m.rgb.map(f2)
        out.push(`newmtl ${m.key}`, `Kd ${r} ${g} ${b}`, 'Ka 0 0 0', 'Ks 0.04 0.04 0.04', 'Ns 20', 'illum 2')
        if (m.kind === KIND_GLASS) out.push('d 0.5')
        if (m.kind === KIND_LIGHT) out.push(`Ke ${r} ${g} ${b}`)
        out.push('')
      }
      return { obj, mtl: enc.encode(out.join('\n')) }
    },
  }
}
