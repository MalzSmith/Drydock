import { tr } from '../i18n.ts'
import { store } from '../state/app.ts'
import ICONS from './icons.ts'

type Child = Node | string | number | null | false | undefined
type Props = Record<string, unknown>

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (props)
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') el.className = v as string
      else if (k === 'style') el.setAttribute('style', v as string)
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'readOnly') (el as unknown as Props)[k] = v
      else el.setAttribute(k, v === true ? '' : String(v))
    }
  append(el, children)
  return el
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue
    el.append(typeof c === 'object' ? c : String(c))
  }
}

export function replaceChildren(el: Element, ...children: Child[]) {
  el.replaceChildren()
  append(el, children)
}

export function icon(name: string, size = 14, stroke: string | null = null): SVGElement {
  const t = document.createElement('template')
  t.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="fill:none;stroke:${stroke ?? 'currentColor'};stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none">${ICONS[name]}</svg>`
  return t.content.firstChild as SVGElement
}

export function corners(): HTMLElement[] {
  return ['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: 'corner ' + c }))
}

export type Seg<T> = { el: HTMLElement; set(v: T): void }

let segId = 0

export function seg<T extends string | number | boolean>(opts: {
  options: Array<[T, string | Node]>
  value: T
  onChange: (v: T) => void
  cls?: string
  style?: string
  optStyle?: string
  optCls?: string
  titles?: string[]
}): Seg<T> {
  const name = 'seg' + segId++
  const inputs: Array<[T, HTMLInputElement]> = []
  const el = h(
    'div',
    { class: 'seg ' + (opts.cls ?? ''), style: opts.style },
    ...opts.options.map(([v, label], i) => {
      const input = h('input', { type: 'radio', name, checked: v === opts.value, onChange: () => opts.onChange(v) })
      inputs.push([v, input])
      return h('label', { class: 'seg-opt ' + (opts.optCls ?? ''), style: opts.optStyle, title: opts.titles?.[i] }, input, label)
    }),
  )
  return {
    el,
    set(v) {
      for (const [x, i] of inputs) i.checked = x === v
    },
  }
}

export type Check = { el: HTMLElement; set(v: boolean): void }

export function check(label: string | Node, onChange: (v: boolean) => void, cls = 'chk'): Check {
  const input = h('input', { type: 'checkbox', onChange: () => onChange(input.checked) })
  return {
    el: h('label', { class: cls }, label, input),
    set(v) {
      input.checked = v
    },
  }
}

export function kicker(text: string | Node): HTMLElement {
  return h('span', { class: 'kicker' }, text)
}

export function text(initial = ''): { el: HTMLElement; set(v: string): void } {
  const el = h('span', null, initial)
  return {
    el,
    set(v) {
      if (el.textContent !== v) el.textContent = v
    },
  }
}

type Params = Record<string, string | number>

export function t(key: string, p?: Params): Text {
  const node = document.createTextNode('')
  store.watch((s) => s.locale, () => (node.data = tr(key, p)))
  return node
}

export function tAttr<E extends Element>(el: E, attr: string, key: string): E {
  store.watch((s) => s.locale, () => el.setAttribute(attr, tr(key)))
  return el
}

export function tRich(key: string, parts: Record<string, () => Node>): HTMLElement {
  const el = h('span')
  store.watch(
    (s) => s.locale,
    () => replaceChildren(el, ...tr(key).split(/\{(\w+)\}/).map((x, i) => (i % 2 ? (parts[x]?.() ?? x) : x))),
  )
  return el
}

export function progressBar() {
  const fill = h('i')
  const el = h('span', { class: 'prog' }, fill)
  return {
    el,
    set(frac: number | null) {
      el.hidden = false
      el.classList.toggle('indet', frac === null)
      fill.style.width = frac === null ? '' : `${Math.round(frac * 100)}%`
    },
  }
}
