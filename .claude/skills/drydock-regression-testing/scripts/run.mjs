import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(dirname(dirname(SKILL)))
const REPORTS = join(SKILL, 'reports')
const KEEP_REPORTS = 10
const KEEP_EVIDENCE = 3
const RANK = { FAIL: 3, BLOCKED: 2, PASS: 1, SKIP: 0 }

const git = (args) => execSync(`git -C "${REPO}" ${args}`, { encoding: 'utf8' }).trim()
const fwd = (p) => p.replace(/\\/g, '/')
const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const runDirs = () =>
  (existsSync(REPORTS) ? readdirSync(REPORTS) : [])
    .filter((f) => /^\d{8}-\d{6}-[0-9a-f]{7}$/.test(f) && statSync(join(REPORTS, f)).isDirectory())
    .sort()

function cmdNew() {
  mkdirSync(REPORTS, { recursive: true })
  const commit = git('rev-parse HEAD')
  const id = `${stamp()}-${commit.slice(0, 7)}`
  const dir = join(REPORTS, id)
  mkdirSync(dir)
  const prev = runDirs().filter((f) => f !== id).pop() ?? null
  const info = {
    id,
    commit,
    subject: git('log -1 --format=%s'),
    dirty: git('status --porcelain=v1').split('\n').filter(Boolean),
    started: new Date().toISOString(),
    previous: prev,
  }
  writeFileSync(join(dir, 'run.json'), JSON.stringify(info, null, 2))
  console.log(fwd(dir))
}

function parseReport(text) {
  const lines = text.split(/\r?\n/)
  const sections = {}
  let cur = 'head'
  sections[cur] = []
  for (const l of lines) {
    const m = /^## (.+)$/.exec(l)
    if (m) {
      cur = m[1].trim().toLowerCase()
      sections[cur] = []
    } else sections[cur].push(l)
  }
  const head = sections.head.filter((l) => l.startsWith('- '))
  const results = []
  for (const l of sections.results ?? []) {
    const m = /^\|\s*([A-Z]+\d+[a-z]?)\s*\|\s*(PASS|FAIL|BLOCKED|SKIP)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/.exec(l)
    if (m) results.push({ step: m[1], result: m[2], evidence: m[3], notes: m[4] })
  }
  const defects = []
  let d = null
  for (const l of sections.defects ?? []) {
    const m = /^### (.+)$/.exec(l)
    if (m) {
      d = { title: m[1].trim(), body: [] }
      defects.push(d)
    } else if (d) d.body.push(l)
  }
  const block = (k) => (sections[k] ?? []).join('\n').trim()
  return { head, results, defects, observations: block('observations'), deviations: block('deviations'), maintenance: block('maintenance') }
}

function parseMerged(text) {
  const out = {}
  const inResults = /## Results[\s\S]*?(?=\n## |$)/.exec(text)
  if (!inResults) return out
  for (const l of inResults[0].split(/\r?\n/)) {
    const m = /^\|\s*([A-Z]+\d+[a-z]?)\s*\|\s*(PASS|FAIL|BLOCKED|SKIP|—)\s*\|\s*(PASS|FAIL|BLOCKED|SKIP|—)\s*\|\s*(PASS|FAIL|BLOCKED|SKIP)\s*\|/.exec(l)
    if (m) out[m[1]] = m[4]
  }
  return out
}

const worst = (...rs) => {
  const real = rs.filter(Boolean)
  if (!real.length) return null
  return real.sort((a, b) => RANK[b] - RANK[a])[0]
}

