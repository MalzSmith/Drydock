import { actions, entryMeta, store, type ListEntry, type ModRow } from '../state/app.ts'
import { modSummary } from '../state/derive.ts'
import { corners, h, icon, kicker, replaceChildren, seg, text } from './dom.ts'

export function mountBlueprintPanel(root: HTMLElement) {
  const count = text()
  const search = h('input', {
    class: 'input',
    placeholder: 'Search blueprints',
    onInput: () => actions.setSearch(search.value),
  })
  const source = seg<'local' | 'workshop'>({
    options: [['local', 'Local'], ['workshop', 'Workshop']],
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
    h('span', null, 'Drop a ', h('b', null, 'bp.sbc'), ' or a blueprint folder anywhere to open it.'),
  )
  const modSum = text()
  const missingBtn = h('button', { class: 'missing-btn s11', title: 'Show the block types that no linked source defines', onClick: actions.openMissing }, 'Missing blocks, click to view')
  const mods = h(
    'div',
    { class: 'lib-mods' },
    h('div', { class: 'between' }, kicker('Mods in this blueprint'), h('span', { class: 's11 muted' }, modSum.el, missingBtn)),
  )
  const modRows = h('div', { style: 'display:contents' })
  mods.append(modRows)

  const aside = h(
    'aside',
    { class: 'lib' },
    h(
      'div',
      { class: 'lib-head' },
      h('div', { class: 'between' }, kicker('Blueprints'), h('span', { class: 's11 muted' }, count.el)),
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
      h('span', { class: 'txt' }, h('span', { class: 'nm' }, e.name), h('span', { class: 's11 muted' }, entryMeta(e))),
    )

  store.watch(
    (s) => [s.entries, s.pinned, s.search, s.bp, s.listSource] as const,
    ([entries, pinned, q, sel, src]) => {
      const vis = entries.filter((e) => e.list === src && e.name.toLowerCase().includes(q.toLowerCase()))
      count.set(`${vis.length} found`)
      const pinnedRow = pinned ? h('button', { class: 'blueprint bp-row' + (sel === pinned.id ? ' sel' : '') }, ...(sel === pinned.id ? corners() : []), h('span', { class: 'glyph' }, pinned.large ? 'L' : 'S'), h('span', { class: 'txt' }, h('span', { class: 'nm' }, pinned.name), h('span', { class: 's11 muted' }, entryMeta(pinned)))) : null
      replaceChildren(list, pinnedRow, ...vis.map((e) => row(e, e.id === sel)), drop)
    },
    (a, b) => a.every((v, i) => v === b[i]),
  )
  store.watch((s) => s.listSource, source.set)
  store.watch(modSummary, modSum.set)
  store.watch((s) => s.unknownBlocks.length > 0, (v) => (missingBtn.hidden = !v))

  store.watch(
    (s) => s.modRows,
    (rows: ModRow[]) =>
      replaceChildren(
        modRows,
        ...rows.map((r) => {
          const box = h('input', { type: 'checkbox', checked: r.enabled, disabled: r.missing, onChange: () => actions.toggleMod(r.key) })
          return h(
            'label',
            { class: 'mod-row' },
            box,
            h('span', { class: 'txt' }, h('span', { class: 'nm' }, r.name), h('span', { class: 's11 muted' }, r.meta)),
            h('span', { class: 'tag ' + (r.missing ? 'tag-outline' : r.enabled ? 'tag-accent' : 'tag-neutral') }, r.missing ? 'Not installed' : r.enabled ? 'Loaded' : 'Off'),
          )
        }),
      ),
  )
  return aside
}
