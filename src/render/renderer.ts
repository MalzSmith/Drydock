import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  Vector3,
  Vector4,
  WebGLRenderer,
  GLSL3,
  Matrix3,
  type Camera,
  type CompressedCubeTexture,
  OrthographicCamera,
  PerspectiveCamera,
} from 'three'
import type { RenderModel } from '../se/defs.ts'
import { mul } from '../se/orient.ts'
import {
  PRESETS,
  aspectOf,
  clampZoom,
  computeFit,
  createCameras,
  frameRect,
  placeCameras,
  stepView,
  type Bounds,
  type Fit,
  type FitGrid,
  type Rect,
  type View,
} from './camera.ts'
import { bgFrag, bgVert, boxFrag, boxVert } from './shaders.ts'
import { cubeGeometry, gridGeometry } from './cube.ts'
import { createDetailLayer } from './detailLayer.ts'
import { capsOf, type AssetCounts } from './assets.ts'
import { makeSkyTexture } from './sky.ts'
import { skyMatrix } from '../assets/sky.ts'
import { assetRpc } from '../workers/client.ts'
import type { SkyLoad } from '../workers/work.worker.ts'

export type RenderOptions = {
  style: 'textured' | 'shaded' | 'clay' | 'line'
  edges: boolean
  tintMods: boolean
  proj: 'persp' | 'ortho'
  sun: number
  bg: string
  gradTop: string
  gradBot: string
  aspect: string
  spin: boolean
  section: { on: boolean; axis: number; cut: number; mode: 'cut' | 'slice'; flip: boolean; thick: number; capHi: boolean }
}

export type FrameInfo = { W: number; H: number; frame: Rect; view: View }

const BG_MODE: Record<string, number> = {
  hangar: 0,
  dusk: 0,
  custom: 0,
  paper: 1,
  steel: 2,
  transparent: 3,
  'sky-default': 4,
  'sky-orbit': 5,
  'sky-nebula': 6,
}

const BG_GRADIENT: Record<string, [string, string]> = {
  hangar: ['#f5f5f8', '#b7b7ba'],
  dusk: ['#d6ebff', '#597ea3'],
}

const STYLE: Record<RenderOptions['style'], number> = { textured: 0, shaded: 0, clay: 1, line: 2 }

function hexVec(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16)
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export type Renderer = ReturnType<typeof createRenderer>

