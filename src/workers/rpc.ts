export type Reply = { result: unknown; transfer?: Transferable[] }

export type Rpc = {
  call<T>(method: string, arg: unknown, transfer?: Transferable[]): Promise<T>
  on(event: string, cb: (data: any) => void): void
}

export type Emit = (event: string, data: unknown) => void

export type Handlers = Record<string, (arg: any) => unknown>

type Msg = { id: number; result?: unknown; error?: string; event?: string; data?: unknown; req?: string; rid?: number; arg?: unknown }

export function createRpc(worker: Worker, handlers: Handlers = {}): Rpc {
  let next = 1
  const listeners = new Map<string, Array<(d: any) => void>>()
  const pending = new Map<number, { ok: (v: never) => void; fail: (e: Error) => void }>()
  worker.onmessage = (e: MessageEvent<Msg>) => {
    const d = e.data
    if (d.event !== undefined) {
      for (const cb of listeners.get(d.event) ?? []) cb(d.data)
      return
    }
    if (d.req !== undefined) {
      const req = d.req
      void Promise.resolve()
        .then(() => handlers[req](d.arg))
        .then(
          (result) => worker.postMessage({ rid: d.rid, result }),
          (err) => worker.postMessage({ rid: d.rid, error: err instanceof Error ? err.message : String(err) }),
        )
      return
    }
    const p = pending.get(d.id)
    if (!p) return
    pending.delete(d.id)
    if (d.error !== undefined) p.fail(new Error(d.error))
    else p.ok(d.result as never)
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

let nextReq = 1
const requests = new Map<number, { ok: (v: never) => void; fail: (e: Error) => void }>()

export function request<T>(method: string, arg: unknown): Promise<T> {
  const rid = nextReq++
  return new Promise((ok, fail) => {
    requests.set(rid, { ok: ok as (v: never) => void, fail })
    ;(self as unknown as Worker).postMessage({ req: method, rid, arg })
  })
}

export function serve(handlers: Record<string, (arg: any, emit: Emit) => Reply | Promise<Reply>>) {
  self.onmessage = async (e: MessageEvent<Msg & { method: string }>) => {
    if (e.data.rid !== undefined) {
      const r = requests.get(e.data.rid)
      if (!r) return
      requests.delete(e.data.rid)
      if (e.data.error !== undefined) r.fail(new Error(e.data.error))
      else r.ok(e.data.result as never)
      return
    }
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
