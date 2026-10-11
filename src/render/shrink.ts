export function shrinkTile(px: Uint8Array, tw: number, th: number, ss: number, unpremul: boolean): Uint8ClampedArray<ArrayBuffer> {
  const ow = tw / ss
  const oh = th / ss
  const out = new Uint8ClampedArray(ow * oh * 4)
  const acc = new Uint32Array(ow * 4)
  const n = ss * ss
  for (let oy = 0; oy < oh; oy++) {
    acc.fill(0)
    for (let sy = 0; sy < ss; sy++) {
      let i = (th - 1 - (oy * ss + sy)) * tw * 4
      for (let ox = 0; ox < ow; ox++) {
        const a = ox * 4
        for (let sx = 0; sx < ss; sx++, i += 4) {
          acc[a] += px[i]
          acc[a + 1] += px[i + 1]
          acc[a + 2] += px[i + 2]
          acc[a + 3] += px[i + 3]
        }
      }
    }
    let o = oy * ow * 4
    for (let a = 0; a < acc.length; a += 4, o += 4) {
      const al = Math.round(acc[a + 3] / n)
      const d = unpremul && al > 0 && al < 255 ? acc[a + 3] / 255 : n
      out[o] = acc[a] / d
      out[o + 1] = acc[a + 1] / d
      out[o + 2] = acc[a + 2] / d
      out[o + 3] = al
    }
  }
  return out
}
