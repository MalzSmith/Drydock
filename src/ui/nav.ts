import { actions, store } from '../state/app.ts'
import { sourceStatus } from '../state/derive.ts'
import { corners, h, icon, seg, text } from './dom.ts'

export function mountNav(root: HTMLElement) {
  const mode = seg<'blueprint' | 'compose'>({
    options: [['blueprint', 'Blueprint'], ['compose', 'Compose']],
    value: 'blueprint',
    optStyle: 'padding:6px 14px;gap:6px',
    onChange: actions.setMode,
  })
  const dot = h('span', { class: 'dot7' })
  const status = text()
  const link = text()
  const sourcesBtn = h('button', { class: 'btn btn-secondary', style: 'gap:6px', onClick: actions.openSources }, icon('folder', 14), link.el)
  const exportBtn = h(
    'button',
    { class: 'btn btn-primary blueprint', style: 'gap:6px;border:1px solid var(--color-accent)', onClick: () => actions.setTab('export') },
    ...corners(),
    icon('download', 14),
    'Export image',
  )
  root.append(
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'blueprint mark' }, ...corners(), icon('box', 16)),
      h('div', { class: 'words' }, h('span', { class: 'name' }, 'DRYDOCK'), h('span', { class: 'sub' }, 'Blueprint renderer')),
    ),
    mode.el,
    h('div', { class: 'navstat' }, dot, status.el),
    sourcesBtn,
    exportBtn,
  )
  store.watch((s) => s.mode, (m) => mode.set(m))
  store.watch(
    (s) => sourceStatus(s),
    (v) => {
      dot.style.background = v.dot ? 'var(--color-accent)' : 'var(--color-neutral-400)'
      status.set(v.text)
    },
    (a, b) => a.dot === b.dot && a.text === b.text,
  )
  store.watch((s) => s.sources.length, (n) => link.set(n ? 'Sources' : 'Link folders'))
}
