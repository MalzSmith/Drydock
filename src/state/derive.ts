import { fmt as n, fmt1, tr } from '../i18n.ts'
import type { AppState, Info } from './app.ts'

const grid = (large: boolean) => tr(large ? 'units.gridLarge' : 'units.gridSmall')
const dims = (d: [number, number, number]) => `${d[0]}×${d[1]}×${d[2]}`
const blocks = (count: number) => tr('units.blocks', { count })
const length = (m: number) => tr('units.length', { length: fmt1(m) })

export const activeInfo = (s: AppState): Info | null => (s.mode === 'compose' ? s.composeInfo : s.info)

export function titleText(s: AppState): string {
  if (s.mode === 'compose') return s.compose.name
  return s.info ? s.info.name : tr('caption.noBlueprint')
}

export function dimsText(s: AppState): string {
  if (s.mode === 'compose') {
    const c = s.composeInfo
    const g = grid(s.compose.grid === 'Large')
    return c ? tr('caption.compositionFull', { grid: g, dims: tr('units.dims', { dims: dims(c.dims) }), count: n(c.blockCount) }) : tr('caption.composition', { grid: g })
  }
  const i = s.info
  if (!i) return tr(s.loading ? 'caption.loading' : 'caption.drop')
  return `${grid(i.large)} · ${tr('units.dims', { dims: dims(i.dims) })} · ${length(i.lengthM)}`
}

export function captionText(s: AppState): string {
  const i = s.info
  if (s.mode === 'compose' || !i) return dimsText(s)
  return `${grid(i.large)} · ${blocks(i.blockCount)} · ${dims(i.dims)} · ${length(i.lengthM)}`
}

export function blocksText(s: AppState): string {
  return blocks(activeInfo(s)?.blockCount ?? 0)
}

export function modSummary(s: AppState): string {
  const loaded = s.modRows.filter((r) => !r.missing && r.enabled).length
  return tr('library.modsLoaded', { count: loaded })
}

export function sourceStatus(s: AppState): { dot: boolean; text: string } {
  const src = s.sources
  const hasGame = src.some((r) => r.kind === 'game')
  const mods = src.filter((r) => r.kind === 'workshop' || r.kind === 'torch' || r.kind === 'mods').length
  if (hasGame) return { dot: true, text: tr('nav.sourcesLinked', { count: src.length }) + (mods ? ' · ' + tr('nav.modFolders', { count: mods }) : '') }
  return { dot: false, text: tr(src.length ? 'nav.modsNoGame' : 'nav.statusNoGame') }
}

export const kindLabel = (k: string) => tr('kinds.' + k)

export function contentPath(s: AppState): string {
  return s.sources.length
    ? s.sources.map((r) => tr('footer.source', { kind: kindLabel(r.kind), name: r.name })).join(' · ')
    : tr('footer.noSources')
}
