import { actions, store } from '../state/app.ts'
import { LANGS, NATIVE, tr, type Lang } from '../i18n.ts'
import { check, corners, h, icon, kicker, seg, t, tAttr, tRich } from './dom.ts'
import { countEnabled, setCountEnabled } from '../util/count.ts'

type Place = 'bottom' | 'right' | 'left'

const STEPS: Array<{ target: string; place: Place }> = [
  { target: 'sources', place: 'bottom' },
  { target: 'library', place: 'right' },
  { target: 'vptools', place: 'bottom' },
  { target: 'tabs', place: 'left' },
  { target: 'export', place: 'bottom' },
  { target: 'mode', place: 'bottom' },
]

const PAD = 6
const GAP = 28
const W = 300

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function mountTour(app: HTMLElement) {
  const count = check(t('welcome.count'), setCountEnabled, 'chk tour-count')
  const lang = seg<Lang>({
    options: LANGS.map((code) => [code, h('span', { lang: code }, NATIVE[code])]),
    value: store.get().locale,
    style: 'display:flex',
    optCls: 'tour-lang-opt',
    onChange: (v) => void actions.setLang(v),
  })
  const start = h('button', { class: 'btn btn-primary tour-big', style: 'justify-content:space-between', onClick: () => actions.setTour(1) }, t('welcome.start'), h('span', null, '→'))
  const welcome = h(
    'div',
    { class: 'tour-welcome' },
    h(
      'div',
      { class: 'dlg blueprint tour-card' },
      ...corners(),
      h('div', { class: 'tour-lang' }, h('span', { class: 'kicker' }, icon('languages', 13), t('language.title')), lang.el),
      kicker(t('welcome.kicker')),
      h('span', { class: 'tour-hello' }, t('welcome.title')),
      h('span', { class: 'tour-lead' }, t('welcome.lead')),
      h(
        'div',
        { class: 'tour-choice' },
        start,
        h('button', { class: 'btn btn-secondary tour-big', onClick: () => actions.closeTour('skip') }, t('welcome.explore')),
      ),
      h('span', { class: 's11 muted' }, tRich('welcome.note', { tour: () => h('b', { class: 'acc7' }, tr('nav.tour')) })),
      h(
        'div',
        null,
        count.el,
        h('span', { class: 's11 muted' }, t('welcome.countNote')),
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
  const back = h('button', { class: 'btn btn-secondary', style: 'padding:5px 10px', onClick: () => go(-1) }, t('tour.back'))
  const next = h('button', { class: 'btn btn-primary', style: 'padding:5px 12px', onClick: () => go(1) })
  const callout = h(
    'div',
    { class: 'blueprint tour-callout', role: 'dialog' },
    ...corners(),
    h(
      'div',
      { class: 'between', style: 'align-items:center' },
      stepKicker,
      tAttr(h('button', { class: 'btn btn-ghost btn-icon tour-x', onClick: () => actions.closeTour('close') }, icon('x', 14)), 'title', 'tour.close'),
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
    const ctl = (e.target as Element).closest?.('button, a, input, select, textarea, label')
    if (e.key === 'Escape') actions.closeTour(n === 0 ? 'skip' : 'close')
    else if (ctl && (e.key === 'Enter' || !ctl.matches('button, a'))) return
    else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1)
    else if (e.key === 'ArrowLeft') go(-1)
    else return
    e.preventDefault()
  })

  store.watch((s) => s.locale, lang.set)
  store.watch(
    (s) => [s.tour, s.locale] as const,
    ([n], [prev]) => {
      welcome.hidden = n !== 0
      if (n === 0) count.set(countEnabled())
      for (const e of spot) e.hidden = n < 1
      if (n === 0 && prev !== 0) start.focus()
      if (n < 1) return
      const entering = prev < 1
      if (entering) for (const e of spot) e.classList.add('still')
      const step = STEPS[n - 1].target
      stepKicker.textContent = tr('tour.stepOf', { n, total: STEPS.length })
      title.textContent = tr(`tour.steps.${step}.title`)
      body.textContent = tr(`tour.steps.${step}.body`)
      ticks.forEach((t, i) => t.classList.toggle('on', i < n))
      back.hidden = n === 1
      next.textContent = tr(n === STEPS.length ? 'tour.done' : 'tour.next')
      place()
      if (n !== prev) next.focus()
      if (entering) requestAnimationFrame(() => requestAnimationFrame(() => spot.forEach((e) => e.classList.remove('still'))))
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
}
