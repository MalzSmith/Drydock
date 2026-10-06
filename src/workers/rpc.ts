export type Reply = { result: unknown; transfer?: Transferable[] }

export type Rpc = {
  call<T>(method: string, arg: unknown, transfer?: Transferable[]): Promise<T>
  on(event: string, cb: (data: any) => void): void
}

export type Emit = (event: string, data: unknown) => void

export function createRpc(worker: Worker): Rpc {
  let next = 1
  const listeners = new Map<string, Array<(d: any) => void>>()
  const pending = new Map<number, { ok: (v: never) => void; fail: (e: Error) => void }>()
  worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string; event?: string; data?: unknown }>) => {
    if (e.data.event !== undefined) {
      for (const cb of listeners.get(e.data.event) ?? []) cb(e.data.data)
      return
    }
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.error !== undefined) p.fail(new Error(e.data.error))
    else p.ok(e.data.result as never)
  }
  return {
    on(event, cb) {
      const l = listeners.get(event)
      if (l) l.push(cb)
      else listeners.set(event, [cb])
    },
    call(method, arg, transfer = []) {
      const id = next++
      return new Promise((ok, fail) => {
        pending.set(id, { ok: ok as (v: never) => void, fail })
        worker.postMessage({ id, method, arg }, transfer)
      })
    },
  }
}

export function serve(handlers: Record<string, (arg: any, emit: Emit) => Reply | Promise<Reply>>) {
  self.onmessage = async (e: MessageEvent<{ id: number; method: string; arg: unknown }>) => {
    const { id, method, arg } = e.data
    try {
      const emit: Emit = (event, data) => (self as unknown as Worker).postMessage({ event, data })
      const r = await handlers[method](arg, emit)
      ;(self as unknown as Worker).postMessage({ id, result: r.result }, r.transfer ?? [])
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }
}
