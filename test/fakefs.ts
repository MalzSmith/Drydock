import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FsDir, FsEntry, FsFile } from '../src/sources/fs.ts'

export function fileHandle(path: string): FsFile {
  return {
    kind: 'file',
    name: path.split(/[\\/]/).pop()!,
    async getFile() {
      const st = statSync(path)
      return new File([readFileSync(path)], this.name, { lastModified: st.mtimeMs })
    },
  }
}

export function dirHandle(path: string): FsDir {
  const entry = (name: string): FsEntry => (statSync(join(path, name)).isDirectory() ? dirHandle(join(path, name)) : fileHandle(join(path, name)))
  return {
    kind: 'directory',
    name: path.split(/[\\/]/).pop()!,
    async *entries() {
      for (const n of readdirSync(path)) yield [n, entry(n)] as [string, FsEntry]
    },
    async getDirectoryHandle(name) {
      const e = readdirSync(path).includes(name) ? entry(name) : null
      if (!e || e.kind !== 'directory') throw new Error('NotFound')
      return e
    },
    async getFileHandle(name) {
      const e = readdirSync(path).includes(name) ? entry(name) : null
      if (!e || e.kind !== 'file') throw new Error('NotFound')
      return e
    },
  }
}

export function tmpTree(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), 'drydock-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}
