export const PBR = {
  key: [3.8, 3.7, 3.6],
  fill: [0.15, 0.15, 0.16],
  sky: [0.3, 0.3, 0.31],
  ground: [0.2, 0.2, 0.19],
  emissive: 1.6,
  exposure: 2,
  uniform: [1, 1, 1],
  glassDiffuse: 0.27,
  glassSky: [0.0024, 0.0028, 0.0036],
  glassGround: [0.0008, 0.0008, 0.0008],
}

export type GlassFallback = { color: [number, number, number, number]; add: [number, number, number, number]; reflectivity: number; fresnel: number; glossAdd: number; light: number }

export const GLASS_OUTER: GlassFallback = { color: [1, 1, 1, 0], add: [0, 0, 0, 0.85], reflectivity: 0.35, fresnel: 1, glossAdd: 0.6, light: 0.2 }

export const GLASS_INNER: GlassFallback = { color: [1, 1, 1, 0.15], add: [0, 0, 0, 0], reflectivity: 0.05, fresnel: 0.25, glossAdd: 0.6, light: 0.05 }
