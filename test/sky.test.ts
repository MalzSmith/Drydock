import { describe, expect, it } from 'vitest'
import { DEFAULT_ORIENTATION, parseSkies } from '../src/se/env.ts'
import { cubeTexel, readSky, skyMatrix } from '../src/assets/sky.ts'
import { scanSource, type ModCacheRec, type ScanCache } from '../src/sources/scan.ts'
import { dirHandle, tmpTree } from './fakefs.ts'

const env = (tex: string, orient = '') =>
  `<Definitions xmlns:xsi="x"><Definition xsi:type="EnvironmentDefinition"><Id><TypeId>EnvironmentDefinition</TypeId><SubtypeId>Default</SubtypeId></Id><EnvironmentTexture>${tex}</EnvironmentTexture>${orient}</Definition></Definitions>`

function memCache(): ScanCache {
  const mods = new Map<string, ModCacheRec>()
  return { getMod: async (k) => mods.get(k), putMod: async (k, r) => void mods.set(k, r), getBpMods: async () => undefined }
}

function cubeDds(size: number, mips: number, color: (face: number, level: number) => number[]): File {
  const head = new DataView(new ArrayBuffer(128))
  const U = (o: number, v: number) => head.setUint32(o, v, true)
  U(0, 0x20534444)
  U(4, 124)
  U(12, size)
  U(16, size)
  U(28, mips)
  U(76, 32)
  U(80, 0x41)
  U(88, 32)
  U(92, 0xff)
  U(96, 0xff00)
  U(100, 0xff0000)
  U(104, 0xff000000)
  U(112, 0xfe00)
  const parts: Uint8Array[] = [new Uint8Array(head.buffer)]
  for (let f = 0; f < 6; f++)
    for (let l = 0; l < mips; l++) {
      const s = Math.max(1, size >> l)
      const px = new Uint8Array(s * s * 4)
      for (let i = 0; i < s * s; i++) px.set(color(f, l), i * 4)
      parts.push(px)
    }
  return new File(parts as BlobPart[], 'sky.dds')
}

describe('skyboxes', () => {
  it('reads environment textures and treats XML orientation as radians', () => {
    expect(parseSkies(env('Textures\\Sky\\A.dds', '<EnvironmentOrientation Yaw="1.5" Pitch="-2" Roll="0.25" />'))).toEqual([{ path: 'Textures\\Sky\\A.dds', yaw: 1.5, pitch: -2, roll: 0.25 }])
    expect(parseSkies(env('B.dds'))).toEqual([{ path: 'B.dds', ...DEFAULT_ORIENTATION }])
    expect(parseSkies('<Definitions><CubeBlocks /></Definitions>')).toEqual([])
  })

  it('finds game skies with seasonal variants and mod skies without blocks', async () => {
    const vanilla = 'Textures\\BackgroundCube\\Final\\BackgroundCube.dds'
    const g = await scanSource(dirHandle(tmpTree({ 'Content/Data/Environment.sbc': env(vanilla, '<EnvironmentOrientation Yaw="1" Pitch="2" Roll="3" />') })), { kind: 'game', sourceId: 1, cache: memCache() })
    expect(g.skies?.map((s) => s.path.split('\\').pop())).toEqual(['BackgroundCube.dds', 'BackgroundCube_ScaryFace.dds', 'BackgroundCube_Christmas.dds'])
    expect(g.skies?.every((s) => s.yaw === 1 && s.pitch === 2 && s.roll === 3)).toBe(true)
    const tree = tmpTree({ '55/Data/Env.sbc': env('Textures\\Nebula.dds'), '55/modinfo.sbmi': '<ModInfo><Name>Nebula Pack</Name></ModInfo>' })
    const cache = memCache()
    const m = await scanSource(dirHandle(tree), { kind: 'mods', sourceId: 9, cache })
    expect(m.mods).toEqual([])
    expect(m.modSkies).toEqual([{ key: '9/55', name: 'Nebula Pack', skies: [{ path: 'Textures\\Nebula.dds', ...DEFAULT_ORIENTATION }] }])
    const again = await scanSource(dirHandle(tree), { kind: 'mods', sourceId: 9, cache })
    expect(again.modSkies).toEqual(m.modSkies)
  })

  it('reads one smaller mip level of each cube face', async () => {
    const f = cubeDds(8, 4, (face, level) => [face * 40, level * 60, 7, 255])
    const d = (await readSky(f, 2, true))!
    expect(d.size).toBe(2)
    expect(d.fmt).toBe('rgba')
    expect(d.faces.map((x) => [x[0], x[1], x[2]])).toEqual([0, 1, 2, 3, 4, 5].map((i) => [i * 40, 120, 7]))
    const flat = (await readSky(cubeDds(8, 1, (face) => [face, 0, 0, 255]), 2, true))!
    expect(flat.size).toBe(2)
    expect(flat.faces[5][0]).toBe(5)
  })

  it('samples the face that the major axis points at', () => {
    const faces = [0, 1, 2, 3, 4, 5].map((i) => new Uint8Array([i, 0, 0, 255]))
    const out = new Uint8Array(4)
    const pick = (x: number, y: number, z: number) => (cubeTexel(faces, 1, x, y, z, out, 0), out[0])
    expect([pick(1, 0, 0), pick(-1, 0, 0), pick(0, 1, 0), pick(0, -1, 0), pick(0, 0, 1), pick(0, 0, -1)]).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('applies the inverse orientation and flips Z like the game shader', () => {
    expect(skyMatrix([0, 0, 0]).map((v) => v + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, -1])
    const m = skyMatrix([Math.PI / 2, 0, 0])
    const r = [m[0] * 1 + m[2] * 0, m[3], m[6]].map((v) => Math.round(v))
    expect(r).toEqual([0, 0, -1])
  })
})