function cmdMerge(arg) {
  const dir = arg ? (existsSync(arg) ? arg : join(REPORTS, arg)) : join(REPORTS, runDirs().pop() ?? '')
  if (!existsSync(join(dir, 'run.json'))) throw new Error(`no run.json in ${dir}`)
  const info = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))
  const runners = {}
  for (const r of ['A', 'B']) {
    const p = join(dir, r, 'report.md')
    if (existsSync(p)) runners[r] = parseReport(readFileSync(p, 'utf8'))
  }
  const names = Object.keys(runners)
  if (!names.length) throw new Error(`no A/report.md or B/report.md in ${dir}`)

  const order = []
  for (const r of names) for (const x of runners[r].results) if (!order.includes(x.step)) order.push(x.step)
  const byStep = (r, step) => runners[r]?.results.find((x) => x.step === step) ?? null
  const rows = order.map((step) => {
    const a = byStep('A', step)
    const b = byStep('B', step)
    const overall = worst(a?.result, b?.result)
    const notes = []
    for (const [r, x] of [['A', a], ['B', b]]) {
      if (!x) continue
      const bits = [x.notes, x.evidence && x.evidence !== '—' ? `evidence ${r}/${x.evidence.replace(/, /g, `, ${r}/`)}` : ''].filter(Boolean)
      if (bits.length) notes.push(`${r}: ${bits.join('; ')}`)
    }
    return { step, a: a?.result ?? '—', b: b?.result ?? '—', overall, notes: notes.join(' · ') }
  })
  const count = (k) => rows.filter((r) => r.overall === k).length
  const per = (r) => {
    const rs = runners[r]?.results ?? []
    const c = (k) => rs.filter((x) => x.result === k).length
    return `${r}: PASS ${c('PASS')} · FAIL ${c('FAIL')} · BLOCKED ${c('BLOCKED')} · SKIP ${c('SKIP')}`
  }

  let prevId = info.previous
  let prev = null
  if (prevId && existsSync(join(REPORTS, prevId, 'report.md'))) prev = parseMerged(readFileSync(join(REPORTS, prevId, 'report.md'), 'utf8'))
  else prevId = null
  const changes = { newFail: [], newBlocked: [], fixed: [], added: [], removed: [] }
  if (prev) {
    for (const r of rows) {
      const p = prev[r.step]
      if (!p) changes.added.push(r.step)
      else if (r.overall === 'FAIL' && p !== 'FAIL') changes.newFail.push(`${r.step} (${p} → FAIL)`)
      else if (r.overall === 'BLOCKED' && p !== 'BLOCKED' && p !== 'FAIL') changes.newBlocked.push(`${r.step} (${p} → BLOCKED)`)
      else if (r.overall === 'PASS' && (p === 'FAIL' || p === 'BLOCKED')) changes.fixed.push(`${r.step} (${p} → PASS)`)
    }
    for (const s of Object.keys(prev)) if (!rows.some((r) => r.step === s)) changes.removed.push(s)
  }

  const focus = existsSync(join(dir, 'focus.md')) ? readFileSync(join(dir, 'focus.md'), 'utf8').trim() : ''
  const list = (xs) => (xs.length ? xs.join(', ') : 'none')
  const out = []
  out.push(`# Drydock regression report — ${info.id}`, '')
  out.push(`- Commit: ${info.commit} (${info.subject})`)
  out.push(`- Working tree at start: ${info.dirty.length ? info.dirty.join(', ') : 'clean'}`)
  out.push(`- Started: ${info.started}; merged: ${new Date().toISOString()}`)
  out.push(`- Runners: ${names.join(', ')}${names.length < 2 ? ' (single-runner run)' : ''}`)
  out.push(`- Previous run: ${prevId ?? 'none'}`)
  for (const r of names) {
    out.push('', `### Runner ${r}`, ...runners[r].head)
  }
  out.push('', '## Summary', '', `Overall (worst of A/B per step): PASS ${count('PASS')} · FAIL ${count('FAIL')} · BLOCKED ${count('BLOCKED')} · SKIP ${count('SKIP')}`, '')
  for (const r of names) out.push(`- ${per(r)}`)
  out.push('', `## Changes since previous run${prevId ? ` (${prevId})` : ''}`, '')
  if (!prev) out.push('No previous merged report to compare with.')
  else {
    out.push(`- New failures: ${list(changes.newFail)}`)
    out.push(`- Newly blocked: ${list(changes.newBlocked)}`)
    out.push(`- Fixed: ${list(changes.fixed)}`)
    out.push(`- Steps added: ${list(changes.added)}`)
    out.push(`- Steps removed: ${list(changes.removed)}`)
  }
  if (focus) out.push('', '## Focus of this run', '', focus)
  out.push('', '## Results', '', '| Step | A | B | Overall | Notes |', '|---|---|---|---|---|')
  for (const r of rows) out.push(`| ${r.step} | ${r.a} | ${r.b} | ${r.overall} | ${r.notes.replace(/\|/g, '\\|')} |`)
  out.push('', '## Defects', '')
  let any = false
  for (const r of names)
    for (const d of runners[r].defects) {
      any = true
      out.push(`### ${r}-${d.title}`, ...d.body.map((l) => l.replace(/(Evidence:\s*)(.+)/, (m, k, v) => k + v.split(/,\s*/).map((p) => `${r}/${p.trim()}`).join(', '))), '')
    }
  if (!any) out.push('None.', '')
  for (const k of ['observations', 'deviations']) {
    out.push(`## ${k[0].toUpperCase()}${k.slice(1)}`, '')
    let got = false
    for (const r of names)
      if (runners[r][k]) {
        got = true
        out.push(`### Runner ${r}`, '', runners[r][k], '')
      }
    if (!got) out.push('None.', '')
  }
  out.push('## Maintenance', '', existsSync(join(dir, 'maintenance.md')) ? readFileSync(join(dir, 'maintenance.md'), 'utf8').trim() : 'No maintenance notes recorded for this run.', '')
  writeFileSync(join(dir, 'report.md'), out.join('\n'))
  info.merged = new Date().toISOString()
  info.summary = { PASS: count('PASS'), FAIL: count('FAIL'), BLOCKED: count('BLOCKED'), SKIP: count('SKIP') }
  info.changes = changes
  writeFileSync(join(dir, 'run.json'), JSON.stringify(info, null, 2))
  console.log(JSON.stringify({ report: fwd(join(dir, 'report.md')), summary: info.summary, changes, pruned: prune() }, null, 1))
}

