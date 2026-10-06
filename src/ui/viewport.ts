import { wrapAngle, type Rect, type View } from '../render/camera.ts'
import { createRenderer, type FrameInfo } from '../render/renderer.ts'
import { actions, perf, store } from '../state/app.ts'
import { captionText, titleText } from '../state/derive.ts'
import { h, icon, seg, text } from './dom.ts'

const DARK_BG = new Set(['sky-default', 'sky-orbit', 'sky-nebula', 'steel'])
const PRESET_OPTS: Array<[string, string]> = [['iso', 'Iso'], ['front', 'Front'], ['side', 'Side'], ['top', 'Top'], ['rear', 'Rear']]

function drawOverlay(ctx: CanvasRenderingContext2D, dpr: number, f: FrameInfo) {
  const { W, H, frame: fr, view } = f
  const s = store.get()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const dark = DARK_BG.has(s.scene.bg) || s.scene.bg.startsWith('sky:')
  if (s.tab === 'export') {
    ctx.fillStyle = 'rgba(29,31,32,.38)'
    ctx.fillRect(0, 0, W, fr.y)
    ctx.fillRect(0, fr.y + fr.h, W, H)
    ctx.fillRect(0, fr.y, fr.x, fr.h)
    ctx.fillRect(fr.x + fr.w, fr.y, W, fr.h)
  }
  ctx.strokeStyle = dark ? 'rgba(242,242,243,.6)' : 'rgba(29,31,32,.45)'
  ctx.lineWidth = 1
  for (const [x, y] of corners(fr)) {
    ctx.beginPath()
    ctx.moveTo(x - 7, y + 0.5)
    ctx.lineTo(x + 7, y + 0.5)
    ctx.moveTo(x + 0.5, y - 7)
    ctx.lineTo(x + 0.5, y + 7)
    ctx.stroke()
  }
  if (s.tab === 'export') {
    ctx.strokeStyle = dark ? 'rgba(242,242,243,.35)' : 'rgba(29,31,32,.25)'
    ctx.strokeRect(fr.x + 0.5, fr.y + 0.5, fr.w, fr.h)
  }
  drawGizmo(ctx, H, view)
}

function corners(fr: Rect): Array<[number, number]> {
  return [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x, fr.y + fr.h], [fr.x + fr.w, fr.y + fr.h]]
}

function drawGizmo(ctx: CanvasRenderingContext2D, H: number, v: View) {
  const gx = 40
  const gy = H - 44
  const c = Math.cos(v.yaw)
  const s = Math.sin(v.yaw)
  const cp = Math.cos(v.pitch)
  const sp = Math.sin(v.pitch)
  ctx.fillStyle = 'rgba(242,242,243,.92)'
  ctx.beginPath()
  ctx.arc(gx, gy, 30, 0, 7)
  ctx.fill()
  ctx.strokeStyle = 'rgba(29,31,32,.16)'
  ctx.stroke()
  const axes = (
    [['X', [1, 0, 0], '#416180'], ['Y', [0, 1, 0], '#1d1f20'], ['Z', [0, 0, 1], '#94bce3']] as Array<[string, number[], string]>
  )
    .map(([l, p, col]) => {
      const x1 = p[0] * c + p[2] * s
      const z1 = -p[0] * s + p[2] * c
      return [l, x1, p[1] * cp - z1 * sp, p[1] * sp + z1 * cp, col] as [string, number, number, number, string]
    })
    .sort((a, b) => a[3] - b[3])
  ctx.font = '600 11px "Barlow Condensed", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const [l, x, y, , col] of axes) {
    ctx.strokeStyle = col
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(gx, gy)
    ctx.lineTo(gx + x * 19, gy - y * 19)
    ctx.stroke()
    ctx.fillStyle = col
    ctx.fillText(l, gx + x * 25, gy - y * 25)
  }
}

