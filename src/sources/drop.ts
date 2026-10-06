type FsHandle = { kind: 'file' | 'directory'; name: string }
type FileHandle = FsHandle & { getFile(): Promise<File> }
type DirHandle = FsHandle & { getFileHandle(name: string): Promise<FileHandle> }
type Entry = {
  isDirectory: boolean
  isFile: boolean
  name: string
  file?(cb: (f: File) => void, err: (e: unknown) => void): void
  getFile?(path: string, o: object, cb: (e: Entry) => void, err: (e: unknown) => void): void
}
type Item = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FsHandle | null>; webkitGetAsEntry?: () => Entry | null }

export type Dropped = { file: File; name: string }

function entryFile(e: Entry): Promise<File> {
  return new Promise((ok, fail) => e.file!(ok, fail))
}

function dirBp(e: Entry): Promise<File> {
  return new Promise((ok, fail) => e.getFile!('bp.sbc', {}, (f) => entryFile(f).then(ok, fail), fail))
}

async function resolveItem(item: Item, handle: Promise<FsHandle | null> | null): Promise<Dropped | null> {
  const entry = item.webkitGetAsEntry?.() ?? null
  const file = item.getAsFile()
  const hnd = handle ? await handle : null
  if (hnd?.kind === 'directory') {
    const f = await (await (hnd as DirHandle).getFileHandle('bp.sbc')).getFile()
    return { file: f, name: hnd.name }
  }
  if (hnd?.kind === 'file') return { file: await (hnd as FileHandle).getFile(), name: hnd.name.replace(/\.[^.]+$/, '') }
  if (entry?.isDirectory) return { file: await dirBp(entry), name: entry.name }
  if (file) return { file, name: file.name.replace(/\.[^.]+$/, '') }
  return null
}

export function installDrop(onOpen: (d: Dropped) => void, onError: (e: unknown) => void) {
  const body = document.body
  let depth = 0
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    depth++
    body.classList.add('dropping')
  })
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1)
    if (!depth) body.classList.remove('dropping')
  })
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })
  window.addEventListener('drop', (e) => {
    e.preventDefault()
    depth = 0
    body.classList.remove('dropping')
    const items = [...(e.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file') as Item[]
    if (!items.length) return
    const item = items[0]
    const handle = item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null
    resolveItem(item, handle).then((d) => d && onOpen(d), onError)
  })
}
