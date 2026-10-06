import type { ParsedBlueprint } from './blueprint.ts'
import type { Lookup } from './defs.ts'

export type ModEntry = { key: string; subs: string[] }

export type ModIndex = { mods: ModEntry[]; bySub: Map<string, number[]> }

export function buildModIndex(mods: ModEntry[]): ModIndex {
  const bySub = new Map<string, number[]>()
  mods.forEach((m, i) => {
    for (const s of m.subs) {
      const l = bySub.get(s)
      if (l) l.push(i)
      else bySub.set(s, [i])
    }
  })
  return { mods, bySub }
}

export type Picks = {
  picked: Array<{ key: string; blocks: number }>
  uncoveredTypes: number
  uncoveredBlocks: number
  uncovered: Array<{ key: string; blocks: number }>
}

export function pickMods(parsed: ParsedBlueprint, base: Lookup, index: ModIndex): Picks {
  const counts = new Array<number>(parsed.strings.length).fill(0)
  for (const g of parsed.grids) for (let i = 0; i < g.key.length; i++) counts[g.key[i]]++
  const remaining = new Map<number, number>()
  parsed.strings.forEach((s, k) => {
    if (!counts[k]) return
    const at = s.indexOf('/')
    if (!base.find(s.slice(0, at), s.slice(at + 1), true)) remaining.set(k, counts[k])
  })
  const cover = new Map<number, number[]>()
  for (const k of remaining.keys()) {
    const s = parsed.strings[k]
    const mods = index.bySub.get(s.slice(s.indexOf('/') + 1).toLowerCase())
    if (!mods) continue
    for (const m of mods) {
      const l = cover.get(m)
      if (l) l.push(k)
      else cover.set(m, [k])
    }
  }
  const picked: Picks['picked'] = []
  for (;;) {
    let best = -1
    let bestBlocks = 0
    for (const [m, keys] of cover) {
      let n = 0
      for (const k of keys) n += remaining.get(k) ?? 0
      if (n > bestBlocks || (n === bestBlocks && n > 0 && index.mods[m].key > index.mods[best].key)) {
        best = m
        bestBlocks = n
      }
    }
    if (best < 0) break
    picked.push({ key: index.mods[best].key, blocks: bestBlocks })
    for (const k of cover.get(best)!) remaining.delete(k)
    cover.delete(best)
  }
  let uncoveredBlocks = 0
  for (const n of remaining.values()) uncoveredBlocks += n
  const uncovered = [...remaining].map(([k, blocks]) => ({ key: parsed.strings[k], blocks })).sort((a, b) => b.blocks - a.blocks || a.key.localeCompare(b.key))
  return { picked, uncoveredTypes: remaining.size, uncoveredBlocks, uncovered }
}
