import { describe, expect, it } from 'vitest'
import { parseBlueprint } from '../src/se/blueprint.ts'
import { buildLookup, pilotBlock, resolveBlueprint, type DefRecord } from '../src/se/defs.ts'

const block = (type: string, sub: string, min: [number, number, number], fwd = 'Forward', up = 'Up', extra = '') =>
  `<MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_${type}"><SubtypeName>${sub}</SubtypeName><Min x="${min[0]}" y="${min[1]}" z="${min[2]}" /><BlockOrientation Forward="${fwd}" Up="${up}" />${extra}</MyObjectBuilder_CubeBlock>`

const bp = (...blocks: string[]) =>
  parseBlueprint(`<Definitions><ShipBlueprints><ShipBlueprint><Id Type="X" Subtype="S" /><CubeGrids><CubeGrid><GridSizeEnum>Large</GridSizeEnum><CubeBlocks>
${blocks.join('\n')}
</CubeBlocks></CubeGrid></CubeGrids></ShipBlueprint></ShipBlueprints></Definitions>`)

const hull = [block('CubeBlock', 'A', [0, 0, 0]), block('CubeBlock', 'A', [9, 0, 0]), block('CubeBlock', 'A', [0, 2, 0])]

describe('pilot block', () => {
  it('prefers the main cockpit, then a named cockpit, then a seat, then a remote control', () => {
    const remote = block('RemoteControl', 'LargeBlockRemoteControl', [1, 1, 1])
    const seat = block('Cockpit', 'PassengerSeatLarge', [2, 1, 1])
    const desk = block('Cockpit', 'LargeBlockLabDeskSeat', [3, 1, 1])
    const named = block('Cockpit', 'LargeBlockCockpitSeat', [4, 1, 1])
    const main = block('RemoteControl', 'LargeBlockRemoteControl', [5, 1, 1], 'Forward', 'Up', '<IsMainCockpit>true</IsMainCockpit>')
    expect(pilotBlock(bp(...hull, remote))).toBe(3)
    expect(pilotBlock(bp(...hull, remote, seat))).toBe(3)
    expect(pilotBlock(bp(...hull, remote, seat, desk))).toBe(3)
    expect(pilotBlock(bp(...hull, remote, seat, desk, block('Cockpit', 'LargeBlockBathroom', [6, 1, 1])))).toBe(3)
    expect(pilotBlock(bp(...hull, seat, desk, block('Cockpit', 'KOLT_console_cubby_chair', [6, 1, 1])))).toBe(5)
    expect(pilotBlock(bp(...hull, remote, seat, desk, named))).toBe(6)
    expect(pilotBlock(bp(...hull, remote, seat, desk, named, main))).toBe(7)
    expect(pilotBlock(bp(...hull))).toBe(-1)
  })

  it('ignores main-cockpit flags inside projected blueprints', () => {
    const projector = block('Projector', 'LargeProjector', [1, 1, 1], 'Forward', 'Up', '<ProjectedGrids><CubeGrid><CubeBlocks>' + block('Cockpit', 'OpenCockpitLarge', [0, 0, 0], 'Forward', 'Up', '<IsMainCockpit>true</IsMainCockpit>') + '</CubeBlocks></CubeGrid></ProjectedGrids>')
    const seat = block('Cockpit', 'LargeBlockCockpitSeat', [2, 1, 1])
    const p = bp(...hull, projector, seat)
    expect(pilotBlock(p)).toBe(4)
  })

  it('derives the pilot of an older cached parse from its block list', () => {
    const p = bp(...hull, block('RemoteControl', 'LargeBlockRemoteControl', [1, 1, 1]), block('Cockpit', 'LargeBlockCockpitSeat', [2, 1, 1]))
    delete p.grids[0].pilot
    expect(pilotBlock(p)).toBe(4)
  })

  it('turns the model so the pilot faces -Z with +Y up', () => {
    const defs: DefRecord[] = [{ type: 'CubeBlock', subtype: 'A', large: true, size: [1, 1, 1], name: 'A', source: 'game' }]
    const plain = resolveBlueprint(bp(...hull), buildLookup([defs]), 'placeholder').model
    expect(plain.dims).toEqual([10, 3, 1])
    const turned = resolveBlueprint(bp(...hull, block('Cockpit', 'LargeBlockCockpit', [0, 0, 0], 'Right', 'Up')), buildLookup([defs]), 'placeholder').model
    expect(turned.dims).toEqual([1, 3, 10])
    expect(turned.lengthM).toBe(25)
    const lying = resolveBlueprint(bp(...hull, block('Cockpit', 'LargeBlockCockpit', [0, 0, 0], 'Forward', 'Right')), buildLookup([defs]), 'placeholder').model
    expect(lying.dims).toEqual([3, 10, 1])
  })
})
