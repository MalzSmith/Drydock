import { describe, expect, it } from 'vitest'
import { QUARTER, ROT_IDENTITY } from '../src/compose/csg.ts'
import { compositionJson, parseComposition, type Composition } from '../src/compose/file.ts'

const comp: Composition = {
  name: 'Test Hull',
  grid: 'Small',
  shapes: [
    { op: 'add', type: 'torus', size: [25, 5, 25], pos: [0, -2, 6], block: 2, shell: 1, tube: 7, rot: QUARTER.x },
    { op: 'subtract', type: 'box', size: [3, 3, 3], pos: [1, 2, 3], block: 1, shell: 0, tube: 5, rot: ROT_IDENTITY },
  ],
}

describe('composition files', () => {
  it('round trips the shape stack, grid and name', () => {
    const text = compositionJson(comp)
    expect(JSON.parse(text)).toMatchObject({ format: 'drydock-composition', version: 1 })
    expect(parseComposition(text)).toEqual(comp)
  })

  it('fills defaults for optional fields', () => {
    const text = JSON.stringify({ format: 'drydock-composition', version: 1, shapes: [{ op: 'add', type: 'box', size: [1, 2, 3], pos: [0, 0, 0], block: 1, shell: 0 }] })
    expect(parseComposition(text)).toEqual({ name: '', grid: 'Large', shapes: [{ op: 'add', type: 'box', size: [1, 2, 3], pos: [0, 0, 0], block: 1, shell: 0, tube: 5, rot: ROT_IDENTITY }] })
  })

  it('rejects files it cannot open', () => {
    const bad = (shape: object) => JSON.stringify({ ...JSON.parse(compositionJson(comp)), shapes: [{ ...comp.shapes[0], ...shape }] })
    expect(() => parseComposition('nope')).toThrow(/Not a JSON/)
    expect(() => parseComposition('{"shapes":[]}')).toThrow(/Not a Drydock composition/)
    expect(() => parseComposition(JSON.stringify({ format: 'drydock-composition', version: 2, shapes: [] }))).toThrow(/newer/)
    expect(() => parseComposition(bad({ type: 'cone' }))).toThrow(/Shape 1: unknown shape/)
    expect(() => parseComposition(bad({ size: [0, 5, 5] }))).toThrow(/size/)
    expect(() => parseComposition(bad({ block: 99 }))).toThrow(/unknown block/)
    expect(() => parseComposition(bad({ rot: [1, 0, 0, 0, 1, 0, 0, 0, -1] }))).toThrow(/rotation/)
    expect(() => parseComposition(bad({ rot: [1, 1, 0, 0, 1, 0, 0, 0, 1] }))).toThrow(/rotation/)
  })
})
