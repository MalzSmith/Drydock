import { currentLang, msg, tr } from '../i18n.ts'
import { linkSource, unlinkSource } from '../sources/sources.ts'
import { actions, store, type SourceKind } from '../state/app.ts'
import { kindLabel } from '../state/derive.ts'
import { corners, h, icon, kicker, progressBar, replaceChildren, t, tAttr, text } from './dom.ts'

const KINDS: SourceKind[] = ['game', 'workshop', 'torch', 'mods', 'blueprints']

export function mountSourcesDialog(root: HTMLElement) {
  const rows = h('div', { style: 'display:contents' })
  const bar = progressBar()
  const status = text()
  const statusRow = h('div', { class: 'col g8', hidden: true }, h('span', { class: 's12' }, status.el), bar.el)
  const empty = h('div', { class: 'empty' }, t('sources.empty'))
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
        h('span', { class: 'dlg-title' }, t('sources.title')),
        h('span', { class: 's12 muted' }, t('sources.desc')),
      ),
      tAttr(h('button', { class: 'btn btn-ghost btn-icon', style: 'flex:none', onClick: actions.closeSources }, icon('x', 16)), 'title', 'sources.close'),
    ),
    h('div', { class: 'col g8' }, rows, empty),
    h(
      'div',
      { class: 'col g8' },
      kicker(t('sources.link')),
      h(
        'div',
        { class: 'link-grid' },
        ...KINDS.map((k) =>
          h('button', { class: 'btn btn-secondary link-card', onClick: () => void linkSource(k) }, h('span', { class: 't' }, t('kinds.' + k)), h('span', { class: 'h' }, t('sources.hint.' + k))),
        ),
      ),
      statusRow,
      h('span', { class: 's11 muted' }, t('sources.uploadNote')),
    ),
  )
  const backdrop = h('div', { class: 'dialog-backdrop dlg-backdrop', onClick: actions.closeSources }, dialog)
  root.append(backdrop)

  store.watch((s) => s.srcOpen, (v) => (backdrop.hidden = !v))
  document.addEventListener('keydown', (e) => {
    const s = store.get()
    if (e.key === 'Escape' && s.srcOpen && !s.missingOpen) actions.closeSources()
  })
  store.watch(
    (s) => [s.sources, s.locale] as const,
    ([sources]) => {
      empty.hidden = sources.length > 0
      replaceChildren(
        rows,
        ...sources.map((r) => {
          return h(
            'div',
            { class: 'src-row' },
            h(
              'div',
              { class: 'txt' },
              h('span', { class: 'nm' }, r.name),
              h(
                'span',
                { class: 's11 muted' },
                tr('sources.rowMeta', {
                  meta: tr('sources.meta.' + r.kind),
                  time: new Date(r.when).toLocaleTimeString(currentLang(), { hour: 'numeric', minute: '2-digit' }),
                  date: new Date(r.when).toLocaleDateString(currentLang(), { dateStyle: 'medium' }),
                }) + (r.note ? ' · ' + msg(r.note) : ''),
              ),
            ),
            h('span', { class: 'tag tag-neutral' }, kindLabel(r.kind)),
            h('button', { class: 'btn btn-secondary', style: 'padding:4px 10px;font-size:12px', title: tr('sources.refreshTitle'), onClick: () => void linkSource(r.kind, r.id) }, tr('sources.refresh')),
            h('button', { class: 'btn btn-ghost btn-icon', title: tr('sources.remove'), onClick: () => void unlinkSource(r.id) }, icon('x', 15)),
          )
        }),
      )
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
  store.watch(
    (s) => [s.scanText, s.scanFrac, s.locale] as const,
    ([v, f]) => {
      statusRow.hidden = !v
      status.set(msg(v))
      bar.set(f)
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  )
}
