import { linkSource, unlinkSource } from '../sources/sources.ts'
import { actions, store, type SourceKind } from '../state/app.ts'
import { kindLabel } from '../state/derive.ts'
import { corners, h, icon, kicker, progressBar, replaceChildren, text } from './dom.ts'

const KINDS: Array<{ k: SourceKind; meta: string; hint: string }> = [
  { k: 'game', meta: 'SpaceEngineers\\Content · vanilla blocks, models, textures', hint: 'Steam install folder' },
  { k: 'workshop', meta: 'steamapps\\workshop\\content\\244850 · subscribed mods', hint: 'Steam workshop 244850 folder' },
  { k: 'torch', meta: 'Torch / dedicated server instance · its Mods & Content', hint: 'Server instance folder' },
  { k: 'mods', meta: 'Loose mod folder · scanned for .sbc definitions', hint: 'Any folder of mods' },
  { k: 'blueprints', meta: '%AppData%\\SpaceEngineers\\Blueprints · local blueprints', hint: 'Blueprints folder (local)' },
]

export function mountSourcesDialog(root: HTMLElement) {
  const rows = h('div', { style: 'display:contents' })
  const bar = progressBar()
  const status = text()
  const statusRow = h('div', { class: 'col g8', hidden: true }, h('span', { class: 's12' }, status.el), bar.el)
  const empty = h('div', { class: 'empty' }, 'Nothing linked yet. Without a game folder only the built-in vanilla block set is available.')
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
        h('span', { class: 'dlg-title' }, 'Content sources'),
        h('span', { class: 's12 muted' }, 'Block definitions, models and textures are read from these folders, top to bottom. Later sources override earlier ones.'),
      ),
      h('button', { class: 'btn btn-ghost btn-icon', title: 'Close', style: 'flex:none', onClick: actions.closeSources }, icon('x', 16)),
    ),
    h('div', { class: 'col g8' }, rows, empty),
    h(
      'div',
      { class: 'col g8' },
      kicker('Link a folder'),
      h(
        'div',
        { class: 'link-grid' },
        ...KINDS.map((o) =>
          h('button', { class: 'btn btn-secondary link-card', onClick: () => void linkSource(o.k) }, h('span', { class: 't' }, kindLabel(o.k)), h('span', { class: 'h' }, o.hint)),
        ),
      ),
      statusRow,
      h('span', { class: 's11 muted' }, 'Your browser asks to confirm an upload, but nothing leaves this device. Each folder is stored as a snapshot here and loads without picking again; refresh a source to update it.'),
    ),
  )
  const backdrop = h('div', { class: 'dialog-backdrop dlg-backdrop', onClick: actions.closeSources }, dialog)
  root.append(backdrop)

  store.watch((s) => s.srcOpen, (v) => (backdrop.hidden = !v))
  store.watch(
    (s) => s.sources,
    (sources) => {
      empty.hidden = sources.length > 0
      replaceChildren(
        rows,
        ...sources.map((r) => {
          const meta = KINDS.find((o) => o.k === r.kind)!.meta
          return h(
            'div',
            { class: 'src-row' },
            h(
              'div',
              { class: 'txt' },
              h('span', { class: 'nm' }, r.name),
              h('span', { class: 's11 muted' }, `${meta} · linked ${new Date(r.when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Snapshot from ${new Date(r.when).toLocaleDateString([], { dateStyle: 'medium' })}${r.note ? ' · ' + r.note : ''}`),
            ),
            h('span', { class: 'tag tag-neutral' }, kindLabel(r.kind)),
            h('button', { class: 'btn btn-secondary', style: 'padding:4px 10px;font-size:12px', title: 'Pick the folder again to update this snapshot', onClick: () => void linkSource(r.kind, r.id) }, 'Refresh'),
            h('button', { class: 'btn btn-ghost btn-icon', title: 'Remove', onClick: () => void unlinkSource(r.id) }, icon('x', 15)),
          )
        }),
      )
    },
  )
  store.watch(
    (s) => [s.scanText, s.scanFrac] as const,
    ([t, f]) => {
      statusRow.hidden = !t
      status.set(t)
      bar.set(f)
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
}
