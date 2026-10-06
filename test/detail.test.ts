import { describe, expect, it } from 'vitest'
import table from '../src/data/tile-table.json'
import { FLAG_SHRINK, TOPO_BOX, type DefRecord, type RenderModel } from '../src/se/defs.ts'
import { identity } from '../src/se/orient.ts'
import type { TileTable } from '../src/se/tiles.ts'
import { FLAG_BEHIND, STRIDE, buildDetail, type MeshState } from '../src/render/detail.ts'
import type { MeshData } from '../src/assets/build.ts'

const plate: MeshData = {
  pos: new Float32Array(9),
  nrm: new Float32Array(9),
  uv: new Float32Array(6),
  idx: new Uint32Array([0, 1, 2]),
  parts: [],
  min: [0, 0, 0],
  max: [0, 0, 0],
  patternScale: 1,
  tris: 1,
}

const armor: DefRecord = {
  type: 'CubeBlock',
  subtype: 'LargeBlockArmorBlock',
  large: true,
  size: [1, 1, 1],
  name: 'Light Armor Block',
  source: 'game',
  render: { topo: TOPO_BOX, sides: Array.from({ length: 6 }, () => ['models/plate.mwm', 4, 2, 1, 1] as [string, number, number, number, number]) },
}
const battery: DefRecord = { type: 'BatteryBlock', subtype: 'LargeBlockBatteryBlock', large: true, size: [1, 1, 1], name: 'Battery', source: 'game', render: { model: 'models/battery.mwm' } }

function model(cells: Array<[number, number, number, number]>, defs: DefRecord[]): RenderModel {
  const n = cells.length
  const inst = new Float32Array(n * 8)
  const def = new Int32Array(n)
  cells.forEach(([x, y, z, d], i) => {
    inst.set([x, y, z, 1, 1, 1, 0, 0], i * 8)
    def[i] = d
  })
  return {
    name: 't',
    gridLarge: true,
    dims: [2, 1, 1],
    lengthM: 2.5,
    cellMin: [0, 0, 0],
    mainCell: 2.5,
    blockCount: n,
    boundsMin: [0, 0, 0],
    boundsMax: [5, 2.5, 2.5],
    grids: [{ cell: 2.5, toMain: identity(), inst: inst.buffer, count: n, detail: { def, orient: new Uint8Array(n).fill(4), hsv: new Float32Array(n * 3), skin: new Uint16Array(n) } }],
    defs,
    skins: [],
  }
}

const lookup = (status: MeshState['status']) => (c: string[]): MeshState => ({ status, key: c.join('|'), data: status === 'ok' ? plate : undefined })

describe('buildDetail', () => {
  it('moves armor faces between full cubes to section-only groups', () => {
    const s = buildDetail(model([[0, 0, 0, 0], [1, 0, 0, 0]], [armor]), table as unknown as TileTable, lookup('ok'))
    const front = s.groups.find((g) => !g.behind)!
    const back = s.groups.find((g) => g.behind)!
    expect(front.count).toBe(10)
    expect(back.count).toBe(2)
    expect(back.inst[24] & FLAG_BEHIND).toBe(FLAG_BEHIND)
    expect(back.inst.length).toBe(2 * STRIDE)
    expect(s.lines.length / 6).toBe(20)
  })

  it('keeps pending blocks as boxes and shrinks missing models', () => {
    const pending = buildDetail(model([[0, 0, 0, 0]], [battery]), table as unknown as TileTable, lookup('pending'))
    expect(pending.groups.length).toBe(0)
    expect(pending.boxes[0].count).toBe(1)
    expect(pending.boxes[0].inst[7] & FLAG_SHRINK).toBe(0)
    const missing = buildDetail(model([[0, 0, 0, 0]], [battery]), table as unknown as TileTable, lookup('missing'))
    expect(missing.boxes[0].inst[7] & FLAG_SHRINK).toBe(FLAG_SHRINK)
    expect(missing.missing).toBe(1)
  })

  it('draws armor with missing or uncached tile models as boxes, not bare edges', () => {
    for (const status of ['missing', 'uncached'] as const) {
      const s = buildDetail(model([[0, 0, 0, 0], [1, 0, 0, 0]], [armor]), table as unknown as TileTable, lookup(status))
      expect(s.groups.length).toBe(0)
      expect(s.lines.length).toBe(0)
      expect(s.boxes[0].count).toBe(2)
      expect(s.boxes[0].inst[7] & FLAG_SHRINK).toBe(FLAG_SHRINK)
    }
  })

  it('places a model at the block centre', () => {
    const s = buildDetail(model([[2, 0, 0, 0]], [battery]), table as unknown as TileTable, lookup('ok'))
    expect(Array.from(s.groups[0].inst.subarray(9, 12))).toEqual([5, 0, 0])
  })
})
