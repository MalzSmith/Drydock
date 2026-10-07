import { actions, store } from '../state/app.ts'
import { check, corners, h, icon, kicker } from './dom.ts'
import { countEnabled, setCountEnabled } from '../util/count.ts'

type Place = 'bottom' | 'right' | 'left'

const STEPS: Array<{ target: string; place: Place; title: string; body: string }> = [
  {
    target: 'sources',
    place: 'bottom',
    title: 'Link your game folder',
    body: 'Drydock reads models and textures from your own Space Engineers install. Until it is linked, every block draws as a plain box.',
  },
  {
    target: 'library',
    place: 'right',
    title: 'Open a blueprint',
    body: 'Pick one from your linked Blueprints folder, or drop a bp.sbc or a whole blueprint folder anywhere on the page.',
  },
  {
    target: 'vptools',
    place: 'bottom',
    title: 'Frame the shot',
    body: 'Switch perspective and orthographic, cut a cross-section, spin a turntable, or refit the ship to the frame.',
  },
  {
    target: 'tabs',
    place: 'left',
    title: 'Fine-tune the render',
    body: 'View sets the render style. Section slices the hull layer by layer. Scene picks backdrops and lighting.',
  },
  {
    target: 'export',
    place: 'bottom',
    title: 'Export an image',
    body: 'PNG, JPG or WebP up to 8K with supersampling, copy to clipboard, or a 36-frame turntable ZIP.',
  },
  {
    target: 'mode',
    place: 'bottom',
    title: 'Build your own hull',
    body: 'Compose stacks boxes, spheres and cylinders into a hull and exports it as a bp.sbc you can paste in the game.',
  },
]

const PAD = 6
const GAP = 28
const W = 300

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function mountTour(app: HTMLElement) {
  const count = check('Count my visit anonymously', setCountEnabled, 'chk tour-count')
  const start = h('button', { class: 'btn btn-primary tour-big', style: 'justify-content:space-between', onClick: () => actions.setTour(1) }, 'Show me around', h('span', null, '→'))
  const welcome = h(
    'div',
    { class: 'tour-welcome' },
    h(
      'div',
      { class: 'dlg blueprint tour-card' },
      ...corners(),
      kicker('First time here'),
      h('span', { class: 'tour-hello' }, 'Welcome to Drydock'),
      h(
        'span',
        { class: 'tour-lead' },
        'Render Space Engineers blueprints and build simple hulls, all in your browser. Six quick stops show where everything lives.',
      ),
      h(
        'div',
        { class: 'tour-choice' },
        start,
        h('button', { class: 'btn btn-secondary tour-big', onClick: () => actions.closeTour('skip') }, "I'll explore on my own"),
      ),
      h('span', { class: 's11 muted' }, 'Files are read locally and never uploaded. Replay this tour any time from ', h('b', { class: 'acc7' }, 'Tour'), ' in the header.'),
      h(
        'div',
        null,
        count.el,
        h('span', { class: 's11 muted' }, 'Drydock counts visits with GoatCounter: no cookies, nothing from your files. This helps me gauge interest in the project.'),
      ),
    ),
  )

  const blocker = h('div', { class: 'tour-block' })
  const frame = h('div', { class: 'tour-frame' })
  const line = h('div', { class: 'tour-line' })
  const dot = h('div', { class: 'dot7 tour-dot' })
  const stepKicker = kicker('')
  const title = h('span', { class: 'tour-title' })
  const body = h('span', { class: 'tour-body' })
  const ticks = STEPS.map(() => h('i'))
  const back = h('button', { class: 'btn btn-secondary', style: 'padding:5px 10px', onClick: () => go(-1) }, 'Back')
  const next = h('button', { class: 'btn btn-primary', style: 'padding:5px 12px', onClick: () => go(1) })
  const callout = h(
    'div',
    { class: 'blueprint tour-callout', role: 'dialog' },
    ...corners(),
    h(
      'div',
      { class: 'between', style: 'align-items:center' },
      stepKicker,
      h('button', { class: 'btn btn-ghost btn-icon tour-x', title: 'Close tour', onClick: () => actions.closeTour('close') }, icon('x', 14)),
    ),
    title,
    body,
    h('div', { class: 'tour-foot' }, h('div', { class: 'tour-ticks' }, ...ticks), h('div', { style: 'display:flex;gap:6px' }, back, next)),
  )
  stepKicker.classList.add('acc7')
  const spot = [blocker, frame, line, dot, callout]
  app.append(welcome, ...spot)

  function go(d: number) {
    const n = store.get().tour + d
    if (n > STEPS.length) actions.closeTour('done')
    else if (n >= 1) actions.setTour(n)
  }

  function place() {
    const n = store.get().tour
    if (n < 1) return
    const step = STEPS[n - 1]
    const el = app.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
    if (!el) return
    const a = app.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    const r = { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height }
    const right = r.x + r.w
    const bottom = r.y + r.h
    const set = (e: HTMLElement, s: Record<string, number>) => {
      for (const [k, v] of Object.entries(s)) e.style.setProperty(k, v + 'px')
    }
    set(frame, { left: r.x - PAD, top: r.y - PAD, width: r.w + PAD * 2, height: r.h + PAD * 2 })
    let ax: number, ay: number, left: number, top: number
    if (step.place === 'bottom') {
      ax = r.x + r.w / 2
      ay = bottom + PAD
      left = clamp(ax - W / 2, 12, a.width - W - 12)
      top = ay + GAP
      set(line, { left: ax, top: ay, width: 1, height: GAP })
    } else if (step.place === 'right') {
      ax = right + PAD
      ay = r.y + Math.min(r.h / 2, 150)
      left = ax + GAP
      top = clamp(ay - 30, 12, a.height - 260)
      set(line, { left: ax, top: ay, width: GAP, height: 1 })
    } else {
      ax = r.x - PAD
      ay = r.y + r.h / 2
      left = ax - GAP - W
      top = ay - 30
      set(line, { left: ax - GAP, top: ay, width: GAP, height: 1 })
    }
    set(dot, { left: ax - 3, top: ay - 3 })
    set(callout, { left, top })
  }

  new ResizeObserver(place).observe(app)
  window.addEventListener('resize', place)

  document.addEventListener('keydown', (e) => {
    const n = store.get().tour
    if (n < 0) return
    if (e.key === 'Escape') actions.closeTour(n === 0 ? 'skip' : 'close')
    else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1)
    else if (e.key === 'ArrowLeft') go(-1)
    else return
    e.preventDefault()
  })

  store.watch(
    (s) => s.tour,
    (n, prev) => {
      welcome.hidden = n !== 0
      if (n === 0) count.set(countEnabled())
      for (const e of spot) e.hidden = n < 1
      if (n === 0) start.focus()
      if (n < 1) return
      const entering = prev < 1
      if (entering) for (const e of spot) e.classList.add('still')
      stepKicker.textContent = `Step ${n} of ${STEPS.length}`
      title.textContent = STEPS[n - 1].title
      body.textContent = STEPS[n - 1].body
      ticks.forEach((t, i) => t.classList.toggle('on', i < n))
      back.hidden = n === 1
      next.textContent = n === STEPS.length ? 'Done' : 'Next →'
      place()
      next.focus()
      if (entering) requestAnimationFrame(() => requestAnimationFrame(() => spot.forEach((e) => e.classList.remove('still'))))
    },
  )
}