function prune() {
  const dirs = runDirs()
  const deleted = []
  const trimmed = []
  for (const f of dirs.slice(0, Math.max(0, dirs.length - KEEP_REPORTS))) {
    rmSync(join(REPORTS, f), { recursive: true, force: true })
    deleted.push(f)
  }
  const kept = runDirs()
  for (const f of kept.slice(0, Math.max(0, kept.length - KEEP_EVIDENCE))) {
    for (const r of ['A', 'B'])
      for (const sub of ['shots', 'files']) {
        const p = join(REPORTS, f, r, sub)
        if (existsSync(p)) {
          rmSync(p, { recursive: true, force: true })
          trimmed.push(`${f}/${r}/${sub}`)
        }
      }
  }
  return { deleted, trimmed }
}

function cmdList() {
  for (const f of runDirs()) {
    const p = join(REPORTS, f, 'run.json')
    const info = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
    const s = info.summary ? `PASS ${info.summary.PASS} FAIL ${info.summary.FAIL} BLOCKED ${info.summary.BLOCKED} SKIP ${info.summary.SKIP}` : existsSync(join(REPORTS, f, 'report.md')) ? 'merged' : 'not merged'
    console.log(`${f}  ${s}`)
  }
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'new') cmdNew()
else if (cmd === 'merge') cmdMerge(arg)
else if (cmd === 'prune') console.log(JSON.stringify(prune(), null, 1))
else if (cmd === 'list') cmdList()
else {
  console.error('usage: node run.mjs new | merge [run id or dir] | prune | list')
  process.exit(2)
}
