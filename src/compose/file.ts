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

const vec3 = (v: unknown, what: string, min: number, max: number): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => Number.isInteger(x) && x >= min && x <= max)) throw new Error(`${what} must be three whole numbers from ${min} to ${max}`)
  return [v[0], v[1], v[2]]
}

export function parseComposition(text: string): Composition {
  let d: Record<string, unknown>
  try {
    d = JSON.parse(text)
  } catch {
    throw new Error('Not a JSON file')
  }
  if (!d || typeof d !== 'object' || d.format !== COMPOSITION_FORMAT) throw new Error('Not a Drydock composition')
  if (typeof d.version !== 'number' || d.version > COMPOSITION_VERSION) throw new Error(`Composition version ${String(d.version)} is newer than this app supports`)
  if (!Array.isArray(d.shapes)) throw new Error('Composition has no shape list')
  const shapes = d.shapes.map((raw: Record<string, unknown>, i: number): FileShape => {
    const at = `Shape ${i + 1}`
    if (!raw || typeof raw !== 'object') throw new Error(`${at} is not an object`)
    if (!OPS.includes(raw.op as never)) throw new Error(`${at}: unknown operation ${String(raw.op)}`)
    if (!TYPES.includes(raw.type as never)) throw new Error(`${at}: unknown shape ${String(raw.type)}`)
    if (!COMP_BLOCKS.some((b) => b.t === raw.block)) throw new Error(`${at}: unknown block ${String(raw.block)}`)
    if (!Number.isInteger(raw.shell) || (raw.shell as number) < 0 || (raw.shell as number) > 3) throw new Error(`${at}: wall must be 0 to 3`)
    const tube = raw.tube ?? 5
    if (!Number.isInteger(tube) || (tube as number) < 1 || (tube as number) > 80) throw new Error(`${at}: tube must be 1 to 80`)
    const rot = raw.rot ?? ROT_IDENTITY
    if (!isRotation(rot)) throw new Error(`${at}: rotation is not a 90° turn`)
    return {
      op: raw.op as FileShape['op'],
      type: raw.type as FileShape['type'],
      size: vec3(raw.size, `${at}: size`, 1, MAX_DIM),
      pos: vec3(raw.pos, `${at}: offset`, -200, 200),
      block: raw.block as number,
      shell: raw.shell as number,
      tube: tube as number,
      rot: [...rot],
    }
  })
  const grid = d.grid === 'Small' ? 'Small' : d.grid === 'Large' || d.grid === undefined ? 'Large' : null
  if (!grid) throw new Error(`Unknown grid size ${String(d.grid)}`)
  return { name: typeof d.name === 'string' ? d.name : '', grid, shapes }
}