export function createRenderer(canvas: HTMLCanvasElement, hooks: { onFrame: (f: FrameInfo) => void; onFirstFrame: () => void; onAssets: (c: AssetCounts) => void }) {
  const gl = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false })
  gl.setClearColor(0x000000, 1)
  const scene = new Scene()
  const cameras = createCameras()
  const cube = cubeGeometry()
  const root = new Group()
  scene.add(root)
  const detail = createDetailLayer(gl, capsOf(gl), { requestFrame: () => requestFrame(), onCounts: (c) => hooks.onAssets(c) })

  const boxMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: boxVert,
    fragmentShader: boxFrag,
    uniforms: {
      u_style: { value: 0 },
      u_edges: { value: 1 },
      u_tint: { value: 0 },
      u_sel: { value: 1 },
      u_sun: { value: new Vector3(0, 1, 0) },
      u_px: { value: 1 },
      u_sec: { value: new Vector4(0, 0, 0, 0) },
      u_cut: { value: new Vector2(0, 1) },
      u_cmin: { value: new Vector3() },
      u_mc: { value: 2.5 },
      u_capHi: { value: 1 },
    },
  })

  const bgGeo = new BufferGeometry()
  bgGeo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  const bgMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: bgVert,
    fragmentShader: bgFrag,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      u_mode: { value: 4 },
      u_res: { value: new Vector2(1, 1) },
      u_scale: { value: 1 },
      u_top: { value: new Vector3() },
      u_bot: { value: new Vector3() },
      u_origin: { value: new Vector2(0, 0) },
      u_yaw: { value: 0 },
      u_pitch: { value: 0 },
      u_sky: { value: null as CompressedCubeTexture | null },
      u_view: { value: new Matrix3() },
      u_skyRot: { value: new Matrix3() },
      u_tan: { value: 0.3 },
    },
  })
  const caps = capsOf(gl)
  let skyKey = ''
  let skyTex: CompressedCubeTexture | null = null

  function loadSky(id: string) {
    if (id === skyKey) return
    skyKey = id
    skyTex?.dispose()
    skyTex = null
    bgMat.uniforms.u_sky.value = null
    if (!id) return
    void assetRpc()
      .call<SkyLoad>('loadSky', { key: id.slice(4), caps })
      .then((r) => {
        if (skyKey !== id || !r) return
        skyTex = makeSkyTexture(r.data)
        bgMat.uniforms.u_sky.value = skyTex
        bgMat.uniforms.u_skyRot.value.set(...(skyMatrix(r.orient) as [number, number, number, number, number, number, number, number, number]))
        setOptions({})
      })
      .catch(() => undefined)
  }

  function skyView() {
    bgMat.uniforms.u_view.value.setFromMatrix4(cameras.persp.matrixWorld)
    bgMat.uniforms.u_tan.value = Math.tan((cameras.persp.fov * Math.PI) / 360)
  }
  const bg = new Mesh(bgGeo, bgMat)
  bg.frustumCulled = false
  bg.renderOrder = -1
  scene.add(bg)

  const view: View = { yaw: PRESETS.iso[0], pitch: PRESETS.iso[1], zoom: 1 }
  let target: View | null = null
  let dragging = false
  let model: RenderModel | null = null
  let bounds: Bounds = { center: [0, 0, 0], radius: 10, min: [-10, -10, -10], max: [10, 10, 10] }
  let fitState: Fit = { dist: 40, half: 12, offP: [0, 0, 0], offO: [0, 0, 0] }
  let fitGrids: FitGrid[] = []
  let W = 1
  let H = 1
  let dpr = 1
  let raf = 0
  let last = 0
  let ready = false
  let proj: 'persp' | 'ortho' = 'persp'
  let aspect = '16:9'
  let spin = false
  let bgId = 'sky-default'
  let exportState: { W: number; H: number; cssW: number; ss: number; transparent: boolean; rt: WebGLRenderTarget | null; zo: [number, number] | null } | null = null

  const opts: RenderOptions = {
    style: 'textured',
    edges: true,
    tintMods: false,
    proj: 'persp',
    sun: 40,
    bg: 'sky-default',
    gradTop: '#d6ebff',
    gradBot: '#2c455d',
    aspect: '16:9',
    spin: false,
    section: { on: false, axis: 0, cut: 0, mode: 'cut', flip: false, thick: 2, capHi: true },
  }

  function disposeModel() {
    for (const m of [...root.children] as Mesh[]) {
      m.geometry.dispose()
      root.remove(m)
    }
  }

  function refit(yaw: number, pitch: number) {
    fitState = computeFit(yaw, pitch, fitGrids, bounds.center, aspectOf(aspect))
  }

  function outsideView(m: RenderModel): boolean {
    if (!model) return true
    const fr = frameRect(W, H, aspectOf(aspect))
    placeCameras(cameras, view, bounds, W, H, fr, fitState)
    const cam: Camera = proj === 'persp' ? cameras.persp : cameras.ortho
    const lo = m.boundsMin
    const hi = m.boundsMax
    const p = new Vector3()
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]).project(cam)
      if (Math.abs(p.x) > fr.w / W || Math.abs(p.y) > fr.h / H || p.z > 1 || p.z < -1) return true
    }
    return false
  }

  function setModel(m: RenderModel | null, o: { refit: boolean; grow?: boolean } = { refit: true }) {
    const grew = !o.refit && o.grow === true && m !== null && outsideView(m)
    disposeModel()
    model = m
    detail.setModel(m)
    ready = false
    delete document.body.dataset.ready
    if (m) {
      for (const g of m.grids) {
        const mesh = new Mesh(gridGeometry(g.inst, g.count, cube), boxMat)
        mesh.frustumCulled = false
        const scale = new Float32Array(16)
        scale[0] = scale[5] = scale[10] = g.cell
        scale[15] = 1
        mesh.matrixAutoUpdate = false
        mesh.matrix.fromArray(mul(scale, g.toMain))
        mesh.matrixWorldNeedsUpdate = true
        root.add(mesh)
      }
      const lo = m.boundsMin
      const hi = m.boundsMax
      bounds = {
        center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
        radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2,
        min: lo,
        max: hi,
      }
      boxMat.uniforms.u_cmin.value.set(m.cellMin[0], m.cellMin[1], m.cellMin[2])
      boxMat.uniforms.u_mc.value = m.mainCell
      fitGrids = m.grids.map((g) => ({ cell: g.cell, toMain: g.toMain, inst: new Float32Array(g.inst), count: g.count }))
      if (o.refit) refit(view.yaw, view.pitch)
      else if (grew) {
        refit(view.yaw, view.pitch)
        target = { yaw: view.yaw, pitch: view.pitch, zoom: 1 }
      }
    }
    requestFrame()
  }

  function setOptions(p: Partial<RenderOptions>) {
    Object.assign(opts, p)
    boxMat.uniforms.u_style.value = STYLE[opts.style]
    boxMat.uniforms.u_edges.value = opts.edges ? 1 : 0
    boxMat.uniforms.u_tint.value = opts.tintMods ? 1 : 0
    const sa = (opts.sun * Math.PI) / 180
    boxMat.uniforms.u_sun.value.set(Math.sin(sa) * 0.62, 0.62, Math.cos(sa) * 0.62).normalize()
    proj = opts.proj
    aspect = opts.aspect
    bgId = opts.bg
    loadSky(bgId.startsWith('sky:') ? bgId : '')
    const mode = bgId.startsWith('sky:') ? (skyTex ? 7 : 4) : (BG_MODE[bgId] ?? 4)
    bgMat.uniforms.u_mode.value = mode
    const [t, b] = bgId === 'custom' ? [opts.gradTop, opts.gradBot] : (BG_GRADIENT[bgId] ?? ['#000000', '#000000'])
    bgMat.uniforms.u_top.value.copy(hexVec(t))
    bgMat.uniforms.u_bot.value.copy(hexVec(b))
    spin = opts.spin
    const sec = opts.section
    boxMat.uniforms.u_sec.value.set(sec.on ? 1 : 0, sec.axis, sec.mode === 'slice' ? 1 : 0, sec.flip ? 1 : 0)
    boxMat.uniforms.u_cut.value.set(sec.cut, sec.thick)
    boxMat.uniforms.u_capHi.value = sec.capHi ? 1 : 0
    detail.setOptions({ style: opts.style, edges: opts.edges, tintMods: opts.tintMods, sun: opts.sun, section: sec })
    requestFrame()
  }

  function resize(w: number, h: number, ratio: number) {
    W = Math.max(1, w)
    H = Math.max(1, h)
    dpr = ratio
    gl.setPixelRatio(ratio)
    gl.setSize(W, H, false)
    requestFrame()
  }

  function draw() {
    const fr = frameRect(W, H, aspectOf(aspect))
    placeCameras(cameras, view, bounds, W, H, fr, fitState)
    const cam: Camera = proj === 'persp' ? cameras.persp : cameras.ortho
    const sc = Math.max(W, H) / 1400
    bgMat.uniforms.u_origin.value.set(0, 0)
    bgMat.uniforms.u_res.value.set(W * dpr, H * dpr)
    bgMat.uniforms.u_scale.value = sc * dpr
    bgMat.uniforms.u_yaw.value = view.yaw
    bgMat.uniforms.u_pitch.value = view.pitch
    skyView()
    boxMat.uniforms.u_px.value = dpr
    if (model && detail.active()) {
      const ss = dpr >= 2 ? 1 : 2
      const pw = Math.round(W * dpr)
      const ph = Math.round(H * dpr)
      gl.autoClear = false
      detail.render(
        {
          cam,
          w: pw * ss,
          h: ph * ss,
          ss,
          transparent: false,
          drawBackground: (w, h) => {
            bgMat.uniforms.u_res.value.set(w, h)
            bgMat.uniforms.u_scale.value = sc * dpr * ss
            root.visible = false
            gl.render(scene, cam)
          },
        },
        { w: pw, h: ph },
      )
      gl.autoClear = true
    } else {
      root.visible = !!model
      gl.render(scene, cam)
    }
    hooks.onFrame({ W, H, frame: fr, view })
    if (model && !ready) {
      ready = true
      gl.getContext().finish()
      hooks.onFirstFrame()
      document.body.dataset.ready = '1'
    }
  }

  function frame(t: number) {
    raf = 0
    const dt = Math.min(0.05, (t - last) / 1000)
    last = t
    let again = false
    if (spin && !dragging) {
      view.yaw += dt * 0.45
      again = true
    }
    if (target) {
      if (stepView(view, target, dt)) again = true
      else target = null
    }
    draw()
    if (again) raf = requestAnimationFrame(frame)
  }

  function requestFrame() {
    if (raf) return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }

  return {
    canvas,
    view,
    setModel,
    setOptions,
    resize,
    requestFrame,
    goPreset(id: string) {
      const p = PRESETS[id]
      if (!p) return
      target = { yaw: p[0], pitch: p[1], zoom: 1 }
      refit(p[0], p[1])
      requestFrame()
    },
    fit() {
      refit(view.yaw, view.pitch)
      target = { yaw: view.yaw, pitch: view.pitch, zoom: 1 }
      requestFrame()
    },
    setView(id: string) {
      const p = PRESETS[id]
      if (!p) return
      view.yaw = p[0]
      view.pitch = p[1]
      view.zoom = 1
      target = null
      refit(view.yaw, view.pitch)
      requestFrame()
    },
    dragStart() {
      dragging = true
      target = null
    },
    dragEnd() {
      dragging = false
      requestFrame()
    },
    orbit(yaw: number, pitch: number) {
      view.yaw = yaw
      view.pitch = pitch
      requestFrame()
    },
    zoomBy(dy: number) {
      view.zoom = clampZoom(view.zoom * Math.exp(-dy * 0.0015))
      target = null
      requestFrame()
    },
    fitFor(yaws: number[]): Fit {
      const sum: Fit = { dist: 0, half: 0, offP: [0, 0, 0], offO: [0, 0, 0] }
      for (const y of yaws) {
        const f = computeFit(y, view.pitch, fitGrids, bounds.center, aspectOf(aspect))
        sum.dist = Math.max(sum.dist, f.dist)
        sum.half = Math.max(sum.half, f.half)
        for (let i = 0; i < 3; i++) {
          sum.offP[i] += f.offP[i] / yaws.length
          sum.offO[i] += f.offO[i] / yaws.length
        }
      }
      return sum
    },
    currentFit: () => fitState,
    maxTile: () => Math.min(4096, gl.capabilities.maxTextureSize),
    exportBegin(o: { W: number; H: number; cssW: number; ss: number; transparent: boolean; yaw?: number; fit?: Fit }) {
      exportState = { ...o, rt: null, zo: null }
      const v = { ...view, yaw: o.yaw ?? view.yaw }
      placeCameras(cameras, v, bounds, o.W, o.H, { x: 0, y: 0, w: o.W, h: o.H }, o.fit ?? fitState)
      bgMat.uniforms.u_res.value.set(o.W, o.H)
      bgMat.uniforms.u_scale.value = Math.max(o.W, o.H) / 1400
      bgMat.uniforms.u_yaw.value = v.yaw
      bgMat.uniforms.u_pitch.value = v.pitch
      skyView()
      boxMat.uniforms.u_px.value = o.W / o.cssW
      boxMat.uniforms.u_sel.value = 0
      detail.setSelTint(false)
      bg.visible = !o.transparent
      root.visible = !!model
      if (model && detail.active()) {
        const cam = proj === 'persp' ? cameras.persp : cameras.ortho
        const k = Math.min(1, 1024 / Math.max(o.W, o.H))
        gl.autoClear = false
        exportState.zo = detail.depthRange(cam, Math.max(1, Math.round(o.W * k)), Math.max(1, Math.round(o.H * k)), 1)
        gl.autoClear = true
      }
    },
    exportTile(x: number, y: number, tw: number, th: number): Uint8Array {
      const e = exportState!
      const cam = (proj === 'persp' ? cameras.persp : cameras.ortho) as PerspectiveCamera | OrthographicCamera
      if (e.zo) {
        const pl = x > 0 ? 1 : 0
        const pt = y > 0 ? 1 : 0
        const pr = x + tw < e.W ? 1 : 0
        const pb = y + th < e.H ? 1 : 0
        const x0 = x - pl
        const y0 = y - pt
        const w0 = tw + pl + pr
        const h0 = th + pt + pb
        cam.setViewOffset(e.W, e.H, x0, y0, w0, h0)
        gl.autoClear = false
        const out = detail.renderTile(
          {
            cam,
            w: w0,
            h: h0,
            ss: e.ss,
            transparent: e.transparent,
            drawBackground: () => {
              bgMat.uniforms.u_origin.value.set(x0, e.H - y0 - h0)
              root.visible = false
              gl.render(scene, cam)
            },
          },
          e.zo,
          { x: pl, y: pb, w: tw, h: th },
        )
        gl.autoClear = true
        return out
      }
      cam.setViewOffset(e.W, e.H, x, y, tw, th)
      if (!e.rt || e.rt.width !== tw || e.rt.height !== th) {
        e.rt?.dispose()
        e.rt = new WebGLRenderTarget(tw, th, { samples: 4, depthBuffer: true })
      }
      bgMat.uniforms.u_origin.value.set(x, e.H - y - th)
      gl.setRenderTarget(e.rt)
      gl.setClearColor(0x000000, e.transparent ? 0 : 1)
      gl.render(scene, cam)
      const buf = new Uint8Array(tw * th * 4)
      gl.readRenderTargetPixels(e.rt, 0, 0, tw, th, buf)
      gl.setRenderTarget(null)
      return buf
    },
    exportEnd() {
      const e = exportState
      if (e?.rt) e.rt.dispose()
      exportState = null
      cameras.persp.clearViewOffset()
      cameras.ortho.clearViewOffset()
      gl.setClearColor(0x000000, 1)
      bg.visible = true
      boxMat.uniforms.u_sel.value = 1
      detail.setSelTint(true)
      boxMat.uniforms.u_px.value = dpr
      requestFrame()
    },
    drawNow: draw,
    probe(x: number, y: number): number[] {
      draw()
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      ctx.readPixels(Math.round(x * dpr), Math.round((H - y) * dpr), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      return Array.from(px)
    },
    info: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, detail: detail.active(), assets: detail.counts(), stats: detail.stats() }),
    retryAssets: () => detail.retry(),
    detailStats: () => detail.stats(),
    finish() {
      const ctx = gl.getContext()
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, new Uint8Array(4))
    },
  }
}
