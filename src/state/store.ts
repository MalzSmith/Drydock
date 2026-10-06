export type Store<S> = {
  get(): S
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void
  watch<T>(sel: (s: S) => T, cb: (v: T, prev: T) => void, eq?: (a: T, b: T) => boolean): () => void
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial
  const watchers = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...p }
      for (const w of [...watchers]) w()
    },
    watch(sel, cb, eq = Object.is) {
      let last = sel(state)
      const w = () => {
        const v = sel(state)
        if (eq(v, last)) return
        const prev = last
        last = v
        cb(v, prev)
      }
      watchers.add(w)
      cb(last, last)
      return () => watchers.delete(w)
    },
  }
}
