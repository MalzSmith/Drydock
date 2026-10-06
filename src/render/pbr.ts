export const PBR = {
  key: [2.2, 2.15, 2.05],
  fill: [0.45, 0.47, 0.52],
  sky: [0.32, 0.34, 0.38],
  ground: [0.12, 0.11, 0.1],
  emissive: 4,
  exposure: 0.8,
  glassDiffuse: 1,
  glassSky: [0.006, 0.007, 0.009],
  glassGround: [0.002, 0.002, 0.002],
}

export type GlassFallback = { color: [number, number, number, number]; add: [number, number, number, number]; reflectivity: number; fresnel: number; glossAdd: number; light: number }

export const GLASS_OUTER: GlassFallback = { color: [1, 1, 1, 0], add: [0, 0, 0, 0.85], reflectivity: 0.35, fresnel: 1, glossAdd: 0.6, light: 0.2 }

export const GLASS_INNER: GlassFallback = { color: [1, 1, 1, 0.15], add: [0, 0, 0, 0], reflectivity: 0.05, fresnel: 0.25, glossAdd: 0.6, light: 0.05 }
