import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(dirname(dirname(SKILL)))
const outPath = process.argv[2] ? process.argv[2] : null

function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}
const read = (p) => readFileSync(p, 'utf8')
const srcFiles = [...walk(join(REPO, 'src'))].filter((p) => /\.(ts|css)$/.test(p) && !p.includes(`${join('src', 'locales')}`))
srcFiles.push(join(REPO, 'index.html'))
const src = srcFiles.map(read).join('\n')
const testFiles = [...walk(join(REPO, 'test'))].filter((p) => p.endsWith('.ts'))
const tests = testFiles.map(read).join('\n')
const appTs = read(join(REPO, 'src/app.ts'))
const stateTs = read(join(REPO, 'src/state/app.ts'))
const en = JSON.parse(read(join(REPO, 'src/locales/en.json')))
const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const kk = p ? `${p}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, kk, out)
    out[kk] = v
  }
  return out
}
const enKeys = new Set(Object.keys(flat(en)))
const localeFiles = readdirSync(join(REPO, 'src/locales')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))

const docFiles = [join(SKILL, 'SKILL.md'), ...(existsSync(join(SKILL, 'reference')) ? readdirSync(join(SKILL, 'reference')).map((f) => join(SKILL, 'reference', f)) : [])].filter((p) => p.endsWith('.md') && existsSync(p))

const EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'zip', 'sbc', 'sbcb5', 'json', 'mjs', 'js', 'sh', 'md', 'txt', 'gz', 'ts', 'css', 'html', 'vite', 'git', 'gitignore', 'claude', 'exe', 'dll', 'vdf', 'resx', 'xml', 'pid', 'log', 'jsonl', 'sha256', 'invalid', 'com', 'io', 'env', 'github', 'yml'])
const TAGS = '(?:button|label|canvas|html|div|span|input|table|tbody|thead|tr|td|a|body|select|form|svg|section|nav|header|footer|p|ul|li)'
const classRe = new RegExp(`(?:^|[\\s>+~(:,]|${TAGS})\\.([a-z][a-z0-9-]*)(?![a-z0-9(-])`, 'g')
const idRe = /(?:^|[\s>+~(:,])#([a-z][a-z0-9-]*)/g
const I18N_BARE = new Set(['toast', 'errors', 'welcome', 'tour', 'library', 'nav', 'narrow', 'caption', 'footer', 'units', 'kinds', 'status', 'viewport', 'tabs', 'progress', 'language', 'languageNames', 'missing'])

const found = new Map()
const add = (kind, token, file, line) => {
  const k = `${kind}\u0000${token}`
  if (!found.has(k)) found.set(k, { kind, token, where: [] })
  const w = found.get(k).where
  const loc = `${relative(SKILL, file).replace(/\\/g, '/')}:${line}`
  if (!w.includes(loc) && w.length < 6) w.push(loc)
}

const selectorLike = (t) => {
  const s = t.replace(/\$\{[^}]*\}/g, ' ').trim()
  if (!s || /=>|;|\breturn\b|\bawait\b|\bconst\b|\blib\.|\bs\.page|\bwindow\.|\bprocess\./.test(s)) return null
  if (!/^(?:[.#\[]|[a-z]+(?:[.#\[\s>]|$))/.test(s)) return null
  return s
}

for (const file of docFiles) {
  const lines = read(file).split(/\r?\n/)
  let fence = false
  lines.forEach((raw, i) => {
    const n = i + 1
    if (/^\s*```/.test(raw)) {
      fence = !fence
      return
    }
    const cands = []
    if (fence) {
      for (const m of raw.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) cands.push(m[1] ?? m[2])
    } else {
      for (const m of raw.matchAll(/`([^`]+)`/g)) {
        cands.push(m[1])
        for (const q of m[1].matchAll(/'([^']*)'/g)) cands.push(q[1])
      }
    }
    for (const c of cands) {
      const s = selectorLike(c)
      if (s) {
        for (const m of s.matchAll(classRe)) if (!EXT.has(m[1])) add('class', m[1], file, n)
        for (const m of s.matchAll(idRe)) if (!/^[0-9a-f]{6}$/.test(m[1])) add('id', m[1], file, n)
        for (const m of s.matchAll(/data-tour="([a-z]+)"/g)) add('data-tour', m[1], file, n)
      }
      const key = /^(@?)([a-z][A-Za-z]*)\.([a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*)$/.exec(c.trim())
      if (key && key[2] in en && (key[1] || I18N_BARE.has(key[2]))) add('i18n', `${key[2]}.${key[3]}`, file, n)
      for (const m of c.matchAll(/(?<![\w])drydock\.([a-zA-Z]+)/g)) add('storage', `drydock.${m[1]}`, file, n)
      for (const m of c.matchAll(/__drydock\.([a-zA-Z]+)/g)) add('hook', m[1], file, n)
      for (const m of c.matchAll(/\bactions\.([a-zA-Z]+)/g)) add('action', m[1], file, n)
      if (/(?:^|[?&])[a-z]+=/.test(c) && !/https?:|[\s]/.test(c.trim())) for (const m of c.matchAll(/(?:^|[?&])([a-z]+)=/g)) add('param', m[1], file, n)
      if (/^[a-z][\w-]*(?: [\w-]+)* > .{12,}$/i.test(c.trim()) && !/[.#\[]/.test(c.split(' > ')[0])) {
        const [d, ...rest] = c.trim().split(' > ')
        add('test', `${d} > ${rest.join(' > ')}`, file, n)
      }
      for (const m of c.matchAll(/\b((?:src|test|scripts|public)\/[\w./-]+\.\w+)/g)) add('path', m[1], file, n)
    }
    for (const m of raw.matchAll(/\b(describe|it)\(['"]([^'"]+)['"]\)/g)) add('test-fn', `${m[1]}:${m[2]}`, file, n)
    for (const m of raw.matchAll(/\[('[a-zA-Z-]+'(?:,\s*'[a-zA-Z-]+')+)\]/g)) if (m[1].includes("'en'")) for (const c of m[1].matchAll(/'([a-zA-Z-]+)'/g)) add('locale', c[1], file, n)
    for (const m of raw.matchAll(/targets = \[([^\]]+)\]/g)) for (const c of m[1].matchAll(/'([a-z]+)'/g)) add('data-tour', c[1], file, n)
    for (const m of raw.matchAll(/`v` (\d+) \(`PARSE_VERSION`/g)) add('const', `PARSE_VERSION=${m[1]}`, file, n)
  })
}

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
const word = (t) => new RegExp(`(?<![\\w-])${esc(t)}(?![\\w-])`)
const testCall = (fn, name) => new RegExp(`\\b${fn}(?:\\.\\w+(?:\\([^)]*\\))?)?\\(['"]${esc(name)}['"]`).test(tests)
const hookBlock = (/__drydock = \{([\s\S]*?)\n\}/.exec(appTs) ?? [, ''])[1]
const checks = {
  class: (t) => word(t).test(src),
  id: (t) => word(t).test(src),
  'data-tour': (t) => new RegExp(`target: '${t}'|data-tour="${t}"|data-tour=\\$\\{`).test(src) && (new RegExp(`'${t}'`).test(src) || new RegExp(`"${t}"`).test(src)),
  i18n: (t) => enKeys.has(t),
  storage: (t) => src.includes(`'${t}'`) || src.includes(`"${t}"`),
  hook: (t) => new RegExp(`(^|[\\s{,])${t}\\b`).test(hookBlock),
  action: (t) => new RegExp(`^\\s+(?:async\\s+)?${t}\\s*[:(]`, 'm').test(stateTs),
  param: (t) => new RegExp(`\\.get\\('${t}'\\)`).test(src),
  test: (t) => {
    const [d, it] = t.split(' > ')
    return testCall('describe', d) && (testCall('it', it) || testCall('test', it))
  },
  'test-fn': (t) => {
    const [fn, name] = t.split(/:(.*)/s)
    return testCall(fn, name)
  },
  path: (t) => existsSync(join(REPO, t)) || existsSync(join(SKILL, t)),
  locale: (t) => localeFiles.includes(t),
  const: (t) => {
    const [name, v] = t.split('=')
    const m = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(read(join(REPO, 'src/se/blueprint.ts')))
    return !!m && m[1] === v
  },
}

const missing = []
let checked = 0
for (const f of found.values()) {
  checked++
  if (!checks[f.kind](f.token)) missing.push(f)
}
const localesNotInDocs = localeFiles.filter((l) => ![...found.values()].some((f) => f.kind === 'locale' && f.token === l))
const tourTargets = [...src.matchAll(/target: '([a-z]+)'/g)].map((m) => m[1])
const tourNotInDocs = tourTargets.filter((t) => ![...found.values()].some((f) => f.kind === 'data-tour' && f.token === t))
const paramsInApp = [...appTs.matchAll(/q\.get\('([a-z]+)'\)/g)].map((m) => m[1])
const paramsNotInDocs = [...new Set(paramsInApp)].filter((p) => ![...found.values()].some((f) => f.kind === 'param' && f.token === p))
const toastKeysInApp = Object.keys(en.toast ?? {})
const toastNotInDocs = toastKeysInApp.filter((k) => ![...found.values()].some((f) => f.kind === 'i18n' && f.token === `toast.${k}`))

const result = {
  skill: SKILL,
  docs: docFiles.map((p) => relative(SKILL, p).replace(/\\/g, '/')),
  checked,
  missing: missing.map((m) => ({ kind: m.kind, token: m.token, where: m.where })),
  uncovered: {
    locales: localesNotInDocs,
    tourTargets: tourNotInDocs,
    urlParams: paramsNotInDocs,
    toastKeys: toastNotInDocs,
  },
  counts: Object.fromEntries(Object.keys(checks).map((k) => [k, [...found.values()].filter((f) => f.kind === k).length])),
}
const text = JSON.stringify(result, null, 1)
if (outPath) writeFileSync(outPath, text)
console.log(text)
console.log(`\naudit: ${checked} references checked, ${missing.length} missing${missing.length ? '' : ' — docs match the code'}`)
for (const m of missing) console.log(`  MISSING ${m.kind} ${m.token}  (${m.where.join(', ')})`)
for (const [k, v] of Object.entries(result.uncovered)) if (v.length) console.log(`  UNCOVERED ${k}: ${v.join(', ')}`)
process.exit(missing.length ? 1 : 0)
