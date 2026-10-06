import { parseXml, type XEl } from './xml.ts'

export type SkyDef = { path: string; yaw: number; pitch: number; roll: number }

const DEG = Math.PI / 180

export const DEFAULT_ORIENTATION = { yaw: 60.395554 * DEG, pitch: -61.186195 * DEG, roll: 90.90578 * DEG }

export const VANILLA_SKY = 'Textures\\BackgroundCube\\Final\\BackgroundCube.dds'

export const VANILLA_SEASONAL = ['Textures\\BackgroundCube\\Final\\BackgroundCube_ScaryFace.dds', 'Textures\\BackgroundCube\\Final\\BackgroundCube_Christmas.dds']

function walk(el: XEl, out: XEl[]) {
  for (const c of el.children) {
    if (c.children.some((x) => x.name === 'EnvironmentTexture')) out.push(c)
    else walk(c, out)
  }
}

export function parseSkies(text: string): SkyDef[] {
  if (!text.includes('<EnvironmentTexture')) return []
  const found: XEl[] = []
  walk(parseXml(text), found)
  const out: SkyDef[] = []
  for (const d of found) {
    const path = d.children.find((x) => x.name === 'EnvironmentTexture')?.text.trim()
    if (!path) continue
    const o = d.children.find((x) => x.name === 'EnvironmentOrientation')
    const num = (k: string, def: number) => {
      const v = o ? parseFloat(o.attrs[k] ?? '') : NaN
      return Number.isFinite(v) ? v : o ? 0 : def
    }
    out.push({ path, yaw: num('Yaw', DEFAULT_ORIENTATION.yaw), pitch: num('Pitch', DEFAULT_ORIENTATION.pitch), roll: num('Roll', DEFAULT_ORIENTATION.roll) })
  }
  return out
}
