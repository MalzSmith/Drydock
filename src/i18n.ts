import enJson from './locales/en.json'
import type { Params } from './util/keyed.ts'

export const LANGS = ['en', 'de', 'ru', 'zh-Hans', 'zh-Hant'] as const
export type Lang = (typeof LANGS)[number]
export type LangSetting = Lang | 'auto'

export const NATIVE: Record<Lang, string> = { en: 'English', de: 'Deutsch', ru: 'Русский', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' }

type Entry = string | string[] | Dict
type Dict = { [k: string]: Entry }

const en = enJson as Dict
const KEY = 'drydock.lang'
const cache: Partial<Record<Lang, Dict>> = { en }
let dict: Dict = en
let lang: Lang = 'en'
let nf = new Intl.NumberFormat('en')
let nf1 = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
let pr = new Intl.PluralRules('en')

export function detectLang(): Lang {
  for (const raw of navigator.languages ?? [navigator.language]) {
    const l = raw.toLowerCase()
    if (l.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(l) ? 'zh-Hant' : 'zh-Hans'
    if (l.startsWith('de')) return 'de'
    if (l.startsWith('ru')) return 'ru'
    if (l.startsWith('en')) return 'en'
  }
  return 'en'
}

export function readLangSetting(): LangSetting {
  try {
    const v = localStorage.getItem(KEY)
    if (v && (LANGS as readonly string[]).includes(v)) return v as Lang
  } catch {}
  return 'auto'
}

export function saveLangSetting(v: LangSetting) {
  try {
    if (v === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, v)
  } catch {}
}

export const resolveLang = (v: LangSetting): Lang => (v === 'auto' ? detectLang() : v)

export async function ensureLocale(l: Lang): Promise<void> {
  cache[l] ??= (await import(`./locales/${l}.json`)).default as Dict
}

export function applyLocale(l: Lang) {
  dict = cache[l] ?? en
  lang = l
  nf = new Intl.NumberFormat(l)
  nf1 = new Intl.NumberFormat(l, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  pr = new Intl.PluralRules(l)
  document.documentElement.lang = l
}

let booted: Promise<void> | null = null

export function bootLocale(): Promise<void> {
  const l = resolveLang(readLangSetting())
  return (booted ??= ensureLocale(l).then(
    () => applyLocale(l),
    () => undefined,
  ))
}

export const currentLang = () => lang
export const fmt = (n: number) => nf.format(n)
export const fmt1 = (n: number) => nf1.format(n)

function lookup(d: Dict, key: string): Entry | undefined {
  let v: Entry | undefined = d
  for (const k of key.split('.')) v = v && typeof v === 'object' && !Array.isArray(v) ? v[k] : undefined
  return v
}

function raw(key: string, count?: number): string {
  let v = lookup(dict, key) ?? lookup(en, key)
  if (v && typeof v === 'object' && !Array.isArray(v)) v = v[pr.select(count ?? 0)] ?? v.other
  return typeof v === 'string' ? v : key
}

export function tr(key: string, p?: Params): string {
  const s = raw(key, typeof p?.count === 'number' ? p.count : undefined)
  return p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? (typeof p[k] === 'number' ? fmt(p[k]) : p[k]) : m)) : s
}

export function msg(text: string): string {
  if (!text.startsWith('@')) return text
  try {
    if (text[1] === '[') return (JSON.parse(text.slice(1)) as string[]).map(msg).join(' · ')
    const sp = text.indexOf(' ')
    if (sp < 0) return tr(text.slice(1))
    const p = JSON.parse(text.slice(sp + 1)) as Params
    for (const k in p) if (typeof p[k] === 'string') p[k] = msg(p[k] as string)
    return tr(text.slice(1, sp), p)
  } catch {
    return text
  }
}
