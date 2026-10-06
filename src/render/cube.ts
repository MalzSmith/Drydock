import { BufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three'

export function cubeGeometry(): InstancedBufferGeometry {
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
  const g = new InstancedBufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setIndex(idx)
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
