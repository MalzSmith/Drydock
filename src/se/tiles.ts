import { TOPO_SLOPE2BASE, TOPO_SLOPE2TIP } from './defs.ts'

export type Tile = { m: number[]; n: [number, number, number]; f: number; id?: string }
export type Topology = { name: string; tiles: Tile[]; edges: Array<[[number, number, number], [number, number, number]]>; uniq: Array<number | null> }
export type TileTable = { v: number; topologies: Topology[]; grid: Record<string, Array<{ s: [number, number, number]; m: number[] }>> }

export const TILE_FULL = 1
export const TILE_DONT_OFFSET = 2
export const TILE_ID_NULL = 4

let tableP: Promise<TileTable> | null = null

export function loadTileTable(): Promise<TileTable> {
  tableP ??= import('../data/tile-table.json').then((m) => (m as unknown as { default: TileTable }).default)
  return tableP
}

const mod = (x: number, m: number) => ((x % m) + m) % m
const zero = (v: number) => Math.abs(v) < 0.01
const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0)

export function patternOffset(
  topology: number,
  tile: Tile,
  nx: number,
  ny: number,
  nz: number,
  cx: number,
  cy: number,
  cz: number,
  patW: number,
  patH: number,
  sx: number,
  sy: number,
  patternScale: number,
  out: Float32Array,
  o: number,
) {
  const scale = Math.max(1, Math.trunc(patternScale))
  const px = Math.max(1, patW * scale)
  const py = Math.max(1, patH * scale)
  const big = 32768
  let x = cx
  let y = cy
  let z = cz
  nx = Math.fround(nx)
  ny = Math.fround(ny)
  nz = Math.fround(nz)
  if (topology === TOPO_SLOPE2BASE && tile.f & TILE_ID_NULL) {
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
    if (ax >= ay && ax >= az) x -= sign(nx)
    else if (ay >= az) y -= sign(ny)
    else z -= sign(nz)
  }
  const slope2 = topology === TOPO_SLOPE2BASE || topology === TOPO_SLOPE2TIP
  const idiv = (a: number, b: number) => Math.trunc(a / b)
  const wob = (a: number) => mod(a + Math.trunc(a * Math.sin(Math.fround(a * 10))), px)
  let u = 0
  let v = 0
  if (zero(Math.abs(ny) - 1)) {
    const a = idiv(x + big, py)
    u = mod(z + y + wob(a) + big, px)
    v = mod(x + big, py)
    if (sign(ny) === 1) v = py - 1 - v
  } else if (zero(Math.abs(nx) - 1)) {
    const a = idiv(z + big, py)
    u = mod(x + y + wob(a) + big, px)
    v = mod(z + big, py)
    if (sign(nx) === 1) v = py - 1 - v
  } else if (zero(Math.abs(nz) - 1)) {
    const a = idiv(y + big, py)
    u = mod(x + wob(a) + big, px)
    v = mod(y + big, py)
    if (sign(nz) === 1) u = px - 1 - u
  } else if (zero(nx)) {
    u = mod(x * sx + big, px)
    v = mod(z * sy + big, py)
    if (sign(nz) === -1) {
      if (sign(ny) === 1) {
        if (slope2 && nz < -0.5) {
          u = mod(x * sx + big, px)
          v = mod(y * sy + big, py)
        } else {
          v = py - 1 - v
          u = px - 1 - u
        }
      } else if (slope2) {
        if (nz < -0.5) {
          u = px - 1 - mod(x * sx + big, px)
          v = py - 1 - mod(y * sy + big, py)
        } else v = py - 1 - v
      } else v = py - 1 - v
    } else if (sign(ny) === -1) {
      if (slope2 && nz > 0.5) {
        u = mod(x * sx + big, px)
        v = py - 1 - mod(y * sy + big, py)
      } else u = px - 1 - u
    } else if (slope2 && !(ny > 0.5)) {
      u = px - 1 - mod(x * sx + big, px)
      v = mod(y * sy + big, py)
    }
  } else if (zero(nz)) {
    u = mod(z * sx + big, px)
    v = mod(x * sy + big, py)
    if (sign(nx) === 1) {
      if (sign(ny) === 1) {
        if (slope2 && nx > 0.5) {
          u = mod(z * sx + big, px)
          v = mod(y * sy + big, py)
        } else u = px - 1 - u
      } else if (slope2 && !(ny < -0.5)) {
        u = px - 1 - mod(z * sx + big, px)
        v = py - 1 - mod(y * sy + big, py)
      }
    } else if (sign(ny) === 1) {
      if (slope2 && !(ny > 0.5)) {
        u = px - 1 - mod(z * sx + big, px)
        v = mod(y * sy + big, py)
      } else v = py - 1 - v
    } else if (slope2) {
      if (ny < -0.5) {
        u = px - 1 - u
        v = py - 1 - v
      } else {
        u = mod(z * sx + big, px)
        v = py - 1 - mod(y * sy + big, py)
      }
    } else {
      u = px - 1 - u
      v = py - 1 - v
    }
  } else if (zero(ny)) {
    u = mod(y * sx + big, px)
    v = mod(z * sy + big, py)
    if (sign(nz) === -1) {
      if (sign(nx) === 1) {
        if (slope2) {
          if (nz < -0.5) u = px - 1 - u
          v = py - 1 - v
        } else u = px - 1 - u
      } else if (slope2) {
        if (!(nz < -0.5)) u = px - 1 - u
        v = py - 1 - v
      }
    } else if (sign(nx) === 1) {
      if (slope2) {
        if (nx > 0.5) u = px - 1 - u
        else {
          u = mod(y * sx + big, px)
          v = mod(x * sy + big, py)
        }
      } else v = py - 1 - v
    } else if (slope2) {
      if (!(nx < -0.5)) {
        u = px - 1 - mod(y * sx + big, px)
        v = py - 1 - mod(x * sy + big, py)
      }
    } else {
      u = px - 1 - u
      v = py - 1 - v
    }
  }
  if (tile.f & TILE_DONT_OFFSET) {
    u = 0
    v = 0
  }
  const pu = 1 + ((px - 1) & 15)
  const pv = 1 + ((py - 1) & 15)
  out[o] = (u & 255) / pu
  out[o + 1] = (v & 255) / pv
}