export function mountViewport(root: HTMLElement) {
  const gl = h('canvas', { class: 'gl' })
  const ov = h('canvas', { class: 'ov' })
  const ovCtx = ov.getContext('2d')!
  let ratio = 1
  const readout = text('—')
  const name = h('span', { class: 'nm' })
  const dims = h('span', { class: 'dm' })
  const toast = h('div', { class: 'toast', hidden: true })
  const toastText = h('span')
  toast.append(icon('check', 14, 'var(--color-accent)'), toastText)

  const renderer = createRenderer(gl, {
    onFrame(f) {
      drawOverlay(ovCtx, ratio, f)
      const dg = (r: number) => (((Math.round((r * 180) / Math.PI) % 360) + 360) % 360)
      readout.set(`YAW ${String(dg(f.view.yaw)).padStart(3, '0')}° · PITCH ${Math.round((wrapAngle(f.view.pitch) * 180) / Math.PI)}° · ${f.view.zoom.toFixed(2)}×`)
    },
    onAssets: (c) => actions.setAssets(c),
    onFirstFrame() {
      if (perf.last) {
        perf.last.firstFrame = performance.now() - perf.t0 - perf.last.read - perf.last.decode - perf.last.parse - perf.last.resolve
        perf.last.total = performance.now() - perf.t0
      }
    },
  })

  const presets = seg<string>({
    options: PRESET_OPTS,
    value: 'iso',
    onChange: (id) => {
      actions.setPreset(id)
      renderer.goPreset(id)
    },
  })
  const proj = seg<'persp' | 'ortho'>({
    options: [['persp', 'Persp'], ['ortho', 'Ortho']],
    titles: [
      'Perspective: nearer parts look bigger, like a real camera',
      'Orthographic: no perspective, sizes stay true at any depth (technical views)',
    ],
    value: 'ortho',
    onChange: (v) => actions.setRender({ proj: v }),
  })
  const secBtn = h('button', { class: 'btn btn-secondary btn-icon', title: 'Section view', onClick: actions.toggleSection }, icon('scissors', 16))
  const spinBtn = h('button', { class: 'btn btn-secondary btn-icon', title: 'Turntable', onClick: () => actions.setSpin(!store.get().spin) }, icon('rotate-cw', 16))
  const fitBtn = h('button', { class: 'btn btn-secondary btn-icon', title: 'Frame ship', onClick: () => renderer.fit() }, icon('maximize', 16))

  root.append(
    gl,
    ov,
    h('div', { class: 'vp-top' }, h('div', null, presets.el), h('div', null, proj.el, secBtn, spinBtn, fitBtn)),
    h(
      'div',
      { class: 'vp-bot' },
      h('div', { class: 'cap' }, name, dims),
      h(
        'div',
        { class: 'vp-right' },
        h('span', { class: 'hint' }, 'Drag to orbit · right-drag to pan · scroll to zoom · Shift+scroll steps section'),
        h('span', { class: 'readout' }, readout.el),
      ),
    ),
    toast,
  )

  let drag: { x: number; y: number; lx: number; ly: number; yaw: number; pitch: number; dir: number; pan: boolean } | null = null
  const manual = () => {
    if (store.get().preset) actions.clearPreset()
  }
  gl.addEventListener('contextmenu', (e) => e.preventDefault())
  gl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return
    gl.setPointerCapture(e.pointerId)
    drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, yaw: renderer.view.yaw, pitch: renderer.view.pitch, dir: Math.cos(renderer.view.pitch) < 0 ? -1 : 1, pan: e.button === 2 }
    renderer.dragStart()
    gl.classList.add('drag')
  })
  gl.addEventListener('pointermove', (e) => {
    if (!drag || (e.clientX === drag.lx && e.clientY === drag.ly)) return
    manual()
    if (drag.pan) renderer.panBy(e.clientX - drag.lx, e.clientY - drag.ly)
    else renderer.orbit(drag.yaw + (e.clientX - drag.x) * 0.008 * drag.dir, drag.pitch + (e.clientY - drag.y) * 0.008)
    drag.lx = e.clientX
    drag.ly = e.clientY
  })
  const up = () => {
    drag = null
    renderer.dragEnd()
    gl.classList.remove('drag')
  }
  gl.addEventListener('pointerup', up)
  gl.addEventListener('pointercancel', up)
  gl.addEventListener('dblclick', () => renderer.fit())
  gl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const d = e.deltaY || e.deltaX
      if (e.shiftKey && store.get().section.on) actions.stepSection(d > 0 ? -1 : 1)
      else {
        manual()
        renderer.zoomBy(d)
      }
    },
    { passive: false },
  )

  const ro = new ResizeObserver(() => {
    const r = root.getBoundingClientRect()
    ratio = window.devicePixelRatio || 1
    ov.width = Math.max(1, Math.round(r.width * ratio))
    ov.height = Math.max(1, Math.round(r.height * ratio))
    renderer.resize(r.width, r.height, ratio)
  })
  ro.observe(root)

  store.watch((s) => s.preset, presets.set)
  store.watch((s) => s.render.proj, proj.set)
  store.watch((s) => s.section.on, (on) => secBtn.classList.toggle('on', on))
  store.watch((s) => s.spin, (on) => spinBtn.classList.toggle('on', on))
  store.watch(titleText, (v) => (name.textContent = v))
  store.watch(captionText, (v) => (dims.textContent = v))
  store.watch(
    (s) => s.toast,
    (t) => {
      toast.hidden = !t
      toastText.textContent = t
    },
  )
  store.watch((s) => s.tab, () => renderer.requestFrame())
  return renderer
}
