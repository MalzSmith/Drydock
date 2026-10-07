export type Store = 'sources' | 'mods' | 'bpmeta' | 'snap' | 'bps' | 'meshes' | 'textures' | 'skies' | 'skymeta'

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open('drydock', 4)
    r.onupgradeneeded = (e) => {
      const db = r.result
      if (e.oldVersion < 2) {
        if (db.objectStoreNames.contains('sources')) db.deleteObjectStore('sources')
        db.createObjectStore('sources', { keyPath: 'id' })
      }
      for (const n of ['mods', 'bpmeta', 'snap', 'bps', 'meshes', 'textures', 'skies', 'skymeta']) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n)
    }
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
  return dbp
}

function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((ok, fail) => {
        const r = fn(db.transaction(store, mode).objectStore(store))
        r.onsuccess = () => ok(r.result)
        r.onerror = () => fail(r.error)
      }),
  )
}

export const idbGet = <T>(store: Store, key: IDBValidKey) => run<T | undefined>(store, 'readonly', (s) => s.get(key))
export const idbPut = (store: Store, key: IDBValidKey | undefined, value: unknown) =>
  run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)))
export const idbDelete = (store: Store, key: IDBValidKey) => run(store, 'readwrite', (s) => s.delete(key))
export const idbAll = <T>(store: Store) => run<T[]>(store, 'readonly', (s) => s.getAll())
export const idbClear = (store: Store) => run(store, 'readwrite', (s) => s.clear())
export const idbKeys = (store: Store) => run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())
