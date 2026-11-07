export type StlWriter = { add(pos: Float32Array, idx: Uint32Array): void; finish(): Blob; tris: number }

// Binary STL: an 80-byte header, the triangle count, then 50 bytes per triangle (normal, three corners, attribute word).
// Slicers and CAD viewers read STL as Z up, so the game's Y-up metres are turned about X: (x, y, z) -> (x, -z, y).
export function stlWriter(): StlWriter {
  const parts: BlobPart[] = []
  let tris = 0
  return {
    get tris() {
      return tris
    },
    add(pos, idx) {
      const n = Math.floor(idx.length / 3)
      const buf = new ArrayBuffer(n * 50)
      const v = new DataView(buf)
      let o = 0
      for (let t = 0; t < n; t++) {
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
        const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2]
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
        const l = Math.hypot(nx, ny, nz)
        if (l > 0) {
          nx /= l
          ny /= l
          nz /= l
        }
        v.setFloat32(o, nx, true)
        v.setFloat32(o + 4, -nz, true)
        v.setFloat32(o + 8, ny, true)
        o += 12
        for (const i of [a, b, c]) {
          v.setFloat32(o, pos[i], true)
          v.setFloat32(o + 4, -pos[i + 2], true)
          v.setFloat32(o + 8, pos[i + 1], true)
          o += 12
        }
        v.setUint16(o, 0, true)
        o += 2
      }
      parts.push(buf)
      tris += n
    },
    finish() {
      const head = new ArrayBuffer(84)
      new Uint8Array(head).set(new TextEncoder().encode('Drydock binary STL, metres, Z up'))
      new DataView(head).setUint32(80, tris, true)
      return new Blob([head, ...parts], { type: 'model/stl' })
    },
  }
}
