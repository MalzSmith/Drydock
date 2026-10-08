import { LANGS, NATIVE, detectLang, tr, type LangSetting } from '../i18n.ts'
import { actions, store } from '../state/app.ts'
import { corners, h, icon, kicker, t, tAttr, tRich } from './dom.ts'

export function mountLangMenu(): HTMLElement {
  const cur = h('span', { class: 'lang-nm' })
  const btn = tAttr(
    h('button', { class: 'btn btn-secondary lang-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: () => toggle() }, icon('languages', 14), cur, icon('chevron-down', 12, 'var(--color-neutral-600)')),
    'title',
    'language.title',
  )
  const checkCol = () => h('span', { class: 'lang-chk' }, icon('check', 14, 'var(--color-accent)'))
  const pick = (v: LangSetting) => () => {
    close()
    btn.focus()
    void actions.setLang(v)
  }

  const detected = h('span', { class: 'lang-sys' })
  const autoRow = h(
    'button',
    { class: 'lang-row lang-auto', role: 'menuitemradio', onClick: pick('auto') },
    checkCol(),
    h('span', { class: 'col' }, h('span', { class: 'lang-nm' }, t('language.browser')), h('span', { class: 'lang-sub' }, tRich('language.current', { lang: () => detected }))),
  )
  const rows = LANGS.map((code) => {
    const sec = h('span', { class: 'lang-sec' })
    const row = h('button', { class: 'lang-row', role: 'menuitemradio', onClick: pick(code) }, checkCol(), h('span', { class: 'lang-nm', lang: code }, NATIVE[code]), sec)
    return { code, row, sec }
  })
  const items = [autoRow, ...rows.map((r) => r.row)]
  const menu = h(
    'div',
    { class: 'blueprint lang-menu', role: 'menu', hidden: true },
    ...corners(),
    kicker(t('language.title')),
    autoRow,
    h('i', { class: 'lang-div' }),
    ...rows.map((r) => r.row),
    h('div', { class: 'lang-foot' }, h('a', { href: 'https://github.com/MalzSmith/Drydock', target: '_blank', rel: 'noopener' }, t('language.help'))),
  )
  const el = h('div', { class: 'lang' }, btn, menu)

  function open() {
    menu.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    const v = store.get().lang
    items[v === 'auto' ? 0 : LANGS.indexOf(v) + 1].focus()
  }
  function close() {
    menu.hidden = true
    btn.setAttribute('aria-expanded', 'false')
  }
  const toggle = () => (menu.hidden ? open() : close())

  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !el.contains(e.target as Node)) close()
  })
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      close()
      btn.focus()
    } else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus()
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus()
    else if (e.key === 'Home') items[0].focus()
    else if (e.key === 'End') items[items.length - 1].focus()
    else return
    e.preventDefault()
    e.stopPropagation()
  })

  store.watch(
    (s) => [s.lang, s.locale] as const,
    ([lang, locale]) => {
      cur.lang = locale
      cur.textContent = NATIVE[locale]
      const sys = detectLang()
      detected.lang = sys
      detected.textContent = NATIVE[sys]
      autoRow.classList.toggle('on', lang === 'auto')
      autoRow.setAttribute('aria-checked', String(lang === 'auto'))
      for (const r of rows) {
        r.row.classList.toggle('on', lang === r.code)
        r.row.setAttribute('aria-checked', String(lang === r.code))
        const name = tr(`languageNames.${r.code}`)
        r.sec.textContent = name === NATIVE[r.code] ? '' : name
      }
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
  return el
}
