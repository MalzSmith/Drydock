import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

const OUT = process.env.DD_FIX
const REPO = process.env.DD_REPO
if (!OUT || !REPO) throw new Error('DD_FIX and DD_REPO must be set (source your work/<runner>/env.sh first)')
const LOCAL = process.env.DD_LOCAL_BP ?? ''
const CLOUD = process.env.DD_CLOUD_BP ?? ''
const WORKSHOP = process.env.DD_WORKSHOP ?? ''
const bpRoot = join(OUT, 'bp')
const isGz = (b) => b.length > 1 && b[0] === 0x1f && b[1] === 0x8b
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function meta(buf, folder) {
  const t = (isGz(buf) ? gunzipSync(buf) : buf).subarray(0, 65536).toString('utf8')
  const head = t.slice(0, 4096)
  const at = head.indexOf('<Id ')
  const m = at >= 0 ? /Subtype="([^"]*)"/.exec(head.slice(at, head.indexOf('>', at) + 1)) : null
  const g = /<GridSizeEnum>\s*(\w+)/.exec(t)
  return { name: m && m[1] ? unesc(m[1]) : folder, large: g ? g[1] !== 'Small' : true }
}

function put(folder, data) {
  mkdirSync(join(bpRoot, folder), { recursive: true })
  writeFileSync(join(bpRoot, folder, 'bp.sbc'), data)
}

const list = (dir) =>
  dir && existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => existsSync(join(dir, f, 'bp.sbc')))
        .map((f) => ({ f, p: join(dir, f, 'bp.sbc'), size: statSync(join(dir, f, 'bp.sbc')).size }))
    : []

const blk = (type, sub, x, y, z) => `<MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_${type}"><SubtypeName>${sub}</SubtypeName><Min x="${x}" y="${y}" z="${z}" /></MyObjectBuilder_CubeBlock>`
const doc = (name, grid, blocks, pad = '') =>
  `<?xml version="1.0"?>\n<Definitions xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><ShipBlueprints><ShipBlueprint xsi:type="MyObjectBuilder_ShipBlueprintDefinition"><Id Type="MyObjectBuilder_ShipBlueprintDefinition" Subtype="${name}" />${pad}<CubeGrids><CubeGrid><GridSizeEnum>${grid}</GridSizeEnum><CubeBlocks>\n${blocks.join('\n')}\n</CubeBlocks></CubeGrid></CubeGrids></ShipBlueprint></ShipBlueprints></Definitions>\n`
const cube = (n, f) => {
  const a = []
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) a.push(f(x, y, z))
  return a
}

mkdirSync(bpRoot, { recursive: true })
mkdirSync(join(OUT, 'empty'), { recursive: true })
mkdirSync(join(OUT, 'misc'), { recursive: true })
const manifest = { pairs: [], cloud: [], synthetic: {}, mod: null, localCount: list(LOCAL).length, workshopBlueprints: 0, dirs: {} }

const locals = list(LOCAL).filter((x) => x.size < 30e6).sort((a, b) => a.size - b.size)
const picks = [...new Set([locals[0], locals[locals.length >> 1], locals[locals.length - 1]].filter(Boolean))]
for (const x of picks) {
  const raw = readFileSync(x.p)
  const plain = isGz(raw) ? gunzipSync(raw) : raw
  put(`P ${x.f}`, plain)
  put(`G ${x.f}`, gzipSync(plain))
  manifest.pairs.push({ from: 'local', plain: `P ${x.f}`, gz: `G ${x.f}`, bytes: plain.length, ...meta(plain, x.f) })
}

for (const x of list(CLOUD)) {
  const raw = readFileSync(x.p)
  manifest.cloud.push({ folder: x.f, gz: isGz(raw), bytes: raw.length, ...meta(raw, x.f) })
  if (!isGz(raw)) continue
  const plain = gunzipSync(raw)
  put(`P ${x.f}`, plain)
  put(`G ${x.f}`, raw)
  manifest.pairs.push({ from: 'cloud', plain: `P ${x.f}`, gz: `G ${x.f}`, bytes: plain.length, ...meta(raw, x.f) })
}

const missing = doc('DD Missing Blocks', 'Large', [...cube(2, (x, y, z) => blk('CubeBlock', 'LargeBlockArmorBlock', x, y, z)), ...cube(2, (x, y, z) => blk('CubeBlock', 'DrydockRegressionUnknown', x + 3, y, z))])
put('S Missing', missing)
put('SG Missing', gzipSync(missing))
manifest.pairs.push({ from: 'synthetic', plain: 'S Missing', gz: 'SG Missing', bytes: missing.length, name: 'DD Missing Blocks', large: true })
manifest.synthetic.missing = { plain: 'S Missing', gz: 'SG Missing', name: 'DD Missing Blocks', large: true, blocks: 16, dims: [5, 2, 2], unknown: [{ key: 'CubeBlock/DrydockRegressionUnknown', blocks: 8 }] }

