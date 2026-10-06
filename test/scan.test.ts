import { describe, expect, it } from 'vitest'
import { fromTuples, buildLookup, resolveBlueprint } from '../src/se/defs.ts'
import { parseBlueprint } from '../src/se/blueprint.ts'
import { buildModIndex, pickMods } from '../src/se/mods.ts'
import { scanSource, type ModCacheRec, type ScanCache } from '../src/sources/scan.ts'
import { dirHandle, tmpTree } from './fakefs.ts'
import { treeFromFiles } from '../src/sources/fs.ts'

const def = (type: string, sub: string, size = '<Size x="1" y="1" z="1" />', cube = 'Large') =>
  `<Definition><Id><TypeId>${type}</TypeId><SubtypeId>${sub}</SubtypeId></Id><DisplayName>${sub} name</DisplayName><CubeSize>${cube}</CubeSize>${size}</Definition>`

const defs = (...d: string[]) => `<Definitions><CubeBlocks>${d.join('')}</CubeBlocks></Definitions>`

const bp = (name: string, ...subs: string[]) =>
  `<Definitions><ShipBlueprints><ShipBlueprint><Id Type="X" Subtype="${name}" /><CubeGrids><CubeGrid><GridSizeEnum>Large</GridSizeEnum><CubeBlocks>${subs
    .map((s, i) => `<MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_CubeBlock"><SubtypeName>${s}</SubtypeName><Min x="${i}" y="0" z="0" /></MyObjectBuilder_CubeBlock>`)
    .join('')}</CubeBlocks></CubeGrid></CubeGrids></ShipBlueprint></ShipBlueprints></Definitions>`

function memCache(): ScanCache & { mods: Map<string, ModCacheRec>; bp: Map<string, number> } {
  const mods = new Map<string, ModCacheRec>()
  const bp = new Map<string, number>()
  return {
    mods,
    bp,
    getMod: async (k) => mods.get(k),
    putMod: async (k, r) => void mods.set(k, r),
    getBpMods: async (k) => bp.get(k),
  }
}

describe('scanSource', () => {
  it('indexes workshop mods, reuses the cache, and lists blueprints', async () => {
    const root = tmpTree({
      '1001/Data/CubeBlocks_A.sbc': defs(def('CubeBlock', 'ModArmor'), def('Thrust', 'ModThruster', '<Size x="2" y="1" z="3" />')),
      '1001/Data/Other.sbc': '<Definitions><Components /></Definitions>',
      '1001/modinfo.sbmi': '<ModInfo><Name>Cool Mod</Name></ModInfo>',
      '1002/Data/Prefabs/skip.sbc': defs(def('CubeBlock', 'Hidden')),
      '1003/bp.sbc': bp('Boat', 'ModArmor'),
      '1004/bp.sbc': bp('Small Boat', 'X').replace('Large', 'Small'),
      '1005/readme.txt': 'nothing',
    })
    const cache = memCache()
    const progress: string[] = []
    const r = await scanSource(dirHandle(root), { kind: 'workshop', sourceId: 7, cache, progress: (d) => progress.push(d) })
    expect(r.mods.map((m) => [m.key, m.name, m.subs.sort()])).toEqual([['7/1001', 'Cool Mod', ['modarmor', 'modthruster']]])
    expect(r.entries.map((e) => [e.name, e.large])).toEqual([['Boat', true], ['Small Boat', false]])
    expect(progress.filter((t) => t.startsWith('Indexing mods')).length).toBe(5)
    const rec = cache.mods.get('7/1001')!
    expect(rec.defs.length).toBe(2)

    cache.bp.set(`7/1003|${r.entries[0].modified}`, 2)
    cache.mods.set('7/1001', { ...rec, name: 'cached marker' })
    const again = await scanSource(dirHandle(root), { kind: 'workshop', sourceId: 7, cache })
    expect(again.mods[0].name).toBe('cached marker')
    expect(again.entries[0].mods).toBe(2)
  })

  it('rebuilds a mod when its files change', async () => {
    const root = tmpTree({ 'm/Data/a.sbc': defs(def('CubeBlock', 'One')) })
    const cache = memCache()
    await scanSource(dirHandle(root), { kind: 'mods', sourceId: 1, cache })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(root + '/m/Data/a.sbc', defs(def('CubeBlock', 'One'), def('CubeBlock', 'Two')))
    const r = await scanSource(dirHandle(root), { kind: 'mods', sourceId: 1, cache })
    expect(r.mods[0].subs.sort()).toEqual(['one', 'two'])
  })

  it('scans a game folder with names from the resx', async () => {
    const root = tmpTree({
      'Content/Data/CubeBlocks/a.sbc': defs(def('CubeBlock', 'G1').replace('G1 name', 'DisplayName_G1')),
      'Content/Data/Prefabs/p.sbc': defs(def('CubeBlock', 'Nope')),
      'Content/Data/Localization/MyTexts.resx': '<root><data name="DisplayName_G1" xml:space="preserve"><value>Game One</value></data></root>',
    })
    const r = await scanSource(dirHandle(root), { kind: 'game', sourceId: 1, cache: memCache() })
    expect(r.found).toBe(true)
    expect(r.defs).toEqual([['CubeBlock', 'G1', 1, 1, 1, 1, 'Game One']])
    const missing = await scanSource(dirHandle(tmpTree({ 'x/y.txt': '' })), { kind: 'game', sourceId: 1, cache: memCache() })
    expect(missing.found).toBe(false)
  })

  it('finds blueprints under local/ and torch content/244850', async () => {
    const a = tmpTree({ 'local/Ship/bp.sbc': bp('Ship', 'A'), 'other/bp.sbc': bp('No', 'A') })
    const r = await scanSource(dirHandle(a), { kind: 'blueprints', sourceId: 2, cache: memCache() })
    expect(r.entries.map((e) => e.name)).toEqual(['Ship'])
    const t = tmpTree({ 'Instance/content/244850/55/Data/a.sbc': defs(def('CubeBlock', 'TorchBlock')) })
    const tr = await scanSource(dirHandle(t), { kind: 'torch', sourceId: 3, cache: memCache() })
    expect(tr.mods.map((m) => m.folder)).toEqual(['55'])
  })
})

describe('pickMods', () => {
  it('picks greedily by covered blocks and reports the uncovered rest', () => {
    const parsed = parseBlueprint(bp('B', 'LargeBlockArmorBlock', 'A', 'A', 'A', 'B', 'C', 'Z'))
    const base = buildLookup([fromTuples([['CubeBlock', 'LargeBlockArmorBlock', 1, 1, 1, 1, 'Armor']], 'vanilla')])
    const index = buildModIndex([
      { key: 'm1', subs: ['a'] },
      { key: 'm2', subs: ['a', 'b'] },
      { key: 'm3', subs: ['c'] },
    ])
    const p = pickMods(parsed, base, index)
    expect(p.picked).toEqual([
      { key: 'm2', blocks: 4 },
      { key: 'm3', blocks: 1 },
    ])
    expect(p.uncoveredBlocks).toBe(1)
    expect(p.uncoveredTypes).toBe(1)
    expect(p.uncovered).toEqual([{ key: parsed.strings.find((k) => k.endsWith('/Z')), blocks: 1 }])
  })

  it('resolves mod blocks with their sizes and marks them modded', () => {
    const parsed = parseBlueprint(bp('B', 'ModThruster'))
    const lookup = buildLookup([fromTuples([['Thrust', 'ModThruster', 1, 2, 1, 3, 'Mod Thruster']], 'm1')])
    const r = resolveBlueprint(parsed, lookup, 'placeholder', new Map([['m1', 'Mod One']]))
    expect(r.model.dims).toEqual([2, 1, 3])
    expect(r.rows[0]).toMatchObject({ name: 'Mod Thruster', source: 'Mod One', modded: true, missing: false })
    const f = new Float32Array(r.model.grids[0].inst)
    expect(f[7]).toBe(2)
  })
})

const upload = (files: Record<string, string>, root: string, mtime = 1000) =>
  Object.entries(files).map(([rel, text]) => {
    const f = new File([text], rel.split('/').pop()!, { lastModified: mtime })
    Object.defineProperty(f, 'webkitRelativePath', { value: `${root}/${rel}` })
    return f
  })

describe('scan from an uploaded file list', () => {
  const tree = {
    '1001/Data/a.sbc': defs(def('CubeBlock', 'ModArmor')),
    '1001/modinfo.sbmi': '<ModInfo><Name>Up Mod</Name></ModInfo>',
    '1002/Data/b.sbc': defs(def('CubeBlock', 'Other')),
    '1003/bp.sbc': bp('Boat', 'ModArmor'),
  }

  it('lists mods and blueprints without any directory handle', async () => {
    const root = treeFromFiles(upload(tree, '244850'))
    expect(root.name).toBe('244850')
    const r = await scanSource(root, { kind: 'workshop', sourceId: 4, cache: memCache() })
    expect(r.mods.map((m) => m.name).sort()).toEqual(['1002', 'Up Mod'])
    expect(r.entries.map((e) => [e.name, e.file?.name])).toEqual([['Boat', 'bp.sbc']])
  })

  it('reuses a cached mod when path, size and mtime are unchanged and re-parses when they change', async () => {
    const cache = memCache()
    await scanSource(treeFromFiles(upload(tree, 'w')), { kind: 'mods', sourceId: 5, cache })
    const rec = cache.mods.get('5/1001')!
    cache.mods.set('5/1001', { ...rec, name: 'marker' })
    const same = await scanSource(treeFromFiles(upload(tree, 'w')), { kind: 'mods', sourceId: 5, cache })
    expect(same.mods.find((m) => m.folder === '1001')!.name).toBe('marker')
    const touched = await scanSource(treeFromFiles(upload(tree, 'w', 2000)), { kind: 'mods', sourceId: 5, cache })
    expect(touched.mods.find((m) => m.folder === '1001')!.name).toBe('Up Mod')
  })
})
