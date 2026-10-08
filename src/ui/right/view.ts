import { actions, store, type RenderStyle } from '../../state/app.ts'
import { activeInfo, blocksText } from '../../state/derive.ts'
import { fmt, fmt1, msg, tr } from '../../i18n.ts'
import { check, h, kicker, replaceChildren, seg, t, text } from '../dom.ts'

export function mountViewTab(): HTMLElement {
  const style = seg<RenderStyle>({
    options: (['textured', 'shaded', 'clay', 'line'] as const).map((id) => [id, t('view.styles.' + id)]),
    value: 'textured',
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setRender({ mode: v }),
  })
  const seams = check(t('view.seams'), (v) => actions.setRender({ edges: v }))
  const tint = check(t('view.tintMods'), (v) => actions.setRender({ tintMods: v }))
  const missing = seg<'placeholder' | 'substitute' | 'hide'>({
    options: (['placeholder', 'substitute', 'hide'] as const).map((id) => [id, t('view.missing.' + id)]),
    value: 'placeholder',
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setRender({ missing: v }),
  })
  const exposure = h('input', {
    type: 'range',
    min: -2,
    max: 2,
    step: 0.1,
    onInput: () => actions.setRender({ exposure: +exposure.value }),
    onDblclick: () => actions.setRender({ exposure: 0 }),
  })
  const expLabel = text()
  const expBox = h(
    'div',
    { class: 'col g6' },
    h('div', { class: 'between', style: 'font-size:13px' }, h('span', null, t('view.exposure')), h('span', { class: 'acc7' }, expLabel.el)),
    exposure,
  )
  const total = text()
  const body = h('tbody')
  const table = h(
    'table',
    { class: 'table defs', style: 'font-size:12px' },
    h('thead', null, h('tr', null, h('th', null, t('view.col.block')), h('th', null, t('view.col.source')), h('th', { style: 'text-align:right' }, t('view.col.qty')))),
    body,
  )

  const el = h(
    'div',
    { class: 'col g18' },
    h('div', { class: 'col g8' }, kicker(t('view.renderStyle')), style.el),
    expBox,
    h('div', { class: 'col g10' }, seams.el, tint.el),
    h(
      'div',
      { class: 'col g8' },
      kicker(t('view.missingTitle')),
      missing.el,
      h('span', { class: 's12 muted' }, t('view.missingDesc')),
    ),
    h('div', { class: 'col g6' }, h('div', { class: 'between' }, kicker(t('view.defsTitle')), h('span', { class: 's11 muted' }, total.el)), table),
  )

  store.watch((s) => s.render.mode, style.set)
  store.watch((s) => s.render.mode === 'textured', (v) => (expBox.hidden = !v))
  store.watch((s) => [s.render.exposure, s.locale] as const, ([v]) => {
    exposure.value = String(v)
    expLabel.set(`${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt1(Math.abs(v))} EV`)
  }, (a, b) => a[0] === b[0] && a[1] === b[1])
  store.watch((s) => s.render.edges, seams.set)
  store.watch((s) => s.render.tintMods, tint.set)
  store.watch((s) => s.render.missing, missing.set)
  store.watch(blocksText, total.set)
  store.watch(
    (s) => [activeInfo(s), s.locale] as const,
    ([info]) =>
      replaceChildren(
        body,
        ...(info?.rows ?? []).map((r) =>
          h(
            'tr',
            null,
            h('td', { class: r.missing ? 'sub' : '', title: r.missing ? r.name : undefined, style: `color:${r.missing ? 'var(--color-accent-700)' : r.modded ? 'var(--color-accent-800)' : 'var(--color-text)'}` }, r.name),
            h('td', null, r.missing ? tr('view.missingSource', { source: msg(r.source) }) : msg(r.source)),
            h('td', null, fmt(r.qty)),
          ),
        ),
      ),
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
  return el
}
