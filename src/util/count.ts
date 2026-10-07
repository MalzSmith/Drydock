const KEY = 'drydock.count'
const HOST = 'malzsmith.github.io'

let loaded = false

function privacySignal(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean }
  return n.globalPrivacyControl === true || n.doNotTrack === '1'
}

export function countEnabled(): boolean {
  let v: string | null = null
  try {
    v = localStorage.getItem(KEY)
  } catch {}
  return v === null ? !privacySignal() : v === '1'
}

export function setCountEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {}
}

export function loadCounter() {
  if (loaded || !countEnabled() || location.hostname !== HOST) return
  loaded = true
  Object.assign(window, { goatcounter: { path: () => location.pathname } })
  const s = document.createElement('script')
  s.async = true
  s.dataset.goatcounter = 'https://drydock.goatcounter.com/count'
  s.src = 'count.js'
  document.body.append(s)
}
