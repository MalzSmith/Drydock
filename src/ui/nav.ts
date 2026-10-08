import { tr } from '../i18n.ts'
import { actions, store } from '../state/app.ts'
import { sourceStatus } from '../state/derive.ts'
import { corners, h, icon, seg, t, tAttr, text } from './dom.ts'
import { mountLangMenu } from './langMenu.ts'

export function mountNav(root: HTMLElement) {
  const mode = seg<'blueprint' | 'compose'>({
    options: [['blueprint', t('nav.mode.blueprint')], ['compose', t('nav.mode.compose')]],
    value: 'blueprint',
    optStyle: 'padding:6px 14px;gap:6px',
    onChange: actions.setMode,
  })
  const dot = h('span', { class: 'dot7' })
  const status = text()
  const link = text()
  const sourcesBtn = h('button', { class: 'btn btn-secondary', style: 'gap:6px', 'data-tour': 'sources', onClick: actions.openSources }, icon('folder', 14), link.el)
  const exportBtn = h(
    'button',
    { class: 'btn btn-primary blueprint', style: 'gap:6px;border:1px solid var(--color-accent)', 'data-tour': 'export', onClick: () => actions.setTab('export') },
    ...corners(),
    icon('download', 14),
    t('nav.exportImage'),
  )
  root.append(
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'blueprint mark' }, ...corners(), icon('box', 16)),
      h('div', { class: 'words' }, h('span', { class: 'name' }, 'DRYDOCK'), h('span', { class: 'sub' }, t('nav.subtitle'))),
    ),
    mode.el,
    h('div', { class: 'navstat' }, dot, status.el),
    tAttr(h('button', { class: 'btn btn-ghost', style: 'gap:6px', onClick: actions.openTour }, icon('circle-help', 14), t('nav.tour')), 'title', 'nav.tourTitle'),
    mountLangMenu(),
    sourcesBtn,
    exportBtn,
  )
  mode.el.dataset.tour = 'mode'
  store.watch((s) => s.mode, (m) => mode.set(m))
  store.watch(
    (s) => sourceStatus(s),
    (v) => {
      dot.style.background = v.dot ? 'var(--color-accent)' : 'var(--color-neutral-400)'
      status.set(v.text)
    },
    (a, b) => a.dot === b.dot && a.text === b.text,
  )
  store.watch((s) => [s.sources.length > 0, s.locale] as const, ([n]) => link.set(tr(n ? 'nav.sources' : 'nav.linkFolders')), (a, b) => a[0] === b[0] && a[1] === b[1])
}
