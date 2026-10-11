import type { ParsedBlueprint } from './blueprint.ts'

export type PickLayer = { key: string | null; subs: Set<string>; bare: Set<string> }

export function defLayer(key: string | null, defs: Array<{ type: string; subtype: string }>): PickLayer {
  const subs = new Set<string>()
  const bare = new Set<string>()
  for (const d of defs) {
    if (d.subtype) subs.add(d.subtype.toLowerCase())
    else bare.add(d.type.toLowerCase())
  }
  return { key, subs, bare }
}

export const modLayer = (m: { key: string; subs: string[]; bare: string[] }): PickLayer => ({ key: m.key, subs: new Set(m.subs), bare: new Set(m.bare) })

export type Picks = {
  picked: Array<{ key: string; blocks: number }>
  uncoveredTypes: number
  uncoveredBlocks: number
  uncovered: Array<{ key: string; blocks: number }>
}

export function pickMods(parsed: ParsedBlueprint, layers: PickLayer[]): Picks {
  const counts = new Array<number>(parsed.strings.length).fill(0)
  for (const g of parsed.grids) for (let i = 0; i < g.key.length; i++) counts[g.key[i]]++
  const claimed = new Map<string, number>()
  const uncovered: Picks['uncovered'] = []
  let uncoveredBlocks = 0
  parsed.strings.forEach((s, k) => {
    if (!counts[k]) return
    const at = s.indexOf('/')
    const type = s.slice(0, at).toLowerCase()
    const sub = s.slice(at + 1).toLowerCase()
    const owner = layers.find((l) => (sub ? l.subs.has(sub) : l.bare.has(type)))
    if (!owner) {
      uncovered.push({ key: s, blocks: counts[k] })
      uncoveredBlocks += counts[k]
    } else if (owner.key !== null) claimed.set(owner.key, (claimed.get(owner.key) ?? 0) + counts[k])
  })
  const picked = layers.flatMap((l) => (l.key !== null && claimed.has(l.key) ? [{ key: l.key, blocks: claimed.get(l.key)! }] : []))
  uncovered.sort((a, b) => b.blocks - a.blocks || a.key.localeCompare(b.key))
  return { picked, uncoveredTypes: uncovered.length, uncoveredBlocks, uncovered }
}
