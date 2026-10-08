import { actions, store } from '../state/app.ts'
import { fmt, tr } from '../i18n.ts'
import { corners, h, icon, replaceChildren, t, tAttr, text } from './dom.ts'

export function mountMissingDialog(root: HTMLElement) {
  const summary = text()
  const body = h('tbody')
  const dialog = h(
    'div',
    { class: 'dlg blueprint', onClick: (e: Event) => e.stopPropagation() },
    ...corners(),
    h(
      'div',
      { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:12px' },
      h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:3px' },
        h('span', { class: 'dlg-title' }, t('missing.title')),
        h('span', { class: 's12 muted' }, t('missing.desc')),
      ),
      tAttr(h('button', { class: 'btn btn-ghost btn-icon', style: 'flex:none', onClick: actions.closeMissing }, icon('x', 16)), 'title', 'sources.close'),
    ),
    h('span', { class: 's12 muted' }, summary.el),
    h(
      'div',
      { class: 'missing-list' },
      h('table', { class: 'missing-table' }, h('thead', null, h('tr', null, h('th', null, 'TypeId'), h('th', null, 'SubtypeId'), h('th', null, t('missing.blocks')))), body),
    ),
  )
  const backdrop = h('div', { class: 'dialog-backdrop dlg-backdrop', onClick: actions.closeMissing }, dialog)
  root.append(backdrop)

  store.watch((s) => s.missingOpen, (v) => (backdrop.hidden = !v))
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.get().missingOpen) actions.closeMissing()
  })
  store.watch(
    (s) => [s.unknownBlocks, s.locale] as const,
    ([list]) => {
      summary.set(`${tr('units.blockTypes', { count: list.length })} · ${tr('units.blocks', { count: list.reduce((n, x) => n + x.blocks, 0) })}`)
      replaceChildren(
        body,
        ...list.map((x) => {
          const at = x.key.indexOf('/')
          const sub = x.key.slice(at + 1)
          return h('tr', null, h('td', null, x.key.slice(0, at)), h('td', { class: sub ? '' : 'muted' }, sub || tr('missing.empty')), h('td', null, fmt(x.blocks)))
        }),
      )
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
}
