const sources = new Map<number, Map<string, File>>()

export function setAssetFiles(sourceId: number, files: Map<string, File>) {
  sources.delete(sourceId)
  sources.set(sourceId, files)
}

export function dropAssetFiles(sourceId: number) {
  sources.delete(sourceId)
}

export function assetFile(key: string): File | undefined {
  let f: File | undefined
  for (const m of sources.values()) f = m.get(key) ?? f
  return f
}
