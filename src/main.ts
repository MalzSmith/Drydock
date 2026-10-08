import '@fontsource/barlow/400.css'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/700.css'
import '@fontsource/barlow-condensed/400.css'
import '@fontsource/barlow-condensed/600.css'
import { bootLocale } from './i18n.ts'

const root = document.documentElement
const start = () => {
  void bootLocale()
  void import('./app.ts')
}

if (root.classList.contains('narrow')) {
  document.getElementById('narrow-continue')!.addEventListener('click', () => {
    try {
      localStorage.setItem('drydock.narrowOk', '1')
    } catch {}
    root.classList.remove('narrow')
    start()
  })
} else start()
