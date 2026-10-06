import { actions, plural, store } from '../state/app.ts'
import { corners, h, icon, replaceChildren, text } from './dom.ts'

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
        h('span', { class: 'dlg-title' }, 'Missing blocks'),
        h('span', { class: 's12 muted' }, 'No linked source defines these block types. Link the game folder or the mods that contain them.'),
      ),
      h('button', { class: 'btn btn-ghost btn-icon', title: 'Close', style: 'flex:none', onClick: actions.closeMissing }, icon('x', 16)),
    ),
    h('span', { class: 's12 muted' }, summary.el),
    h(
      'div',
      { class: 'missing-list' },
      h('table', { class: 'missing-table' }, h('thead', null, h('tr', null, h('th', null, 'TypeId'), h('th', null, 'SubtypeId'), h('th', null, 'Blocks'))), body),
    ),
  )
  const backdrop = h('div', { class: 'dialog-backdrop dlg-backdrop', onClick: actions.closeMissing }, dialog)
  root.append(backdrop)

  store.watch((s) => s.missingOpen, (v) => (backdrop.hidden = !v))
  store.watch(
    (s) => s.unknownBlocks,
    (list) => {
      summary.set(`${plural(list.length, 'block type')} · ${plural(list.reduce((n, x) => n + x.blocks, 0), 'block')}`)
      replaceChildren(
        body,
        ...list.map((x) => {
          const at = x.key.indexOf('/')
          const sub = x.key.slice(at + 1)
          return h('tr', null, h('td', null, x.key.slice(0, at)), h('td', { class: sub ? '' : 'muted' }, sub || '(empty)'), h('td', null, x.blocks.toLocaleString('en-US')))
        }),
      )
    },
  )
}
