import { base6Index, createWorld } from './orient.ts'

export type ParsedGrid = {
  large: boolean
  world: Float32Array
  key: Uint32Array
  min: Int32Array
  orient: Uint8Array
  hsv: Float32Array
  skin?: Uint16Array
  pilot?: Int32Array
}

export type ParsedBlueprint = {
  name: string
  strings: string[]
  skins?: string[]
  grids: ParsedGrid[]
}

export const PARSE_VERSION = 3

export const PILOT_MAIN = 0
export const PILOT_NAMED = 1
export const PILOT_SEAT = 2
export const PILOT_REMOTE = 3

const NOT_SEAT = ['passenger', 'bed', 'toilet', 'couch', 'bathroom', 'desk']

export function notePilot(pilot: Int32Array, i: number, type: string, sub: string, main: boolean) {
  if (type !== 'Cockpit' && type !== 'RemoteControl') return
  if (main && pilot[PILOT_MAIN] < 0) pilot[PILOT_MAIN] = i
  if (type === 'RemoteControl') {
    if (pilot[PILOT_REMOTE] < 0) pilot[PILOT_REMOTE] = i
    return
  }
  const low = sub.toLowerCase()
  if (pilot[PILOT_NAMED] < 0 && low.includes('cockpit')) pilot[PILOT_NAMED] = i
  if (pilot[PILOT_SEAT] < 0 && !NOT_SEAT.some((w) => low.includes(w))) pilot[PILOT_SEAT] = i
}

const BLOCK = '<MyObjectBuilder_CubeBlock'
const BLOCK_END = '</MyObjectBuilder_CubeBlock>'
const PREFIX = 'MyObjectBuilder_'

function skipWs(t: string, p: number): number {
  while (p < t.length) {
    const c = t.charCodeAt(p)
    if (c === 32 || c === 10 || c === 13 || c === 9 || c === 0xfeff) p++
    else break
  }
  return p
}

function find(t: string, tag: string, from: number, to: number): number {
  const i = t.indexOf(tag, from)
  return i < 0 || i >= to ? -1 : i
}

function attr(t: string, name: string, from: number, to: number): string | undefined {
  const i = find(t, ' ' + name + '="', from, to)
  if (i < 0) return undefined
  const s = i + name.length + 3
  const e = t.indexOf('"', s)
  return e < 0 || e > to ? undefined : t.slice(s, e)
}

function elementText(t: string, name: string, from: number, to: number): string | undefined {
  const i = find(t, '<' + name + '>', from, to)
  if (i < 0) return undefined
  const s = i + name.length + 2
  const e = t.indexOf('<', s)
  return e < 0 ? undefined : t.slice(s, e)
}

function readVec(t: string, tagAt: number, to: number, out: number[]) {
  const gt = t.indexOf('>', tagAt)
  if (gt < 0 || gt > to) return
  const x = attr(t, 'x', tagAt, gt)
  if (x !== undefined) {
    out[0] = parseFloat(x) || 0
    out[1] = parseFloat(attr(t, 'y', tagAt, gt) ?? '0') || 0
    out[2] = parseFloat(attr(t, 'z', tagAt, gt) ?? '0') || 0
    return
  }
  if (t.charCodeAt(gt - 1) === 47) return
  let ne = tagAt + 1
  while (ne < gt && t.charCodeAt(ne) > 32) ne++
  const close = t.indexOf('</' + t.slice(tagAt + 1, ne) + '>', gt)
  const end = close < 0 ? to : Math.min(close, to)
  for (let k = 0; k < 3; k++) {
    const v = elementText(t, 'XYZ'[k], gt, end)
    if (v !== undefined) out[k] = parseFloat(v) || 0
  }
}

function isTagEnd(c: number): boolean {
  return c === 32 || c === 62 || c === 47 || c === 10 || c === 13 || c === 9
}

function findTag(t: string, tag: string, from: number, to: number): number {
  let i = find(t, '<' + tag, from, to)
  while (i >= 0 && !isTagEnd(t.charCodeAt(i + tag.length + 1))) i = find(t, '<' + tag, i + 1, to)
  return i
}

