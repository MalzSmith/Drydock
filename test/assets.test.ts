import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadMesh, loadTexture, type AssetEnv } from '../src/assets/build.ts'
import { assetKeys, defModels, modelCandidates } from '../src/assets/keys.ts'
import type { DefTuple } from '../src/se/defs.ts'
import { KIND_GLASS } from '../src/assets/material.ts'
import { parseMwm } from '../src/se/mwm.ts'

const root = process.env.SE_GAME_ROOT ?? 'C:/Program Files (x86)/Steam/steamapps/common/SpaceEngineers'
const content = join(root, 'Content')
const have = existsSync(join(content, 'Models'))

function diskEnv(): AssetEnv & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>()
  return {
    cache,
    has: (key) => key.startsWith('c:') && existsSync(join(content, key.slice(2))),
    async file(key) {
      if (!key.startsWith('c:')) return undefined
      const p = join(content, key.slice(2))
      if (!existsSync(p)) return undefined
      return new File([readFileSync(p)], p.split(/[\\/]/).pop()!, { lastModified: statSync(p).mtimeMs })
    },
    hasPrefix: (p) => p === 'c:',
    cacheGet: async <T,>(store: string, key: string) => cache.get(store + key) as T | undefined,
    cachePut: async (store, key, v) => {
      cache.set(store + key, v)
    },
  }
}

describe('asset keys', () => {
  const f = (path: string) => Object.assign(new File([''], path.split('/').pop()!), { webkitRelativePath: path }) as File
  it('maps game files under Content', () => {
    const keys = assetKeys('game', 1, [f('SpaceEngineers/Content/Models/Cubes/A.mwm'), f('SpaceEngineers/Bin64/x.dds')])
    expect(keys.map((k) => k[0])).toEqual(['c:models/cubes/a.mwm'])
  })
  it('maps workshop mod files to the mod key', () => {
    const keys = assetKeys('workshop', 7, [f('244850/123/Models/B.mwm'), f('244850/123/Textures/T.dds')])
    expect(keys.map((k) => k[0])).toEqual(['m:7/123:models/b.mwm', 'm:7/123:textures/t.dds'])
  })
  it('maps torch instances', () => {
    const keys = assetKeys('torch', 3, [f('Torch/Instance/content/244850/55/Models/C.mwm')])
    expect(keys.map((k) => k[0])).toEqual(['m:3/55:models/c.mwm'])
  })
  it('falls back from mod to content', () => {
    expect(modelCandidates('models/x.mwm', '1/2')).toEqual(['m:1/2:models/x.mwm', 'c:models/x.mwm'])
  })
  it('lists every block model of a definition set once', () => {
    const side: [string, number, number, number, number] = ['models/side.mwm', 4, 2, 1, 1]
    const defs: DefTuple[] = [
      ['CubeBlock', 'A', 1, 1, 1, 1, 'A', { topo: 0, sides: [side, side, ['models/side2.mwm', 4, 2, 1, 1]] }],
      ['BatteryBlock', 'B', 1, 1, 1, 1, 'B', { model: 'models/battery.mwm' }],
      ['BatteryBlock', 'C', 0, 1, 1, 1, 'C', { model: 'models/battery.mwm' }],
      ['Door', 'D', 1, 1, 1, 1, 'D'],
    ]
    expect(defModels(defs, null)).toEqual([['c:models/side.mwm'], ['c:models/side2.mwm'], ['c:models/battery.mwm']])
    expect(defModels(defs.slice(1, 2), '1/2')).toEqual([['m:1/2:models/battery.mwm', 'c:models/battery.mwm']])
  })
})

describe.skipIf(!have)('game assets', () => {
  it('builds an armor side model with textures', async () => {
    const env = diskEnv()
    const r = await loadMesh(env, modelCandidates('models/cubes/large/armor/squareplate.mwm', null))
    expect(r.status).toBe('ok')
    const m = r.data!
    expect(m.tris).toBeGreaterThan(0)
    expect(m.parts[0].tex?.cm?.[0]).toMatch(/^c:textures\/.*\.dds$/)
    const t = await loadTexture(env, m.parts[0].tex!.cm!, { s3tc: true, bptc: true })
    expect(t.status).toBe('ok')
    expect(t.data!.levels.length).toBeGreaterThan(1)
    const again = await loadMesh(env, modelCandidates('models/cubes/large/armor/squareplate.mwm', null))
    expect(again.data).toBe(r.data)
  })

  it('loads subparts and glass', async () => {
    const env = diskEnv()
    const door = await loadMesh(env, modelCandidates('models/cubes/large/centreddoorglass.mwm', null))
    expect(door.status).toBe('ok')
    const root = parseMwm(readFileSync(join(content, 'Models/Cubes/Large/CentredDoorGlass.mwm')).buffer as ArrayBuffer)
    expect(root.dummies.some((d) => d.name.includes('subpart_'))).toBe(true)
    expect(door.data!.pos.length).toBeGreaterThan(root.positions.length)
    expect(door.data!.parts.some((p) => p.kind === KIND_GLASS)).toBe(true)
    expect(root.parts.filter((p) => p.technique === 'GLASS').every((p) => typeof p.glassCcw === 'string')).toBe(true)
  })

  it('decodes textures to rgba without gpu formats', async () => {
    const env = diskEnv()
    const m = (await loadMesh(env, modelCandidates('models/cubes/large/batterylarge.mwm', null))).data!
    const ref = m.parts.find((p) => p.tex?.cm)!.tex!.cm!
    const t = (await loadTexture(env, ref, { s3tc: false, bptc: false })).data!
    expect(t.fmt).toBe('rgba')
    expect(t.levels[0].data.length).toBe(t.w * t.h * 4)
    expect(t.levels[t.levels.length - 1].w).toBe(1)
  })
})
