import { COMP_BLOCKS } from '../compose/blocks.ts'
import type { Voxels } from '../compose/csg.ts'

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

export const MAX_EXPORT_BLOCKS = 1_000_000
export const WARN_EXPORT_BLOCKS = 50_000

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const blockLine = (sub: string, x: number, y: number, z: number) =>
  `            <MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_CubeBlock"><SubtypeName>${sub}</SubtypeName><Min x="${x}" y="${y}" z="${z}" /><BlockOrientation Forward="Forward" Up="Up" /><ColorMaskHSV x="0" y="-1" z="0" /><SkinSubtypeId /></MyObjectBuilder_CubeBlock>
`

function frame(name: string, size: 'Large' | 'Small'): { head: string; tail: string } {
  const n = esc(name)
  const head = `<?xml version="1.0"?>
<Definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <ShipBlueprints>
    <ShipBlueprint xsi:type="MyObjectBuilder_ShipBlueprintDefinition">
      <Id Type="MyObjectBuilder_ShipBlueprintDefinition" Subtype="${n}" />
      <DisplayName>${n}</DisplayName>
      <CubeGrids>
        <CubeGrid>
          <SubtypeName />
          <EntityId>${Date.now()}</EntityId>
          <PersistentFlags>CastShadows InScene</PersistentFlags>
          <PositionAndOrientation><Position x="0" y="0" z="0" /><Forward x="0" y="0" z="-1" /><Up x="0" y="1" z="0" /><Orientation><X>0</X><Y>0</Y><Z>0</Z><W>1</W></Orientation></PositionAndOrientation>
          <GridSizeEnum>${size}</GridSizeEnum>
          <CubeBlocks>
`
  const tail = `          </CubeBlocks>
          <DisplayName>${n}</DisplayName>
          <DestructibleBlocks>true</DestructibleBlocks>
          <IsRespawnGrid>false</IsRespawnGrid>
          <LocalCoordSys>0</LocalCoordSys>
          <TargetingTargets />
        </CubeGrid>
      </CubeGrids>
      <WorkshopId>0</WorkshopId>
      <OwnerSteamId>0</OwnerSteamId>
      <Points>0</Points>
    </ShipBlueprint>
  </ShipBlueprints>
</Definitions>
`
  return { head, tail }
}

export function writeSbc(v: Voxels, name: string, size: 'Large' | 'Small'): Blob {
  const subs = COMP_BLOCKS.map((b) => (size === 'Large' ? b.large : b.small))
  for (let i = 0; i < v.counts.length; i++) if (v.counts[i] && subs[i] === null) throw new Error(`${COMP_BLOCKS[i].name} has no small-grid variant`)
  const { head, tail } = frame(name, size)
  const [X, Y, Z] = v.dims
  const parts: string[] = [head]
  let chunk: string[] = []
  let i = 0
  for (let z = 0; z < Z; z++)
    for (let y = 0; y < Y; y++)
      for (let x = 0; x < X; x++, i++) {
        const t = v.grid[i]
        if (!t) continue
        chunk.push(
          `            <MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_CubeBlock"><SubtypeName>${subs[t - 1]}</SubtypeName><Min x="${x}" y="${y}" z="${z}" /><BlockOrientation Forward="Forward" Up="Up" /><ColorMaskHSV x="0" y="-1" z="0" /><SkinSubtypeId /></MyObjectBuilder_CubeBlock>\n`,
        )
        if (chunk.length >= 20000) {
          parts.push(chunk.join(''))
          chunk = []
        }
      }
  parts.push(chunk.join(''), tail)
  return new Blob(parts, { type: 'application/xml' })
}

const avgDigits = (n: number) => {
  let sum = 0
  for (let i = 0; i < n; i++) sum += String(i).length
  return sum / n
}

export function estimateSbcBytes(counts: number[], dims: [number, number, number], name: string, size: 'Large' | 'Small'): number {
  const { head, tail } = frame(name, size)
  const enc = new TextEncoder()
  const extra = avgDigits(dims[0]) + avgDigits(dims[1]) + avgDigits(dims[2]) - 3
  let bytes = enc.encode(head).length + enc.encode(tail).length
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i]) continue
    const sub = (size === 'Large' ? COMP_BLOCKS[i].large : COMP_BLOCKS[i].small) ?? COMP_BLOCKS[i].large
    bytes += counts[i] * (blockLine(sub, 0, 0, 0).length + extra)
  }
  return Math.round(bytes)
}
