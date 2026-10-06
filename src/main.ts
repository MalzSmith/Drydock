const root = document.documentElement
const start = () => void import('./app.ts')

if (root.classList.contains('narrow')) {
  document.getElementById('narrow-continue')!.addEventListener('click', () => {
    try {
      localStorage.setItem('drydock.narrowOk', '1')
    } catch {}
    root.classList.remove('narrow')
    start()
  })
} else start()
