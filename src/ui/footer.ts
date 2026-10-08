import { store } from '../state/app.ts'
import { blocksText, contentPath, dimsText, modSummary } from '../state/derive.ts'
import { msg, tr } from '../i18n.ts'
import { h, progressBar, t, text } from './dom.ts'

export function mountFooter(root: HTMLElement) {
  const status = text()
  const bar = progressBar()
  const blocks = text()
  const dims = text()
  const mods = text()
  const path = text()
  const path2 = h('span', { style: 'margin-left:auto' }, path.el)
  root.append(
    h('span', { style: 'display:flex;align-items:center;gap:6px;color:var(--color-text)' }, h('span', { class: 'dot7' }), status.el, bar.el),
    blocks.el,
    dims.el,
    mods.el,
    path2,
    h('span', null, t('footer.privacy')),
    h('a', { href: 'https://github.com/MalzSmith/Drydock', target: '_blank', rel: 'noopener' }, 'GitHub'),
  )
  store.watch((s) => (s.busy ? tr('status.rendering') : s.loading ? tr('status.loading') : msg(s.scanText || s.assetText) || tr('footer.ready')), status.set)
  store.watch(
    (s) => (s.scanText ? (s.scanFrac ?? -1) : s.assetText ? (s.assetFrac ?? -1) : -2),
    (v) => {
      bar.el.hidden = v === -2
      if (v !== -2) bar.set(v === -1 ? null : v)
    },
  )
  store.watch(blocksText, blocks.set)
  store.watch(dimsText, dims.set)
  store.watch(modSummary, mods.set)
  store.watch(contentPath, path.set)
}
