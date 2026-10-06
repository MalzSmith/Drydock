import type { AppState, Info } from './app.ts'

const n = (v: number) => v.toLocaleString('en-US')

export const activeInfo = (s: AppState): Info | null => (s.mode === 'compose' ? s.composeInfo : s.info)

export function titleText(s: AppState): string {
  if (s.mode === 'compose') return s.compose.name
  return s.info ? s.info.name : 'No blueprint loaded'
}

export function dimsText(s: AppState): string {
  if (s.mode === 'compose') {
    const c = s.composeInfo
    return c ? `Composition · ${s.compose.grid} grid · ${c.dims[0]}×${c.dims[1]}×${c.dims[2]} blocks · ${n(c.blockCount)} placed` : `Composition · ${s.compose.grid} grid`
  }
  const i = s.info
  if (!i) return s.loading ? 'Loading…' : 'Drop a bp.sbc or a blueprint folder to open it'
  return `${i.large ? 'Large' : 'Small'} grid · ${i.dims[0]}×${i.dims[1]}×${i.dims[2]} blocks · ${i.lengthM.toFixed(1)} m long`
}

export function captionText(s: AppState): string {
  const i = s.info
  if (s.mode === 'compose' || !i) return dimsText(s)
  return `${i.large ? 'Large' : 'Small'} grid · ${n(i.blockCount)} ${i.blockCount === 1 ? 'block' : 'blocks'} · ${i.dims[0]}×${i.dims[1]}×${i.dims[2]} · ${i.lengthM.toFixed(1)} m long`
}

export function blocksText(s: AppState): string {
  const c = activeInfo(s)?.blockCount ?? 0
  return `${n(c)} ${c === 1 ? 'block' : 'blocks'}`
}

export function modSummary(s: AppState): string {
  const loaded = s.modRows.filter((r) => !r.missing && r.enabled).length
  return `${loaded} ${loaded === 1 ? 'mod' : 'mods'} loaded`
}

export function sourceStatus(s: AppState): { dot: boolean; text: string } {
  const src = s.sources
  const hasGame = src.some((r) => r.kind === 'game')
  const mods = src.filter((r) => r.kind === 'workshop' || r.kind === 'torch' || r.kind === 'mods').length
  if (hasGame) return { dot: true, text: `${src.length} source${src.length > 1 ? 's' : ''} linked${mods ? ` · ${mods} mod folder${mods > 1 ? 's' : ''}` : ''}` }
  return { dot: false, text: src.length ? 'Mods linked · no game folder yet' : 'No sources linked · vanilla blocks only' }
}

const KIND_LABEL: Record<string, string> = { game: 'Game', workshop: 'Workshop', torch: 'Torch', mods: 'Mods', blueprints: 'Blueprints' }

export const kindLabel = (k: string) => KIND_LABEL[k]

export function contentPath(s: AppState): string {
  return s.sources.length
    ? s.sources.map((r) => `${kindLabel(r.kind)}: ${r.name}`).join(' · ')
    : 'Link the game, workshop or a Torch instance to load textures, models and mods'
}
