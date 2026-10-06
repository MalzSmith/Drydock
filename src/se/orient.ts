export const BASE6 = ['Forward', 'Backward', 'Left', 'Right', 'Up', 'Down'] as const

export const BASE6_VEC: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
]

export function base6Index(name: string | undefined): number {
  const i = name === undefined ? -1 : BASE6.indexOf(name as (typeof BASE6)[number])
  return i
}

export type Mat = Float32Array

export function identity(): Mat {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

function norm(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : v
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function createWorld(pos: ArrayLike<number>, forward: ArrayLike<number>, up: ArrayLike<number>): Mat {
  const back = norm([-forward[0], -forward[1], -forward[2]])
  const right = norm(cross([up[0], up[1], up[2]], back))
  const realUp = cross(back, right)
  const m = new Float32Array(16)
  m.set([right[0], right[1], right[2], 0, realUp[0], realUp[1], realUp[2], 0, back[0], back[1], back[2], 0, pos[0], pos[1], pos[2], 1])
  return m
}

export function invertRigid(m: Mat): Mat {
  const r = identity()
  r[0] = m[0]; r[1] = m[4]; r[2] = m[8]
  r[4] = m[1]; r[5] = m[5]; r[6] = m[9]
  r[8] = m[2]; r[9] = m[6]; r[10] = m[10]
  const tx = m[12], ty = m[13], tz = m[14]
  r[12] = -(tx * r[0] + ty * r[4] + tz * r[8])
  r[13] = -(tx * r[1] + ty * r[5] + tz * r[9])
  r[14] = -(tx * r[2] + ty * r[6] + tz * r[10])
  return r
}

export function mul(a: Mat, b: Mat): Mat {
  const r = new Float32Array(16)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j]
      r[i * 4 + j] = s
    }
  return r
}

export function transformPoint(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [
    x * m[0] + y * m[4] + z * m[8] + m[12],
    x * m[1] + y * m[5] + z * m[9] + m[13],
    x * m[2] + y * m[6] + z * m[10] + m[14],
  ]
}

const SPAN = new Int8Array(36 * 9)

for (let f = 0; f < 6; f++)
  for (let u = 0; u < 6; u++) {
    const F = BASE6_VEC[f], U = BASE6_VEC[u]
    const m = createWorld([0, 0, 0], F, U)
    const o = (f * 6 + u) * 9
    const valid = Math.abs(F[0] * U[0] + F[1] * U[1] + F[2] * U[2]) < 0.5
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) SPAN[o + r * 3 + c] = valid ? Math.abs(Math.round(m[r * 4 + c])) : r === c ? 1 : 0
  }

export function rotatedExtent(sx: number, sy: number, sz: number, orient: number, out: Int32Array | number[]): void {
  const o = orient * 9
  const ax = sx - 1, ay = sy - 1, az = sz - 1
  out[0] = ax * SPAN[o] + ay * SPAN[o + 3] + az * SPAN[o + 6] + 1
  out[1] = ax * SPAN[o + 1] + ay * SPAN[o + 4] + az * SPAN[o + 7] + 1
  out[2] = ax * SPAN[o + 2] + ay * SPAN[o + 5] + az * SPAN[o + 8] + 1
}
