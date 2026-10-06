export const KIND_PAINT = 0
export const KIND_GLASS = 1
export const KIND_FIXED = 2
export const KIND_LIGHT = 3
export const KIND_HIDDEN = 4
export const KIND_DECAL = 5

export function classify(material: string, technique: string): number {
  const m = material.toLowerCase()
  if (technique === 'GLASS' || m.includes('glass') || m.includes('window')) return KIND_GLASS
  if (technique.startsWith('DECAL')) return KIND_DECAL
  if (technique === 'HOLO' || technique === 'SHIELD' || technique === 'SHIELD_LIT') return KIND_HIDDEN
  if (m.includes('emissive') || m.includes('light') || m.includes('screen') || m.includes('lcd') || m.includes('display')) return KIND_LIGHT
  if (m.includes('colorable') || m.includes('plate') || m.includes('triangle') || m.includes('armor')) return KIND_PAINT
  if (
    m.includes('yellow') || m.includes('black') || m.includes('rubber') || m.includes('dark') || m.includes('chrome') || m.includes('metal_dull') ||
    m.includes('metal_shiny') || m.includes('nozzle') || m.includes('white') || m.includes('doodad') || m.includes('terminal') || m.includes('fabric')
  )
    return KIND_FIXED
  return KIND_PAINT
}

export function fixedColor(material: string): [number, number, number] {
  const m = material.toLowerCase()
  if (m.includes('yellow')) return [0.86, 0.66, 0.12]
  if (m.includes('verydark') || m.includes('black') || m.includes('rubber')) return [0.13, 0.13, 0.14]
  if (m.includes('dark')) return [0.3, 0.31, 0.33]
  if (m.includes('white')) return [0.85, 0.85, 0.83]
  return [0.55, 0.56, 0.58]
}