const uniName = 'DD Ünïcødé Шип 船'
put('SG Unicode Late Grid', gzipSync(doc(uniName, 'Small', cube(3, (x, y, z) => blk('CubeBlock', 'SmallBlockArmorBlock', x, y, z)), `<!--${'pad '.repeat(5000)}-->`)))
manifest.synthetic.unicode = { folder: 'SG Unicode Late Grid', name: uniName, large: false, blocks: 27, dims: [3, 3, 3] }

const big = gzipSync(doc('DD Corrupt Gz', 'Large', cube(20, (x, y, z) => blk('CubeBlock', 'LargeBlockArmorBlock', x, y, z))))
put('SG Corrupt', big.subarray(0, big.length >> 1))
manifest.synthetic.corrupt = { folder: 'SG Corrupt', name: 'DD Corrupt Gz' }

put('SG Not A Blueprint', gzipSync('hello, this is not a blueprint'))
manifest.synthetic.notBlueprint = { folder: 'SG Not A Blueprint', name: 'SG Not A Blueprint' }

writeFileSync(join(OUT, 'misc', 'not-a-blueprint.txt'), 'plain text, not xml')
writeFileSync(join(OUT, 'misc', 'bad-composition.json'), '{"format":"drydock-composition","version":99,"name":"x","grid":"Large","shapes":[]}')
writeFileSync(join(OUT, 'misc', 'not-json.json'), 'this is not json')

const vanilla = new Set(JSON.parse(readFileSync(join(REPO, 'src/data/vanilla-blocks.json'), 'utf8')).blocks.map((b) => String(b[1]).toLowerCase()))
function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}
const dirSize = (d) => {
  let n = 0
  for (const p of walk(d)) n += statSync(p).size
  return n
}

let mod = null
if (WORKSHOP && existsSync(WORKSHOP)) {
  manifest.workshopBlueprints = list(WORKSHOP).length
  const cands = readdirSync(WORKSHOP)
    .map((f) => join(WORKSHOP, f))
    .filter((d) => existsSync(join(d, 'Data')))
    .map((d) => ({ d, size: dirSize(d) }))
    .filter((x) => x.size < 150e6)
    .sort((a, b) => a.size - b.size)
  for (const { d, size } of cands) {
    for (const p of walk(join(d, 'Data'))) {
      if (!p.toLowerCase().endsWith('.sbc')) continue
      const t = readFileSync(p, 'utf8')
      if (!t.includes('<CubeBlocks')) continue
      for (const m of t.matchAll(/<Definition\b[\s\S]*?<\/Definition>/g)) {
        const ty = /<TypeId>\s*([^<\s]+)\s*<\/TypeId>/.exec(m[0])
        const sub = /<SubtypeId>\s*([^<]+?)\s*<\/SubtypeId>/.exec(m[0])
        const cs = /<CubeSize>\s*(\w+)\s*<\/CubeSize>/.exec(m[0])
        if (!ty || !sub || !cs || vanilla.has(sub[1].toLowerCase())) continue
        mod = { dir: d, id: d.split(/[\\/]/).pop(), size, type: ty[1].replace(/^MyObjectBuilder_/, ''), sub: sub[1], large: cs[1] === 'Large' }
        break
      }
      if (mod) break
    }
    if (mod) break
  }
}
if (mod) {
  cpSync(mod.dir, join(OUT, 'mods', mod.id), { recursive: true })
  cpSync(mod.dir, join(OUT, 'torch', 'Instance', 'content', '244850', mod.id), { recursive: true })
  const armor = mod.large ? 'LargeBlockArmorBlock' : 'SmallBlockArmorBlock'
  const blocks = [0, 1, 2, 3].map((i) => blk(mod.type, mod.sub, i * 12, 0, 0)).concat([0, 1, 2, 3].map((i) => blk('CubeBlock', armor, i, 12, 0)))
  put('S Mod Block', doc('DD Mod Block', mod.large ? 'Large' : 'Small', blocks))
  manifest.mod = { ...mod, folder: 'S Mod Block', name: 'DD Mod Block', blocks: 8, key: `${mod.type}/${mod.sub}` }
}

manifest.dirs = { bp: bpRoot, empty: join(OUT, 'empty'), misc: join(OUT, 'misc'), mods: mod ? join(OUT, 'mods') : null, torch: mod ? join(OUT, 'torch') : null }
manifest.bpFolders = readdirSync(bpRoot).length
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ pairs: manifest.pairs.length, cloud: manifest.cloud.length, mod: manifest.mod && { id: manifest.mod.id, key: manifest.mod.key, size: manifest.mod.size }, bpFolders: manifest.bpFolders }, null, 1))
