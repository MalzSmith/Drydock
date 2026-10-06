export type XEl = { name: string; attrs: Record<string, string>; children: XEl[]; text: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(s: string): string {
  return s.indexOf('&') < 0 ? s : s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENT[n])
}

function local(n: string): string {
  const i = n.indexOf(':')
  return i < 0 ? n : n.slice(i + 1)
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export function parseXml(text: string): XEl {
  const root: XEl = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XEl[] = [root]
  const n = text.length
  let i = 0
  while (i < n) {
    const lt = text.indexOf('<', i)
    if (lt < 0) break
    const top = stack[stack.length - 1]
    if (lt > i && !top.text) {
      const t = text.slice(i, lt).trim()
      if (t) top.text = decode(t)
    }
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt + 4)
      i = e < 0 ? n : e + 3
    } else if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt + 9)
      if (!top.text) top.text = text.slice(lt + 9, e < 0 ? n : e)
      i = e < 0 ? n : e + 3
    } else if (text.charCodeAt(lt + 1) === 63 || text.charCodeAt(lt + 1) === 33) {
      const e = text.indexOf('>', lt)
      i = e < 0 ? n : e + 1
    } else if (text.charCodeAt(lt + 1) === 47) {
      const e = text.indexOf('>', lt)
      if (stack.length > 1) stack.pop()
      i = e < 0 ? n : e + 1
    } else {
      const e = text.indexOf('>', lt)
      if (e < 0) break
      const selfClose = text.charCodeAt(e - 1) === 47
      const inner = text.slice(lt + 1, selfClose ? e - 1 : e)
      let sp = 0
      while (sp < inner.length && inner.charCodeAt(sp) > 32) sp++
      const el: XEl = { name: local(inner.slice(0, sp)), attrs: {}, children: [], text: '' }
      if (sp < inner.length) {
        ATTR.lastIndex = 0
        const rest = inner.slice(sp)
        let m: RegExpExecArray | null
        while ((m = ATTR.exec(rest))) el.attrs[local(m[1])] = decode(m[2] ?? m[3])
      }
      top.children.push(el)
      if (!selfClose) stack.push(el)
      i = e + 1
    }
  }
  return root
}

export function child(el: XEl, name: string): XEl | undefined {
  for (const c of el.children) if (c.name === name) return c
  return undefined
}

export function descendants(el: XEl, name: string, out: XEl[] = []): XEl[] {
  for (const c of el.children) {
    if (c.name === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}
