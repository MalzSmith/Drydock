import { createRpc, type Rpc } from './rpc.ts'

let parse: Rpc | null = null
let scan: Rpc | null = null
let compose: Rpc | null = null
let assets: Rpc | null = null

const spawn = () => createRpc(new Worker(new URL('./work.worker.ts', import.meta.url), { type: 'module' }))

export function parseRpc(): Rpc {
  parse ??= spawn()
  return parse
}

export function scanRpc(): Rpc {
  scan ??= spawn()
  return scan
}

export function composeRpc(): Rpc {
  compose ??= spawn()
  return compose
}

export function assetRpc(): Rpc {
  assets ??= spawn()
  return assets
}
