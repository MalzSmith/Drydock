import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBlueprint } from '../src/se/blueprint.ts'

const finals = process.env.DRYDOCK_BP_DIR ?? ''
const files = finals && existsSync(finals)
  ? readdirSync(finals)
      .map((d) => join(finals, d, 'bp.sbc'))
      .filter(existsSync)
  : []

function grepCount(text: string): number {
  return text.split('<MyObjectBuilder_CubeBlock').length - 1
}

describe('parseBlueprint', () => {
  it('parses attributes and children forms', () => {
    const xml = `<Definitions><ShipBlueprints><ShipBlueprint><Id Type="X" Subtype="Boat" />
<CubeGrids><CubeGrid><PositionAndOrientation><Position x="1" y="2" z="3" /><Forward x="0" y="0" z="-1" /><Up x="0" y="1" z="0" /></PositionAndOrientation>
<GridSizeEnum>Small</GridSizeEnum><CubeBlocks>
<MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_Cockpit"><SubtypeName>A</SubtypeName><Min x="1" y="-2" z="3" /><BlockOrientation Forward="Left" Up="Up" /><ColorMaskHSV x="0.5" y="-0.1" z="0.2" /></MyObjectBuilder_CubeBlock>
<MyObjectBuilder_CubeBlock><SubtypeId>B</SubtypeId><Min><X>4</X><Y>5</Y><Z>6</Z></Min><BlockOrientation><Forward>Down</Forward><Up>Forward</Up></BlockOrientation></MyObjectBuilder_CubeBlock>
</CubeBlocks></CubeGrid></CubeGrids></ShipBlueprint></ShipBlueprints></Definitions>`
    const bp = parseBlueprint(xml)
    expect(bp.name).toBe('Boat')
    expect(bp.strings).toEqual(['Cockpit/A', 'CubeBlock/B'])
    const g = bp.grids[0]
    expect(g.large).toBe(false)
    expect(Array.from(g.min)).toEqual([1, -2, 3, 4, 5, 6])
    expect(Array.from(g.orient)).toEqual([2 * 6 + 4, 5 * 6 + 0])
    expect(g.hsv[0]).toBeCloseTo(0.5)
    expect(g.hsv[4]).toBeCloseTo(-0.8)
    expect(g.world[12]).toBe(1)
  })

  it('ignores nested blocks and nested CubeBlocks outside the grid list', () => {
    const xml = `<CubeGrids><CubeGrid><ComponentContainer><CubeBlocks /></ComponentContainer><GridSizeEnum>Large</GridSizeEnum><CubeBlocks>
<MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_Projector"><SubtypeName>P</SubtypeName><Min x="0" y="0" z="0" /><Proj><CubeBlocks><MyObjectBuilder_CubeBlock><SubtypeName>N</SubtypeName></MyObjectBuilder_CubeBlock></CubeBlocks></Proj></MyObjectBuilder_CubeBlock>
<MyObjectBuilder_CubeBlock><SubtypeName>Q</SubtypeName><Min x="1" y="0" z="0" /></MyObjectBuilder_CubeBlock>
</CubeBlocks></CubeGrid></CubeGrids>`
    const bp = parseBlueprint(xml)
    expect(bp.grids[0].key.length).toBe(2)
    expect(bp.strings).toEqual(['Projector/P', 'CubeBlock/Q'])
  })

  it('sorts grids by weighted block count', () => {
    const blk = (x: number) => `<MyObjectBuilder_CubeBlock><SubtypeName>A</SubtypeName><Min x="${x}" y="0" z="0" /></MyObjectBuilder_CubeBlock>`
    const xml = `<CubeGrids><CubeGrid><GridSizeEnum>Small</GridSizeEnum><CubeBlocks>${blk(0)}${blk(1)}${blk(2)}</CubeBlocks></CubeGrid><CubeGrid><GridSizeEnum>Large</GridSizeEnum><CubeBlocks>${blk(0)}</CubeBlocks></CubeGrid></CubeGrids>`
    const bp = parseBlueprint(xml)
    expect(bp.grids.map((g) => g.large)).toEqual([true, false])
  })

  it.skipIf(!files.length)('matches grep block counts on reference ships', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      const bp = parseBlueprint(text)
      const total = bp.grids.reduce((n, g) => n + g.key.length, 0)
      expect(total, f).toBe(grepCount(text))
    }
  })
})
