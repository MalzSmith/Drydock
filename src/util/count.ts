const KEY = 'drydock.count'
const HOST = 'malzsmith.github.io'

let loaded = false

export function countEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function setCountEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, '0')
  } catch {}
}

export function loadCounter() {
  if (loaded || !countEnabled() || location.hostname !== HOST) return
  loaded = true
  Object.assign(window, { goatcounter: { path: () => location.pathname } })
  const s = document.createElement('script')
  s.async = true
  s.dataset.goatcounter = 'https://drydock.goatcounter.com/count'
  s.src = 'https://gc.zgo.at/count.js'
  document.body.append(s)
}
