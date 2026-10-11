import { store } from '../state/app.ts'
import { aspectOf } from '../render/camera.ts'
import { cancelExport } from '../render/exportImage.ts'
import { fmt, tr } from '../i18n.ts'
import { corners, h, progressBar, t, text } from './dom.ts'

export function mountExportDialog(root: HTMLElement) {
  const title = text()
  const pct = text()
  const bar = progressBar()
  const cancel = h('button', { class: 'btn btn-secondary', style: 'align-self:flex-end', onClick: () => cancelExport() }, t('export.cancel'))
  const dialog = h(
    'div',
    { class: 'dlg blueprint' },
    ...corners(),
    h('span', { class: 'dlg-title' }, title.el),
    h('span', { class: 's12 muted' }, t('export.progressNote')),
    h('div', { style: 'display:flex;align-items:center;gap:10px' }, bar.el, h('span', { class: 's12', style: 'min-width:4em;text-align:right' }, pct.el)),
    cancel,
  )
  bar.el.style.flex = '1'
  const backdrop = h('div', { class: 'dialog-backdrop dlg-backdrop' }, dialog)
  root.append(backdrop)

  let timer = 0
  store.watch(
    (s) => s.progress !== null,
    (open) => {
      clearTimeout(timer)
      cancel.disabled = false
      backdrop.hidden = !open
      backdrop.style.opacity = '0'
      if (open) timer = window.setTimeout(() => (backdrop.style.opacity = ''), 400)
    },
  )
  store.watch(
    (s) => [s.export.res, s.export.aspect, s.locale] as const,
    ([res, aspect]) => title.set(tr('export.progressTitle', { dims: `${fmt(Math.round(res * aspectOf(aspect)))} × ${fmt(res)}` })),
  )
  store.watch(
    (s) => [s.progress ?? 0, s.locale] as const,
    ([p]) => {
      bar.set(p)
      pct.set(tr('export.percent', { pct: Math.floor(p * 100) }))
    },
  )
  cancel.addEventListener('click', () => (cancel.disabled = true))
}
