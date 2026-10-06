import { describe, expect, it } from 'vitest'
import { parseGlass } from '../src/se/defs.ts'

const mat = (sub: string, body = '') => `<TransparentMaterial><Id><TypeId>TransparentMaterialDefinition</TypeId><SubtypeId>${sub}</SubtypeId></Id>${body}</TransparentMaterial>`

const vec = (tag: string, x: number, y: number, z: number, w: number) => `<${tag}><X>${x}</X><Y>${y}</Y><Z>${z}</Z><W>${w}</W></${tag}>`

const file = (...m: string[]) => `<Definitions><TransparentMaterials>${m.join('')}</TransparentMaterials></Definitions>`

describe('parseGlass', () => {
  it('ignores files without transparent materials', () => {
    expect(parseGlass('<Definitions><CubeBlocks /></Definitions>')).toEqual([])
  })

  it('applies defaults for missing elements', () => {
    expect(parseGlass(file(mat('Bare')))).toEqual([
      { sub: 'Bare', color: [1, 1, 1, 1], add: [0, 0, 0, 0], reflectivity: 0, fresnel: 0, glossAdd: 0, light: 1 },
    ])
  })

  it('parses colors, numbers and normalises texture paths', () => {
    const [g] = parseGlass(
      file(
        mat(
          'Pane',
          `<Texture>Textures\\Mods\\Pane_ca.dds</Texture><GlossTexture>/Textures/Mods/Pane_NG.dds</GlossTexture>${vec('Color', 0.5, 0.25, 2, 0.1)}${vec('ColorAdd', 0.1, 0.2, 0.3, 0.4)}<Reflectivity>0.6</Reflectivity><Fresnel>1.5</Fresnel><GlossTextureAdd>0.3</GlossTextureAdd>${vec('LightMultiplier', 0.2, 0.2, 0.2, 0.2)}`,
        ),
      ),
    )
    expect(g).toEqual({
      sub: 'Pane',
      tex: 'textures/mods/pane_ca.dds',
      gloss: 'textures/mods/pane_ng.dds',
      color: [0.5, 0.25, 2, 0.1],
      add: [0.1, 0.2, 0.3, 0.4],
      reflectivity: 0.6,
      fresnel: 1.5,
      glossAdd: 0.3,
      light: 0.2,
    })
  })

  it('keeps every material and skips ones without an id', () => {
    const list = parseGlass(file(mat('A'), '<TransparentMaterial><Texture>x</Texture></TransparentMaterial>', mat('B'), mat('C')))
    expect(list.map((g) => g.sub)).toEqual(['A', 'B', 'C'])
  })
})
