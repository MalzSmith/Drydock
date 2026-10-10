import { actions, store } from '../../state/app.ts'
import { aspectOf } from '../../render/camera.ts'
import { copyImage, exportImage, exportSpinWebp, exportTurntable } from '../../render/exportImage.ts'
import type { Renderer } from '../../render/renderer.ts'
import { fmt as fmtN, tr } from '../../i18n.ts'
import { check, corners, h, kicker, seg, t, text } from '../dom.ts'

export function mountExportTab(renderer: Renderer): HTMLElement {
  const dims = text()
  const res = seg<number>({
    options: [[1080, '1080p'], [1440, '1440p'], [2160, '4K'], [4320, '8K']],
    value: 2160,
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setExport({ res: v }),
  })
  const aspect = seg<string>({
    options: [['16:9', '16:9'], ['21:9', '21:9'], ['1:1', '1:1'], ['4:5', '4:5']],
    value: '16:9',
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setExport({ aspect: v }),
  })
  const fmt = seg<'PNG' | 'JPG' | 'WEBP'>({
    options: [['PNG', 'PNG'], ['JPG', 'JPG'], ['WEBP', 'WebP']],
    value: 'PNG',
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setExport({ fmt: v }),
  })
  const transparent = check(t('export.transparent'), (v) => actions.setExport({ transparent: v }))
  const ss = seg<number>({
    options: [[1, '1×'], [2, '2×'], [4, '4×']],
    value: 2,
    onChange: (v) => actions.setExport({ ss: v }),
  })
  const fileName = h('input', { class: 'input', style: 'font-size:13px', onChange: () => actions.setExport({ fileName: fileName.value }) })
  const render = h('button', { class: 'btn btn-primary blueprint btn-hero', onClick: () => void exportImage(renderer, renderer.canvas) }, ...corners(), '')
  const renderLabel = text()
  render.append(renderLabel.el)

  const el = h(
    'div',
    { class: 'col g18' },
    h(
      'div',
      { class: 'col g8' },
      h('div', { class: 'between' }, kicker(t('export.resolution')), h('span', { class: 'res-dims' }, dims.el)),
      res.el,
      aspect.el,
      h('span', { class: 's12 muted' }, t('export.framed')),
    ),
    h(
      'div',
      { class: 'col g8' },
      kicker(t('export.format')),
      fmt.el,
      transparent.el,
      h('div', { class: 'ss-row' }, h('span', null, t('export.ss')), ss.el),
    ),
    h(
      'div',
      { class: 'col g10' },
      h('div', { class: 'field' }, h('label', null, t('export.fileName')), fileName),
    ),
    h(
      'div',
      { class: 'col g8' },
      render,
      h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, h('button', { class: 'btn btn-secondary', onClick: () => void copyImage(renderer, renderer.canvas) }, t('export.copy')), h('button', { class: 'btn btn-secondary', onClick: () => void exportTurntable(renderer, renderer.canvas) }, t('export.turntable'))),
      h('button', { class: 'btn btn-secondary', onClick: () => void exportSpinWebp(renderer, renderer.canvas) }, t('export.spinWebp')),
    ),
  )

  store.watch((s) => s.export.res, res.set)
  store.watch((s) => s.export.aspect, aspect.set)
  store.watch((s) => s.export.fmt, fmt.set)
  store.watch((s) => s.export.transparent, transparent.set)
  store.watch((s) => s.export.ss, ss.set)
  store.watch((s) => s.export.fileName, (v) => (fileName.value = v))
  store.watch(
    (s) => `${fmtN(Math.round(s.export.res * aspectOf(s.export.aspect)))} × ${fmtN(s.export.res)} px`,
    dims.set,
  )
  store.watch((s) => (s.busy ? tr('export.rendering') : tr('export.render', { fmt: s.export.fmt === 'WEBP' ? 'WebP' : s.export.fmt })), renderLabel.set)
  return el
}
