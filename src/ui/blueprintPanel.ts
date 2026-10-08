import { actions, entryMeta, store, type ListEntry } from '../state/app.ts'
import { modSummary } from '../state/derive.ts'
import { msg, tr } from '../i18n.ts'
import { corners, h, icon, kicker, replaceChildren, seg, t, tAttr, text, tRich } from './dom.ts'

export function mountBlueprintPanel(root: HTMLElement) {
  const count = text()
  const search = tAttr(
    h('input', {
      class: 'input',
      onInput: () => actions.setSearch(search.value),
    }),
    'placeholder',
    'library.search',
  )
  const source = seg<'local' | 'workshop'>({
    options: [['local', t('library.local')], ['workshop', t('library.workshop')]],
    value: 'local',
    cls: 'grow',
    style: 'display:flex;width:100%',
    optCls: 'grow',
    onChange: actions.setListSource,
  })
  const list = h('div', { class: 'lib-list' })
  const drop = h(
    'div',
    { class: 'droptip' },
    icon('folder', 16),
    tRich('library.dropHint', { file: () => h('b', null, 'bp.sbc') }),
  )
  const modSum = text()
  const missingBtn = tAttr(h('button', { class: 'missing-btn s11', onClick: actions.openMissing }, t('library.missingBtn')), 'title', 'library.missingBtnTitle')
  const mods = h(
    'div',
    { class: 'lib-mods' },
    h('div', { class: 'between' }, kicker(t('library.modsTitle')), h('span', { class: 's11 muted' }, modSum.el, missingBtn)),
  )
  const modRows = h('div', { style: 'display:contents' })
  mods.append(modRows)

  const aside = h(
    'aside',
    { class: 'lib', 'data-tour': 'library' },
    h(
      'div',
      { class: 'lib-head' },
      h('div', { class: 'between' }, kicker(t('library.title')), h('span', { class: 's11 muted' }, count.el)),
      h('div', { class: 'lib-search' }, icon('search', 14), search),
      source.el,
    ),
    list,
    mods,
  )
  root.append(aside)

  const row = (e: ListEntry, on: boolean) =>
    h(
      'button',
      { class: 'blueprint bp-row' + (on ? ' sel' : ''), onClick: () => void actions.openEntry(e) },
      ...(on ? corners() : []),
      h('span', { class: 'glyph' }, e.large ? 'L' : 'S'),
      h('span', { class: 'txt' }, h('span', { class: 'nm' }, e.name), h('span', { class: 's11 muted' }, msg(entryMeta(e)))),
    )

  store.watch(
    (s) => [s.entries, s.pinned, s.search, s.bp, s.listSource, s.locale] as const,
    ([entries, pinned, q, sel, src]) => {
      const vis = entries.filter((e) => e.list === src && e.name.toLowerCase().includes(q.toLowerCase()))
      count.set(tr('library.found', { count: vis.length }))
      const pinnedRow = pinned ? h('button', { class: 'blueprint bp-row' + (sel === pinned.id ? ' sel' : '') }, ...(sel === pinned.id ? corners() : []), h('span', { class: 'glyph' }, pinned.large ? 'L' : 'S'), h('span', { class: 'txt' }, h('span', { class: 'nm' }, pinned.name), h('span', { class: 's11 muted' }, msg(entryMeta(pinned))))) : null
      replaceChildren(list, pinnedRow, ...vis.map((e) => row(e, e.id === sel)), drop)
    },
    (a, b) => a.every((v, i) => v === b[i]),
  )
  store.watch((s) => s.listSource, source.set)
  store.watch(modSummary, modSum.set)
  store.watch((s) => s.unknownBlocks.length > 0, (v) => (missingBtn.hidden = !v))

  store.watch(
    (s) => [s.modRows, s.locale] as const,
    ([rows]) =>
      replaceChildren(
        modRows,
        ...rows.map((r) => {
          const box = h('input', { type: 'checkbox', checked: r.enabled, disabled: r.missing, onChange: () => actions.toggleMod(r.key) })
          return h(
            'label',
            { class: 'mod-row' },
            box,
            h('span', { class: 'txt' }, h('span', { class: 'nm' }, msg(r.name)), h('span', { class: 's11 muted' }, msg(r.meta))),
            h('span', { class: 'tag ' + (r.missing ? 'tag-outline' : r.enabled ? 'tag-accent' : 'tag-neutral') }, tr(r.missing ? 'library.modState.notInstalled' : r.enabled ? 'library.modState.loaded' : 'library.modState.off')),
          )
        }),
      ),
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
  return aside
}
