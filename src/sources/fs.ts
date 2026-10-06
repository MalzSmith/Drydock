export type FsFile = { kind: 'file'; name: string; getFile(): Promise<File> }
export type FsEntry = FsFile | FsDir
export type FsDir = {
  kind: 'directory'
  name: string
  entries(): AsyncIterable<[string, FsEntry]>
  getDirectoryHandle(name: string): Promise<FsDir>
  getFileHandle(name: string): Promise<FsFile>
}

type Node = { name: string; dirs: Map<string, Node>; files: Map<string, File> }

function nodeDir(n: Node): FsDir {
  return {
    kind: 'directory',
    name: n.name,
    async *entries() {
      for (const [k, d] of n.dirs) yield [k, nodeDir(d)] as [string, FsEntry]
      for (const [k, f] of n.files) yield [k, fileOf(f)] as [string, FsEntry]
    },
    async getDirectoryHandle(name) {
      const d = n.dirs.get(name)
      if (!d) throw new Error('NotFound')
      return nodeDir(d)
    },
    async getFileHandle(name) {
      const f = n.files.get(name)
      if (!f) throw new Error('NotFound')
      return fileOf(f)
    },
  }
}

const fileOf = (f: File): FsFile => ({ kind: 'file', name: f.name, getFile: async () => f })

export function treeFromFiles(files: File[]): FsDir {
  const root: Node = { name: '', dirs: new Map(), files: new Map() }
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split('/')
    if (!root.name) root.name = parts.length > 1 ? parts[0] : ''
    let cur = root
    for (let i = parts.length > 1 ? 1 : 0; i < parts.length - 1; i++) {
      let d = cur.dirs.get(parts[i])
      if (!d) cur.dirs.set(parts[i], (d = { name: parts[i], dirs: new Map(), files: new Map() }))
      cur = d
    }
    cur.files.set(parts[parts.length - 1], f)
  }
  return nodeDir(root)
}

export const isRelevantFile = (name: string) => {
  const n = name.toLowerCase()
  return n.endsWith('.sbc') || n.endsWith('.resx') || n === 'modinfo.sbmi'
}

export const SKIP_DIRS = new Set(['prefabs', 'scenarios', 'planetdatafiles', 'localization', 'blueprints', 'customworlds'])

export async function tryDir(d: FsDir, name: string): Promise<FsDir | null> {
  try {
    return await d.getDirectoryHandle(name)
  } catch {
    return null
  }
}

export async function tryFile(d: FsDir, name: string): Promise<FsFile | null> {
  try {
    return await d.getFileHandle(name)
  } catch {
    return null
  }
}

export async function childDirs(d: FsDir): Promise<FsDir[]> {
  const out: FsDir[] = []
  for await (const [name, h] of d.entries()) if (h.kind === 'directory' && !name.startsWith('.')) out.push(h)
  return out
}

export async function findDirCI(d: FsDir, name: string): Promise<FsDir | null> {
  const direct = await tryDir(d, name)
  if (direct) return direct
  const low = name.toLowerCase()
  for await (const [n, h] of d.entries()) if (h.kind === 'directory' && n.toLowerCase() === low) return h
  return null
}

export async function findPath(d: FsDir, ...parts: string[]): Promise<FsDir | null> {
  let cur: FsDir | null = d
  for (const p of parts) {
    cur = cur ? await findDirCI(cur, p) : null
    if (!cur) return null
  }
  return cur
}

export async function* sbcFiles(dir: FsDir, prefix = ''): AsyncGenerator<[string, FsFile]> {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') {
      if (!SKIP_DIRS.has(name.toLowerCase())) yield* sbcFiles(h, prefix + name + '/')
    } else if (name.toLowerCase().endsWith('.sbc')) yield [prefix + name, h]
  }
}

export async function findGameData(root: FsDir): Promise<FsDir | null> {
  const content = await findDirCI(root, 'Content')
  if (content) {
    const data = await findDirCI(content, 'Data')
    if (data) return data
  }
  if (root.name.toLowerCase() === 'content') return findDirCI(root, 'Data')
  return null
}

export async function findWorkshopRoot(root: FsDir, kind: 'workshop' | 'torch'): Promise<FsDir | null> {
  if (root.name === '244850') return root
  const paths = kind === 'torch' ? [['content', '244850'], ['Instance', 'content', '244850']] : [['244850'], ['content', '244850']]
  for (const p of paths) {
    const d = await findPath(root, ...p)
    if (d) return d
  }
  return kind === 'workshop' ? root : null
}

export async function findBlueprintsRoot(root: FsDir): Promise<FsDir> {
  return (await findDirCI(root, 'local')) ?? root
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return out
}