function vecTag(t: string, tag: string, from: number, to: number, def: number[]): number[] {
  const out = def.slice()
  const i = findTag(t, tag, from, to)
  if (i >= 0) readVec(t, i, to, out)
  return out
}

class Grow {
  n = 0
  key = new Uint32Array(1024)
  min = new Int32Array(3072)
  orient = new Uint8Array(1024)
  hsv = new Float32Array(3072)
  skin = new Uint16Array(1024)
  push(key: number, mx: number, my: number, mz: number, orient: number, h: number, s: number, v: number, skin: number) {
    if (this.n === this.key.length) {
      const cap = this.n * 2
      const nk = new Uint32Array(cap)
      nk.set(this.key)
      this.key = nk
      const nm = new Int32Array(cap * 3)
      nm.set(this.min)
      this.min = nm
      const no = new Uint8Array(cap)
      no.set(this.orient)
      this.orient = no
      const nh = new Float32Array(cap * 3)
      nh.set(this.hsv)
      this.hsv = nh
      const ns = new Uint16Array(cap)
      ns.set(this.skin)
      this.skin = ns
    }
    const i = this.n++
    this.key[i] = key
    this.min[i * 3] = mx
    this.min[i * 3 + 1] = my
    this.min[i * 3 + 2] = mz
    this.orient[i] = orient
    this.hsv[i * 3] = h
    this.hsv[i * 3 + 1] = s
    this.hsv[i * 3 + 2] = v
    this.skin[i] = skin
  }
}

function blockEnd(text: string, gt: number): number {
  let depth = 1
  let q = gt
  for (;;) {
    const ne = text.indexOf(BLOCK_END, q)
    if (ne < 0) return text.length
    const ns = text.indexOf(BLOCK, q)
    if (ns >= 0 && ns < ne) {
      depth++
      q = ns + 1
    } else {
      depth--
      q = ne + 1
      if (depth === 0) return ne
    }
  }
}

