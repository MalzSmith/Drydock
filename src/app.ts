import './styles/industry.css'
import './styles/app.css'
import { bootLocale, currentLang } from './i18n.ts'
import { installDrop } from './sources/drop.ts'
import { exportPerf } from './render/exportImage.ts'
import { PBR } from './render/pbr.ts'
import { restoreSources } from './sources/sources.ts'
import { actions, composePerf, getComposeModel, getModel, indexStats, perf, sectionCut, store } from './state/app.ts'
import { activeInfo } from './state/derive.ts'
import { mountBlueprintPanel } from './ui/blueprintPanel.ts'
import { mountComposePanel } from './ui/composePanel.ts'
import { mountFooter } from './ui/footer.ts'
import { mountNav } from './ui/nav.ts'
import { mountRight } from './ui/right/tabs.ts'
import { mountSourcesDialog } from './ui/sourcesDialog.ts'
import { mountMissingDialog } from './ui/missingDialog.ts'
import { mountTour } from './ui/tour.ts'
import { mountViewport } from './ui/viewport.ts'
import { loadCounter } from './util/count.ts'
import { errText, keyed } from './util/keyed.ts'

const $ = (id: string) => document.getElementById(id)!

await bootLocale()
store.set({ locale: currentLang() })

const q = new URLSearchParams(location.search)
if (q.get('w') || q.get('h')) {
  const app = $('app')
  if (q.get('w')) app.style.width = q.get('w') + 'px'
  if (q.get('h')) app.style.height = q.get('h') + 'px'
}

mountNav($('nav'))
const blueprintPanel = mountBlueprintPanel($('left'))
const composePanel = mountComposePanel($('left'))
const renderer = mountViewport($('view'))
mountRight($('right'), renderer)
mountFooter($('foot'))
mountSourcesDialog(document.body)
mountMissingDialog(document.body)
mountTour($('app'))

store.watch(
  (s) => s.mode,
  (mode) => {
    blueprintPanel.hidden = mode !== 'blueprint'
    composePanel.hidden = mode !== 'compose'
  },
)

store.watch(
  (s) => [s.render, s.scene, s.export.aspect, s.spin, s.section, activeInfo(s)] as const,
  ([render, scene, aspect, spin, section, info]) =>
    renderer.setOptions({
      style: render.mode,
      edges: render.edges,
      tintMods: render.tintMods,
      exposure: render.exposure,
      proj: render.proj,
      sun: scene.sun,
      lighting: scene.lighting,
      bg: scene.bg,
      gradTop: scene.gradTop,
      gradBot: scene.gradBot,
      aspect,
      spin,
      section: {
        on: section.on,
        axis: section.axis,
        cut: Math.round(sectionCut(section).pos * (info?.dims[section.axis] ?? 0)),
        mode: section.mode,
        flip: sectionCut(section).flip,
        thick: section.thick,
        capHi: section.capHi,
      },
    }),
  (a, b) => a.every((v, i) => v === b[i]),
)

store.watch(
  (s) => [s.modelVersion, s.composeVersion, s.mode, s.composeFrame] as const,
  ([mv, , mode, frame], prev) => {
    const framed = mode === 'compose' && frame !== prev[3]
    const composeEdit = mode === 'compose' && prev[2] === 'compose' && mv === prev[0] && prev[1] !== 0 && !framed
    renderer.setModel(mode === 'blueprint' ? getModel() : getComposeModel(), { refit: !composeEdit, grow: composeEdit })
    if (framed) renderer.fit()
  },
  (a, b) => a.every((v, i) => v === b[i]),
)

store.watch(
  (s) => s.assetsVersion,
  () => renderer.retryAssets(),
)

installDrop(
  (d) => actions.loadBlueprint({ file: d.file, name: d.name }),
  (e) => actions.toast(keyed('toast.dropFailed', { error: errText(e) })),
)

void restoreSources().then(() => {
  document.body.dataset.snapshot = '1'
})

const view = q.get('view')
if (view) {
  actions.setPreset(view)
  renderer.setView(view)
}
const style = q.get('style')
if (style === 'textured' || style === 'shaded' || style === 'clay' || style === 'line') actions.setRender({ mode: style })
const light = q.get('light')
if (light === 'directional' || light === 'uniform') actions.setScene({ lighting: light })
const proj = q.get('proj')
if (proj === 'persp' || proj === 'ortho') actions.setRender({ proj })
const missing = q.get('missing')
if (missing === 'placeholder' || missing === 'substitute' || missing === 'hide') actions.setRender({ missing })
const tab = q.get('tab')
if (tab === 'view' || tab === 'section' || tab === 'scene' || tab === 'export') actions.setTab(tab)
const bg = q.get('bg')
if (bg) actions.setScene({ bg })
if (q.get('mode') === 'compose') actions.setMode('compose')
if (q.get('seams') === '0') actions.setRender({ edges: false })
if (q.get('tint') === '1') actions.setRender({ tintMods: true })
if (q.get('sources') === '1') actions.openSources()

let tourSeen = false
try {
  tourSeen = localStorage.getItem('drydock.tourSeen') === '1'
} catch {}
if (q.get('tour') === '1' || !tourSeen) actions.openTour()
else loadCounter()
store.watch(
  (s) => s.tour,
  (n, prev) => {
    if (prev === 0 && n !== 0) loadCounter()
  },
)

const bpParam = q.get('bp')
let bpUrl: URL | null = null
try {
  if (bpParam) bpUrl = new URL(bpParam, location.href)
} catch {}
if (bpUrl && bpUrl.origin === location.origin) {
  fetch(bpUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.arrayBuffer()
    })
    .then((buffer) => {
      let name = bpUrl.pathname.split('/').slice(-2, -1)[0] || 'blueprint'
      try {
        name = decodeURIComponent(name)
      } catch {}
      return actions.loadBlueprint({ buffer, name })
    })
    .catch((err) => actions.toast(keyed('toast.urlFailed', { error: errText(err) })))
}

function bench(frames: number): { avgMs: number; frames: number } {
  const t0 = performance.now()
  for (let i = 0; i < frames; i++) {
    renderer.view.yaw += 0.03
    renderer.drawNow()
    renderer.finish()
  }
  return { avgMs: (performance.now() - t0) / frames, frames }
}

;(window as unknown as { __drydock: object }).__drydock = {
  store,
  actions,
  renderer,
  pbr: PBR,
  perf: () => perf.last,
  index: indexStats,
  compose: () => composePerf,
  exportMs: () => exportPerf.lastMs,
  bench,
  fps(frames: number): Promise<{ avgMs: number; fps: number }> {
    return new Promise((done) => {
      let n = 0
      let t0 = 0
      const step = (t: number) => {
        if (n === 0) t0 = t
        renderer.view.yaw += 0.03
        renderer.requestFrame()
        if (++n <= frames) requestAnimationFrame(step)
        else done({ avgMs: (t - t0) / frames, fps: (frames * 1000) / (t - t0) })
      }
      requestAnimationFrame(step)
    })
  },
  probe: (x: number, y: number) => renderer.probe(x, y),
  info: () => renderer.info(),
}
