import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { parseDefinitions, parseResx } from '../src/se/defs.ts'

const root = process.env.SE_GAME_ROOT ?? 'C:/Program Files (x86)/Steam/steamapps/common/SpaceEngineers'
const data = join(root, 'Content', 'Data')
const skip = new Set(['prefabs', 'scenarios', 'planetdatafiles', 'localization', 'blueprints', 'customworlds'])

function* sbcFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!skip.has(e.name.toLowerCase())) yield* sbcFiles(join(dir, e.name))
    } else if (e.name.toLowerCase().endsWith('.sbc')) yield join(dir, e.name)
  }
}

const names = parseResx(readFileSync(join(data, 'Localization', 'MyTexts.resx'), 'utf8'))

const seen = new Map()
for (const f of sbcFiles(data)) {
  const text = readFileSync(f, 'utf8')
  for (const d of parseDefinitions(text, 'vanilla', names)) seen.set(`${d.type}/${d.subtype}`.toLowerCase(), d)
}

const blocks = [...seen.values()].map((d) => [d.type, d.subtype, d.large ? 1 : 0, ...d.size, d.name])
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'vanilla-blocks.json')
mkdirSync(dirname(out), { recursive: true })
const json = JSON.stringify({ v: 1, blocks })
writeFileSync(out, json)
console.log(`${blocks.length} blocks, ${json.length} bytes raw, ${gzipSync(json).length} bytes gzip`)
