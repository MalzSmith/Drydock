import { actions, store, type RenderStyle } from '../../state/app.ts'
import { activeInfo, blocksText } from '../../state/derive.ts'
import { check, h, kicker, replaceChildren, seg, text } from '../dom.ts'

export function mountViewTab(): HTMLElement {
  const style = seg<RenderStyle>({
    options: [['textured', 'Textured'], ['shaded', 'Shaded'], ['clay', 'Clay'], ['line', 'Line']],
    value: 'textured',
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setRender({ mode: v }),
  })
  const seams = check('Block seams', (v) => actions.setRender({ edges: v }))
  const tint = check('Tint modded blocks', (v) => actions.setRender({ tintMods: v }))
  const missing = seg<'placeholder' | 'substitute' | 'hide'>({
    options: [['placeholder', 'Placeholder'], ['substitute', 'Substitute'], ['hide', 'Hide']],
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
    h('div', { class: 'between', style: 'font-size:13px' }, h('span', null, 'Exposure'), h('span', { class: 'acc7' }, expLabel.el)),
    exposure,
  )
  const total = text()
  const body = h('tbody')
  const table = h(
    'table',
    { class: 'table defs', style: 'font-size:12px' },
    h('thead', null, h('tr', null, h('th', null, 'Block'), h('th', null, 'Source'), h('th', { style: 'text-align:right' }, 'Qty'))),
    body,
  )

  const el = h(
    'div',
    { class: 'col g18' },
    h('div', { class: 'col g8' }, kicker('Render style'), style.el),
    expBox,
    h('div', { class: 'col g10' }, seams.el, tint.el),
    h(
      'div',
      { class: 'col g8' },
      kicker('Missing mod blocks'),
      missing.el,
      h('span', { class: 's12 muted' }, "Blocks whose definition isn't in the game or any enabled mod."),
    ),
    h('div', { class: 'col g6' }, h('div', { class: 'between' }, kicker('Block definitions'), h('span', { class: 's11 muted' }, total.el)), table),
  )

  store.watch((s) => s.render.mode, style.set)
  store.watch((s) => s.render.mode === 'textured', (v) => (expBox.hidden = !v))
  store.watch((s) => s.render.exposure, (v) => {
    exposure.value = String(v)
    expLabel.set(`${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} EV`)
  })
  store.watch((s) => s.render.edges, seams.set)
  store.watch((s) => s.render.tintMods, tint.set)
  store.watch((s) => s.render.missing, missing.set)
  store.watch(blocksText, total.set)
  store.watch(
    (s) => activeInfo(s),
    (info) =>
      replaceChildren(
        body,
        ...(info?.rows ?? []).map((r) =>
          h(
            'tr',
            null,
            h('td', { class: r.missing ? 'sub' : '', title: r.missing ? r.name : undefined, style: `color:${r.missing ? 'var(--color-accent-700)' : r.modded ? 'var(--color-accent-800)' : 'var(--color-text)'}` }, r.name),
            h('td', null, r.missing ? r.source + ' · missing' : r.source),
            h('td', null, r.qty.toLocaleString('en-US')),
          ),
        ),
      ),
  )
  return el
}
