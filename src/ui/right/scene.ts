import { actions, store } from '../../state/app.ts'
import { h, kicker, seg, text } from '../dom.ts'

const SKY = [
  { id: 'sky-default', label: 'Deep space', src: 'Procedural', css: 'radial-gradient(circle at 30% 40%, #2c455d 0, transparent 45%), #07090c' },
  { id: 'sky-orbit', label: 'Planet orbit', src: 'In orbit', css: 'radial-gradient(circle at 50% 230%, #94bce3 0, #416180 62%, #1d2d3d 66%, #07090c 68%)' },
  {
    id: 'sky-nebula',
    label: 'Nebula field',
    src: 'Mod · Nebula Skybox Pack',
    css: 'radial-gradient(circle at 70% 30%, #597ea3 0, transparent 40%), radial-gradient(circle at 20% 80%, #416180 0, transparent 45%), #0a0f16',
  },
]

const GRAD = [
  { id: 'paper', label: 'Drafting', css: 'repeating-linear-gradient(0deg,#d4d4d7 0 1px,transparent 1px 8px),repeating-linear-gradient(90deg,#d4d4d7 0 1px,transparent 1px 8px),#f2f2f3' },
  { id: 'hangar', label: 'Hangar', css: 'linear-gradient(#f5f5f8,#b7b7ba)' },
  { id: 'steel', label: 'Steel', css: 'radial-gradient(circle,#416180,#1d2d3d)' },
  { id: 'dusk', label: 'Haze', css: 'linear-gradient(#d6ebff,#597ea3)' },
  { id: 'transparent', label: 'Transparent', css: 'repeating-conic-gradient(#e7e7ea 0 25%,#f5f5f8 0 50%) 0 0/12px 12px' },
  { id: 'custom', label: 'Custom', css: 'linear-gradient(135deg,#f2f2f3 50%,#98989b 50%)' },
]

export function mountSceneTab(): HTMLElement {
  const buttons = new Map<string, HTMLElement>()
  const swatch = (o: { id: string; label: string; css: string; src?: string }, height: number) => {
    const b = h(
      'button',
      { class: 'sw' + (o.src ? ' blueprint' : ''), onClick: () => actions.setScene({ bg: o.id }) },
      h('span', { class: 'pv', style: `height:${height}px;background:${o.css}` }),
      h('span', { class: 'lb' }, o.label),
      o.src ? h('span', { class: 'sr' }, o.src) : null,
    )
    buttons.set(o.id, b)
    return b
  }
  const nebula = swatch(SKY[2], 58)
  const skyGrid = h('div', { class: 'sw-grid2' }, swatch(SKY[0], 58), swatch(SKY[1], 58), nebula)
  const realGrid = h('div', { class: 'sw-grid2' })
  const top = h('input', { type: 'color', onChange: () => actions.setScene({ gradTop: top.value }) })
  const bot = h('input', { type: 'color', onChange: () => actions.setScene({ gradBot: bot.value }) })
  const colors = h('div', { class: 'colors' }, h('label', { class: 'field' }, 'Top', top), h('label', { class: 'field' }, 'Bottom', bot))
  const sun = h('input', { type: 'range', min: 0, max: 360, onInput: () => actions.setScene({ sun: +sun.value }) })
  const sunLabel = text()
  const lighting = seg<'directional' | 'uniform'>({
    options: [['directional', 'Directional'], ['uniform', 'Uniform']],
    value: 'directional',
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setScene({ lighting: v }),
  })

  const sunBox = h(
    'div',
    { class: 'col g6', style: 'margin-top:4px' },
    h('div', { class: 'between', style: 'font-size:13px' }, h('span', null, 'Sun azimuth'), h('span', { class: 'acc7' }, sunLabel.el)),
    sun,
  )

  const el = h(
    'div',
    { class: 'col g18' },
    h('div', { class: 'col g8' }, kicker('Skyboxes · game & mods'), realGrid, skyGrid),
    h('div', { class: 'col g8' }, kicker('Gradients & studio'), h('div', { class: 'sw-grid3' }, ...GRAD.map((g) => swatch(g, 40))), colors),
    h(
      'div',
      { class: 'col g6' },
      kicker('Lighting'),
      lighting.el,
      sunBox,
    ),
  )

  store.watch(
    (s) => s.skies,
    (skies) => {
      for (const id of [...buttons.keys()]) if (id.startsWith('sky:')) buttons.delete(id)
      realGrid.replaceChildren(...skies.map((k) => swatch({ id: k.id, label: k.name, src: k.src, css: k.thumb ? `url(${k.thumb}) center/cover, #07090c` : '#07090c' }, 58)))
      realGrid.hidden = !skies.length
      const bg = store.get().scene.bg
      buttons.forEach((b, id) => b.classList.toggle('sel', id === bg))
    },
  )
  store.watch((s) => s.scene.bg, (bg) => buttons.forEach((b, id) => b.classList.toggle('sel', id === bg)))
  store.watch((s) => s.scene.bg === 'custom', (v) => (colors.hidden = !v))
  store.watch((s) => s.mods.sky === true, (v) => (nebula.hidden = !v))
  store.watch((s) => s.scene.gradTop, (v) => (top.value = v))
  store.watch((s) => s.scene.gradBot, (v) => (bot.value = v))
  store.watch((s) => s.scene.lighting, (v) => {
    lighting.set(v)
    sunBox.hidden = v === 'uniform'
  })
  store.watch((s) => s.scene.sun, (v) => {
    sun.value = String(v)
    sunLabel.set(`${v}°`)
  })
  return el
}
