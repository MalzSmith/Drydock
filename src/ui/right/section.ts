import { actions, store } from '../../state/app.ts'
import { activeInfo } from '../../state/derive.ts'
import { corners, h, kicker, seg, text } from '../dom.ts'

export function mountSectionTab(): HTMLElement {
  const on = h('input', { type: 'checkbox', onChange: actions.toggleSection })
  const axis = seg<number>({
    options: [[0, 'X · Beam'], [1, 'Y · Deck'], [2, 'Z · Keel']],
    value: 0,
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setSection({ axis: v as 0 | 1 | 2, on: true }),
  })
  const mode = seg<'cut' | 'slice'>({
    options: [['cut', 'Cut away'], ['slice', 'Slice']],
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
    h('div', { class: 'between', style: 'font-size:13px' }, h('span', null, 'Slice thickness'), h('span', { class: 'acc7' }, thickLabel.el)),
    thick,
  )
  const cap = h('input', { type: 'checkbox', onChange: () => actions.setSection({ capHi: cap.checked }) })
  const btn = (label: string, onClick: () => void) => h('button', { class: 'btn btn-secondary', style: 'flex:1', onClick }, label)

  const el = h(
    'div',
    { class: 'col g18' },
    h('label', { class: 'sec-title' }, 'Cross-section', on),
    h('div', { class: 'col g8' }, kicker('Cut plane'), axis.el, mode.el),
    h(
      'div',
      { class: 'col g6' },
      h('div', { class: 'between', style: 'font-size:13px' }, h('span', null, 'Position'), h('span', { class: 'tnum acc7' }, layer.el)),
      pos,
      h(
        'div',
        { style: 'display:flex;gap:6px' },
        btn('− Layer', () => actions.stepSection(-1)),
        btn('+ Layer', () => actions.stepSection(1)),
        btn('Flip side', () => actions.setSection({ flip: !store.get().section.flip, on: true })),
      ),
    ),
    thickBox,
    h('label', { class: 'chk' }, 'Highlight cut faces', cap),
    h(
      'div',
      { class: 'blueprint tip' },
      ...corners(),
      h('span', { class: 't' }, 'Tip'),
      h('span', null, 'Use ', h('b', null, 'Slice'), ' on the Y plane with Top view for deck plans. Each step moves one block (2.5 m large grid, 0.5 m small grid).'),
    ),
  )

  store.watch((s) => s.section.on, (v) => (on.checked = v))
  store.watch((s) => s.section.axis, axis.set)
  store.watch((s) => s.section.mode, (m) => {
    mode.set(m)
    thickBox.hidden = m !== 'slice'
  })
  store.watch(
    (s) => [s.section.pos, s.section.axis, activeInfo(s)] as const,
    ([p, a, info]) => {
      const n = info?.dims[a] ?? 0
      layer.set(`Layer ${Math.round(p * n)} / ${n}`)
      pos.max = String(Math.max(1, n))
      pos.value = String(Math.round(p * n))
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  )
  store.watch((s) => s.section.thick, (t) => {
    thick.value = String(t)
    thickLabel.set(`${t} block${t > 1 ? 's' : ''}`)
  })
  store.watch((s) => s.section.capHi, (v) => (cap.checked = v))
  return el
}