export function parseBlueprint(text: string, fallbackName = ''): ParsedBlueprint {
  const strings: string[] = []
  const stringIds = new Map<string, number>()
  const intern = (k: string) => {
    let id = stringIds.get(k)
    if (id === undefined) {
      id = strings.length
      strings.push(k)
      stringIds.set(k, id)
    }
    return id
  }

  const skins: string[] = []
  const skinIds = new Map<string, number>()
  const skinOf = (k: string) => {
    let id = skinIds.get(k)
    if (id === undefined) {
      skins.push(k)
      id = skins.length
      skinIds.set(k, id)
    }
    return id
  }

  let name = fallbackName
  const idAt = text.indexOf('<Id ')
  if (idAt >= 0) name = attr(text, 'Subtype', idAt, text.indexOf('>', idAt)) || name

  const starts: number[] = []
  for (let p = text.indexOf('<CubeGrid'); p >= 0; p = text.indexOf('<CubeGrid', p + 9)) {
    const c = text.charCodeAt(p + 9)
    if (c === 62 || c === 32 || c === 10 || c === 13 || c === 9) starts.push(p)
  }

  const grids: ParsedGrid[] = []
  for (let gi = 0; gi < starts.length; gi++) {
    const gs = starts[gi]
    const ge = gi + 1 < starts.length ? starts[gi + 1] : text.length

    let blocksAt = -1
    let p = gs
    for (;;) {
      const i = find(text, '<CubeBlocks', p, ge)
      if (i < 0) break
      const gt = text.indexOf('>', i)
      p = gt + 1
      if (text.charCodeAt(gt - 1) === 47) continue
      const q = skipWs(text, p)
      if (text.startsWith(BLOCK, q)) {
        blocksAt = q
        break
      }
    }
    if (blocksAt < 0) continue

    const g = new Grow()
    const pilot = new Int32Array(4).fill(-1)
    let pos = blocksAt
    for (;;) {
      pos = skipWs(text, pos)
      if (!text.startsWith(BLOCK, pos)) break
      const gt0 = text.indexOf('>', pos)
      let end: number
      let next: number
      if (text.charCodeAt(gt0 - 1) === 47) {
        end = gt0
        next = gt0 + 1
      } else {
        end = blockEnd(text, gt0)
        next = end + BLOCK_END.length
      }
      const b = text.slice(pos, end)
      const gt = gt0 - pos
      const to = b.length

      let type = 'CubeBlock'
      const tAt = b.indexOf('xsi:type="')
      if (tAt >= 0 && tAt < gt) {
        const s = tAt + 10
        const e = b.indexOf('"', s)
        type = b.slice(b.startsWith(PREFIX, s) ? s + PREFIX.length : s, e)
      }
      const sub = elementText(b, 'SubtypeName', gt, to) ?? elementText(b, 'SubtypeId', gt, to) ?? ''
      const m = [0, 0, 0]
      const mi = findTag(b, 'Min', gt, to)
      if (mi >= 0) readVec(b, mi, to, m)
      let f = 0
      let u = 4
      const oi = findTag(b, 'BlockOrientation', gt, to)
      if (oi >= 0) {
        const ogt = b.indexOf('>', oi)
        let fs = attr(b, 'Forward', oi, ogt)
        let us = attr(b, 'Up', oi, ogt)
        if (fs === undefined && b.charCodeAt(ogt - 1) !== 47) {
          const oe = b.indexOf('</BlockOrientation>', ogt)
          fs = elementText(b, 'Forward', ogt, oe)
          us = elementText(b, 'Up', ogt, oe)
        }
        const fi = base6Index(fs)
        const ui = base6Index(us)
        if (fi >= 0) f = fi
        if (ui >= 0) u = ui
      }
      const hsv = [0, -0.8, 0]
      const ci = findTag(b, 'ColorMaskHSV', gt, to)
      if (ci >= 0) readVec(b, ci, to, hsv)
      const n = g.n
      if (type === 'Cockpit' || type === 'RemoteControl') notePilot(pilot, n, type, sub, elementText(b, 'IsMainCockpit', gt, to)?.trim() === 'true')
      const sk = elementText(b, 'SkinSubtypeId', gt, to)?.trim()
      g.push(intern(type + '/' + sub), m[0] | 0, m[1] | 0, m[2] | 0, f * 6 + u, hsv[0], hsv[1], hsv[2], sk ? skinOf(sk) : 0)
      pos = next
    }

    const lo = blocksAt
    const hi = pos
    const sizeStr = elementText(text, 'GridSizeEnum', gs, lo) ?? elementText(text, 'GridSizeEnum', hi, ge)
    let poAt = find(text, '<PositionAndOrientation>', gs, lo)
    let poTo = lo
    if (poAt < 0) {
      poAt = find(text, '<PositionAndOrientation>', hi, ge)
      poTo = ge
    }
    let world: Float32Array
    if (poAt >= 0) {
      const poEnd = text.indexOf('</PositionAndOrientation>', poAt)
      const to = poEnd < 0 ? poTo : Math.min(poEnd, poTo)
      world = createWorld(vecTag(text, 'Position', poAt + 1, to, [0, 0, 0]), vecTag(text, 'Forward', poAt + 1, to, [0, 0, -1]), vecTag(text, 'Up', poAt + 1, to, [0, 1, 0]))
    } else {
      world = createWorld([0, 0, 0], [0, 0, -1], [0, 1, 0])
    }

    grids.push({
      large: (sizeStr ?? 'Large').trim() !== 'Small',
      world,
      key: g.key.slice(0, g.n),
      min: g.min.slice(0, g.n * 3),
      orient: g.orient.slice(0, g.n),
      hsv: g.hsv.slice(0, g.n * 3),
      skin: g.skin.slice(0, g.n),
      pilot,
    })
  }

  const weight = (g: ParsedGrid) => g.key.length * (g.large ? 125 : 1)
  grids.sort((a, b) => weight(b) - weight(a))
  return { name, strings, skins, grids }
}

export function decodeBlueprint(buf: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(buf)
}
