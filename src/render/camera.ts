import { Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three'

export type View = { yaw: number; pitch: number; zoom: number }

function presetFromDir(x: number, y: number, z: number): [number, number] {
  const len = Math.hypot(x, y, z)
  return [Math.atan2(x, -z), Math.asin(-y / len)]
}

export const PRESETS: Record<string, [number, number]> = {
  iso: presetFromDir(1, -0.75, 1.1),
  front: [Math.PI, 0.12],
  side: [Math.PI / 2, 0.05],
  top: [Math.PI / 2, 1.5707],
  rear: [0, 0.18],
}

export const FOV = 35
export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 6

export type Rect = { x: number; y: number; w: number; h: number }

export function aspectOf(s: string): number {
  const [a, b] = s.split(':').map(Number)
  return a / b
}

export function frameRect(W: number, H: number, aspect: number): Rect {
  const px = 24
  const py = 60
  let fw = W - px * 2
  let fh = fw / aspect
  if (fh > H - py * 2) {
    fh = H - py * 2
    fw = fh * aspect
  }
  return { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh }
}

export function stepView(v: View, target: View | null, dt: number): boolean {
  if (!target) return false
  const k = Math.min(1, dt * 9)
  const dy = wrapAngle(target.yaw - v.yaw)
  const dp = wrapAngle(target.pitch - v.pitch)
  v.yaw += dy * k
  v.pitch += dp * k
  v.zoom += (target.zoom - v.zoom) * k
  return !(Math.abs(dy) < 1e-3 && Math.abs(dp) < 1e-3 && Math.abs(target.zoom - v.zoom) < 1e-3)
}

export function wrapAngle(a: number): number {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

const rot = new Matrix4()
const q = new Quaternion()

export type Bounds = { center: [number, number, number]; radius: number; min: [number, number, number]; max: [number, number, number] }

export type Vec3 = [number, number, number]

export type Fit = { dist: number; half: number }

export const FIT_FILL = 0.85

export type FitGrid = { cell: number; toMain: Float32Array; inst: Float32Array; count: number }

export function centerOfMass(grids: FitGrid[]): Vec3 {
  let x = 0, y = 0, z = 0, n = 0
  for (const g of grids) {
    const m = g.toMain
    const f = g.inst
    for (let i = 0; i < g.count; i++) {
      const o = i * 8
      const lx = (f[o] + (f[o + 3] - 1) * 0.5) * g.cell
      const ly = (f[o + 1] + (f[o + 4] - 1) * 0.5) * g.cell
      const lz = (f[o + 2] + (f[o + 5] - 1) * 0.5) * g.cell
      x += lx * m[0] + ly * m[4] + lz * m[8] + m[12]
      y += lx * m[1] + ly * m[5] + lz * m[9] + m[13]
      z += lx * m[2] + ly * m[6] + lz * m[10] + m[14]
      n++
    }
  }
  return n ? [x / n, y / n, z / n] : [0, 0, 0]
}

export function computeFit(yaw: number, pitch: number, grids: FitGrid[], center: Vec3, aspect: number): Fit {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const tanV = Math.tan((FOV * Math.PI) / 360)
  const vx = [c, 0, s]
  const vy = [s * sp, cp, -c * sp]
  const vz = [-s * cp, sp, c * cp]
  const dot = (v: number[], a: number[]) => v[0] * a[0] + v[1] * a[1] + v[2] * a[2]
  let total = 0
  for (const g of grids) total += g.count
  const P = new Float32Array(total * 6)
  let n = 0
  for (const g of grids) {
    const m = g.toMain
    const ax = [m[0], m[1], m[2]]
    const ay = [m[4], m[5], m[6]]
    const az = [m[8], m[9], m[10]]
    const px = [dot(vx, ax), dot(vx, ay), dot(vx, az)]
    const py = [dot(vy, ax), dot(vy, ay), dot(vy, az)]
    const pz = [dot(vz, ax), dot(vz, ay), dot(vz, az)]
    const ox = m[12] - center[0]
    const oy = m[13] - center[1]
    const oz = m[14] - center[2]
    const t0 = vx[0] * ox + vx[1] * oy + vx[2] * oz
    const t1 = vy[0] * ox + vy[1] * oy + vy[2] * oz
    const t2 = vz[0] * ox + vz[1] * oy + vz[2] * oz
    const f = g.inst
    const cell = g.cell
    const h = cell * 0.5
    const ex0 = Math.abs(px[0]), ex1 = Math.abs(px[1]), ex2 = Math.abs(px[2])
    const ey0 = Math.abs(py[0]), ey1 = Math.abs(py[1]), ey2 = Math.abs(py[2])
    const ez0 = Math.abs(pz[0]), ez1 = Math.abs(pz[1]), ez2 = Math.abs(pz[2])
    for (let i = 0; i < g.count; i++, n++) {
      const o = i * 8
      const sx = f[o + 3], sy = f[o + 4], sz = f[o + 5]
      const lx = (f[o] + (sx - 1) * 0.5) * cell
      const ly = (f[o + 1] + (sy - 1) * 0.5) * cell
      const lz = (f[o + 2] + (sz - 1) * 0.5) * cell
      const q = n * 6
      P[q] = t0 + lx * px[0] + ly * px[1] + lz * px[2]
      P[q + 1] = t1 + lx * py[0] + ly * py[1] + lz * py[2]
      P[q + 2] = t2 + lx * pz[0] + ly * pz[1] + lz * pz[2]
      P[q + 3] = h * (sx * ex0 + sy * ex1 + sz * ex2)
      P[q + 4] = h * (sx * ey0 + sy * ey1 + sz * ey2)
      P[q + 5] = h * (sx * ez0 + sy * ez1 + sz * ez2)
    }
  }
  const kx = 1 / (tanV * aspect * FIT_FILL)
  const ky = 1 / (tanV * FIT_FILL)
  let dist = 1e-3
  let hx = 0
  let hy = 0
  for (let i = 0; i < total; i++) {
    const q = i * 6
    const ax = Math.abs(P[q]) + P[q + 3]
    const ay = Math.abs(P[q + 1]) + P[q + 4]
    const d = P[q + 2] + P[q + 5] + Math.max(ax * kx, ay * ky)
    if (d > dist) dist = d
    if (ax > hx) hx = ax
    if (ay > hy) hy = ay
  }
  const half = Math.max(hy, hx / aspect, 1e-3) / FIT_FILL
  return { dist, half }
}

export type CameraKit = {
  persp: PerspectiveCamera
  ortho: OrthographicCamera
}

export function createCameras(): CameraKit {
  return { persp: new PerspectiveCamera(FOV, 1, 0.1, 100), ortho: new OrthographicCamera(-1, 1, 1, -1, 0.1, 100) }
}

export function placeCameras(kit: CameraKit, view: View, b: Bounds, W: number, H: number, frame: Rect, fit: Fit): void {
  const c = Math.cos(view.yaw)
  const s = Math.sin(view.yaw)
  const cp = Math.cos(view.pitch)
  const sp = Math.sin(view.pitch)
  const r = Math.max(b.radius, 1e-3)
  const tanV = Math.tan((FOV * Math.PI) / 360)
  const dist = fit.dist / view.zoom
  rot.set(c, s * sp, -s * cp, 0, 0, cp, sp, 0, s, -c * sp, c * cp, 0, 0, 0, 0, 1)
  q.setFromRotationMatrix(rot)
  const zx = -s * cp
  const zy = sp
  const zz = c * cp
  const pos = new Vector3(b.center[0] + zx * dist, b.center[1] + zy * dist, b.center[2] + zz * dist)
  const near = Math.max(0.05 * r, dist - 2.5 * r)
  const far = dist + 2.5 * r
  const distO = 3 * r
  const posO = new Vector3(b.center[0] + zx * distO, b.center[1] + zy * distO, b.center[2] + zz * distO)
  const scale = H / frame.h
  const p = kit.persp
  p.position.copy(pos)
  p.quaternion.copy(q)
  p.fov = ((2 * Math.atan(tanV * scale)) * 180) / Math.PI
  p.aspect = W / H
  p.near = near
  p.far = far
  p.updateProjectionMatrix()
  p.updateMatrixWorld(true)
  const o = kit.ortho
  const hh = fit.half / view.zoom
  o.position.copy(posO)
  o.quaternion.copy(q)
  o.top = hh * scale
  o.bottom = -hh * scale
  o.right = hh * scale * (W / H)
  o.left = -o.right
  o.near = 0.5 * r
  o.far = distO + 3 * r
  o.updateProjectionMatrix()
  o.updateMatrixWorld(true)
}
