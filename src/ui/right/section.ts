import { actions, store } from '../../state/app.ts'
import { activeInfo } from '../../state/derive.ts'
import { tr } from '../../i18n.ts'
import { corners, h, kicker, seg, t, text, tRich } from '../dom.ts'

export function mountSectionTab(): HTMLElement {
  const on = h('input', { type: 'checkbox', onChange: actions.toggleSection })
  const axis = seg<number>({
    options: [[0, t('section.axisX')], [1, t('section.axisY')], [2, t('section.axisZ')]],
    value: 0,
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setSection({ axis: v as 0 | 1 | 2, on: true }),
  })
  const mode = seg<'cut' | 'slice'>({
    options: [['cut', t('section.cut')], ['slice', t('section.slice')]],
    value: 'cut',
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setSection({ mode: v, on: true }),
  })
  const layer = text()
  const pos = h('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: 1,
    onInput: () => actions.setSection({ pos: +pos.max > 0 ? +pos.value / +pos.max : 0.5, on: true }),
  })
  const thickLabel = text()
  const thick = h('input', { type: 'range', min: 1, max: 8, onInput: () => actions.setSection({ thick: +thick.value }) })
  const thickBox = h(
    'div',
    { class: 'col g6' },
    h('div', { class: 'between', style: 'font-size:13px' }, h('span', null, t('section.thickness')), h('span', { class: 'acc7' }, thickLabel.el)),
    thick,
  )
  const cap = h('input', { type: 'checkbox', onChange: () => actions.setSection({ capHi: cap.checked }) })
  const btn = (label: Node, onClick: () => void) => h('button', { class: 'btn btn-secondary', style: 'flex:1', onClick }, label)

  const el = h(
    'div',
    { class: 'col g18' },
    h('label', { class: 'sec-title' }, t('section.title'), on),
    h('div', { class: 'col g8' }, kicker(t('section.cutPlane')), axis.el, mode.el),
    h(
      'div',
      { class: 'col g6' },
      h('div', { class: 'between', style: 'font-size:13px' }, h('span', null, t('section.position')), h('span', { class: 'tnum acc7' }, layer.el)),
      pos,
      h(
        'div',
        { style: 'display:flex;gap:6px' },
        btn(t('section.prev'), () => actions.stepSection(-1)),
        btn(t('section.next'), () => actions.stepSection(1)),
        btn(t('section.flip'), () => actions.setSection({ flip: !store.get().section.flip, on: true })),
      ),
    ),
    thickBox,
    h('label', { class: 'chk' }, t('section.highlight'), cap),
    h(
      'div',
      { class: 'blueprint tip' },
      ...corners(),
      h('span', { class: 't' }, t('section.tip')),
      tRich('section.tipText', { slice: () => h('b', null, tr('section.slice')) }),
    ),
  )

  store.watch((s) => s.section.on, (v) => (on.checked = v))
  store.watch((s) => s.section.axis, axis.set)
  store.watch((s) => s.section.mode, (m) => {
    mode.set(m)
    thickBox.hidden = m !== 'slice'
  })
  store.watch(
    (s) => [s.section.pos, s.section.axis, activeInfo(s), s.locale] as const,
    ([p, a, info]) => {
      const n = info?.dims[a] ?? 0
      layer.set(tr('section.layer', { n: Math.round(p * n), total: n }))
      pos.max = String(Math.max(1, n))
      pos.value = String(Math.round(p * n))
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3],
  )
  store.watch(
    (s) => [s.section.thick, s.locale] as const,
    ([v]) => {
      thick.value = String(v)
      thickLabel.set(tr('units.blocks', { count: v }))
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
  store.watch((s) => s.section.capHi, (v) => (cap.checked = v))
  return el
}
