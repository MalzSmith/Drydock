import { keyed } from '../util/keyed.ts'
import { COMP_BLOCKS } from './blocks.ts'
import { MAX_DIM, ROT_IDENTITY } from './csg.ts'

export const COMPOSITION_FORMAT = 'drydock-composition'
export const COMPOSITION_VERSION = 1

const OPS = ['add', 'subtract', 'intersect'] as const
const TYPES = ['box', 'sphere', 'cylinder', 'ellipsoid', 'torus', 'pyramid'] as const

export type FileShape = {
  op: (typeof OPS)[number]
  type: (typeof TYPES)[number]
  size: [number, number, number]
  pos: [number, number, number]
  block: number
  shell: number
  tube: number
  rot: number[]
}

export type Composition = { name: string; grid: 'Large' | 'Small'; shapes: FileShape[] }

export function compositionJson(c: Composition): string {
  const shapes = c.shapes.map((s) => '    ' + JSON.stringify({ op: s.op, type: s.type, size: s.size, pos: s.pos, block: s.block, shell: s.shell, tube: s.tube, rot: s.rot }))
  const head = JSON.stringify({ format: COMPOSITION_FORMAT, version: COMPOSITION_VERSION, name: c.name, grid: c.grid }, null, 2).slice(0, -2)
  return `${head},\n  "shapes": [\n${shapes.join(',\n')}\n  ]\n}\n`
}

const isRotation = (m: unknown): m is number[] => {
  if (!Array.isArray(m) || m.length !== 9 || !m.every((v) => v === 0 || v === 1 || v === -1)) return false
  const cols = new Set<number>()
  for (let r = 0; r < 3; r++) {
    const nz = [0, 1, 2].filter((c) => m[r * 3 + c] !== 0)
    if (nz.length !== 1) return false
    cols.add(nz[0])
  }
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  return cols.size === 3 && det === 1
}

const vec3 = (v: unknown, key: string, n: number, min: number, max: number): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => Number.isInteger(x) && x >= min && x <= max)) throw new Error(keyed(key, { n, min, max }))
  return [v[0], v[1], v[2]]
}

export function parseComposition(text: string): Composition {
  let d: Record<string, unknown>
  try {
    d = JSON.parse(text)
  } catch {
    throw new Error(keyed('errors.notJson'))
  }
  if (!d || typeof d !== 'object' || d.format !== COMPOSITION_FORMAT) throw new Error(keyed('errors.notComposition'))
  if (typeof d.version !== 'number' || d.version > COMPOSITION_VERSION) throw new Error(keyed('errors.newer', { v: String(d.version) }))
  if (!Array.isArray(d.shapes)) throw new Error(keyed('errors.noShapes'))
  const shapes = d.shapes.map((raw: Record<string, unknown>, i: number): FileShape => {
    const n = i + 1
    if (!raw || typeof raw !== 'object') throw new Error(keyed('errors.notObject', { n }))
    if (!OPS.includes(raw.op as never)) throw new Error(keyed('errors.unknownOp', { n, v: String(raw.op) }))
    if (!TYPES.includes(raw.type as never)) throw new Error(keyed('errors.unknownShape', { n, v: String(raw.type) }))
    if (!COMP_BLOCKS.some((b) => b.t === raw.block)) throw new Error(keyed('errors.unknownBlock', { n, v: String(raw.block) }))
    if (!Number.isInteger(raw.shell) || (raw.shell as number) < 0 || (raw.shell as number) > 3) throw new Error(keyed('errors.wallRange', { n }))
    const tube = raw.tube ?? 5
    if (!Number.isInteger(tube) || (tube as number) < 1 || (tube as number) > 80) throw new Error(keyed('errors.tubeRange', { n }))
    const rot = raw.rot ?? ROT_IDENTITY
    if (!isRotation(rot)) throw new Error(keyed('errors.rotation', { n }))
    return {
      op: raw.op as FileShape['op'],
      type: raw.type as FileShape['type'],
      size: vec3(raw.size, 'errors.sizeRange', n, 1, MAX_DIM),
      pos: vec3(raw.pos, 'errors.offsetRange', n, -200, 200),
      block: raw.block as number,
      shell: raw.shell as number,
      tube: tube as number,
      rot: [...rot],
    }
  })
  const grid = d.grid === 'Small' ? 'Small' : d.grid === 'Large' || d.grid === undefined ? 'Large' : null
  if (!grid) throw new Error(keyed('errors.unknownGrid', { v: String(d.grid) }))
  return { name: typeof d.name === 'string' ? d.name : '', grid, shapes }
}
