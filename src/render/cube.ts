import { BufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three'

export type CubeData = { pos: Float32Array; nrm: Float32Array; idx: Uint32Array }

export function cubeData(): CubeData {
  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const faces: Array<[number[], number[], number[]]> = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ]
  faces.forEach(([n, u, v], f) => {
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      for (let k = 0; k < 3; k++) pos.push((n[k] > 0 ? 1 : 0) * Math.abs(n[k]) + u[k] * a + v[k] * b)
      nor.push(...n)
    }
    const o = f * 4
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3)
  })
  return { pos: new Float32Array(pos), nrm: new Float32Array(nor), idx: new Uint32Array(idx) }
}

export function cubeGeometry(): InstancedBufferGeometry {
  const d = cubeData()
  const g = new InstancedBufferGeometry()
  g.setAttribute('position', new BufferAttribute(d.pos, 3))
  g.setAttribute('normal', new BufferAttribute(d.nrm, 3))
  g.setIndex(Array.from(d.idx))
  return g
}

export function gridGeometry(inst: ArrayBuffer, count: number, cube: InstancedBufferGeometry): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.index = cube.index
  g.attributes.position = cube.attributes.position
  g.attributes.normal = cube.attributes.normal
  const ib = new InstancedInterleavedBuffer(new Float32Array(inst), 8, 1)
  g.setAttribute('i_min', new InterleavedBufferAttribute(ib, 3, 0))
  g.setAttribute('i_size', new InterleavedBufferAttribute(ib, 3, 3))
  g.setAttribute('i_color', new InterleavedBufferAttribute(ib, 1, 6))
  g.setAttribute('i_flags', new InterleavedBufferAttribute(ib, 1, 7))
  g.instanceCount = count
  return g
}
