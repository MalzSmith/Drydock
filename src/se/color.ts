export const TEXTURE_VALUE = 0.85

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function paintColor(hx: number, hy: number, hz: number): [number, number, number] {
  const s = clamp01(hy + 0.8)
  const v = clamp01(TEXTURE_VALUE + hz - 0.1)
  const h = ((hx % 1) + 1) % 1
  const r = clamp01(Math.abs(h * 6 - 3) - 1)
  const g = clamp01(2 - Math.abs(h * 6 - 2))
  const b = clamp01(2 - Math.abs(h * 6 - 4))
  return [((r - 1) * s + 1) * v, ((g - 1) * s + 1) * v, ((b - 1) * s + 1) * v]
}

export function paintRgb24(hx: number, hy: number, hz: number): number {
  const [r, g, b] = paintColor(hx, hy, hz)
  return Math.round(r * 255) | (Math.round(g * 255) << 8) | (Math.round(b * 255) << 16)
}
