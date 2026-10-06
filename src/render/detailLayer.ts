import {
  AlwaysDepth,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DepthTexture,
  DoubleSide,
  DstColorFactor,
  EqualDepth,
  EqualStencilFunc,
  IncrementStencilOp,
  FloatType,
  GLSL3,
  Group,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LessEqualDepth,
  Mesh,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
  type Camera,
  type IUniform,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three'
import type { PartData } from '../assets/build.ts'
import { KIND_DECAL, KIND_GLASS } from '../assets/material.ts'
import type { RenderModel, SkinRecord } from '../se/defs.ts'
import { mul } from '../se/orient.ts'
import { loadTileTable, type TileTable } from '../se/tiles.ts'
import { createAssets, type AssetCounts, type MeshAttrs, type MeshEntry, type TexEntry } from './assets.ts'
import type { Caps } from '../assets/build.ts'
import { cubeGeometry, gridGeometry } from './cube.ts'
import { STRIDE, buildDetail, type DetailScene } from './detail.ts'
import { compositeFrag, downFrag, glassFrag, lineFrag, lineVert, modelFrag, modelVert, quadVert, reduceFrag, refBoxFrag, refBoxVert } from './detailShaders.ts'

export type DetailOptions = {
  style: 'textured' | 'shaded' | 'clay' | 'line'
  edges: boolean
  tintMods: boolean
  sun: number
  section: { on: boolean; axis: number; cut: number; mode: 'cut' | 'slice'; flip: boolean; thick: number; capHi: boolean }
}

export type DetailPass = {
  cam: Camera
  w: number
  h: number
  ss: number
  transparent: boolean
  drawBackground: (w: number, h: number) => void
}

const STYLE = { textured: 0, shaded: 1, clay: 2, line: 3 } as const

type PartMat = { mat: ShaderMaterial; glassDepth?: ShaderMaterial; glassColor?: ShaderMaterial; texKeys: string[] }

function quadGeometry(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  return g
}

function lineGeometry(lines: Float32Array): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3))
  g.setIndex([0, 2, 1, 1, 2, 3])
  const ib = new InstancedInterleavedBuffer(lines, 6, 1)
  g.setAttribute('i_a', new InterleavedBufferAttribute(ib, 3, 0))
  g.setAttribute('i_b', new InterleavedBufferAttribute(ib, 3, 3))
  g.instanceCount = lines.length / 6
  return g
}

function nearestRT(w: number, h: number, o: ConstructorParameters<typeof WebGLRenderTarget>[2] = {}) {
  return new WebGLRenderTarget(w, h, { minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false, ...o })
}

function releaseShared(g: InstancedBufferGeometry) {
  g.index = null
  for (const k of ['position', 'normal', 'uv']) g.deleteAttribute(k)
  g.dispose()
}

function disposeAttrs(a: MeshAttrs) {
  const g = new BufferGeometry()
  g.setAttribute('position', a.position)
  g.setAttribute('normal', a.normal)
  g.setAttribute('uv', a.uv)
  g.setIndex(a.index)
  g.dispose()
}

export function createDetailLayer(gl: WebGLRenderer, caps: Caps, hooks: { requestFrame: () => void; onCounts: (c: AssetCounts) => void }) {
  const shared: Record<string, IUniform> = {
    u_style: { value: 0 },
    u_tint: { value: 0 },
    u_sel: { value: 1 },
    u_light: { value: new Vector3(0, 1, 0) },
    u_fill: { value: new Vector3(1, 0, 0) },
    u_camPos: { value: new Vector3() },
    u_camDir: { value: new Vector3(0, 0, -1) },
    u_persp: { value: 1 },
    u_sec: { value: new Vector4() },
    u_cut: { value: new Vector2(0, 1) },
    u_capHi: { value: 1 },
    u_px: { value: 1 },
  }
  const sceneG = new Scene()
  const sceneGlass = new Scene()
  const rootG = new Group()
  const rootGlass = new Group()
  sceneG.add(rootG)
  sceneGlass.add(rootGlass)
  const cube = cubeGeometry()
  const quad = quadGeometry()
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const refBoxMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: refBoxVert,
    fragmentShader: refBoxFrag,
    uniforms: { ...shared, u_cmin: { value: new Vector3() }, u_mc: { value: 2.5 } },
  })
  const lineMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: lineVert,
    fragmentShader: lineFrag,
    transparent: true,
    depthWrite: false,
    depthFunc: LessEqualDepth,
    blending: CustomBlending,
    blendSrc: DstColorFactor,
    blendDst: ZeroFactor,
    blendSrcAlpha: DstColorFactor,
    blendDstAlpha: ZeroFactor,
    uniforms: {
      ...shared,
      u_res: { value: new Vector2(1, 1) },
      u_width: { value: 1 },
      u_pull: { value: 0.125 },
      u_cmin: refBoxMat.uniforms.u_cmin,
      u_mc: refBoxMat.uniforms.u_mc,
    },
  })

  const clip = { value: new Vector3(0.1, 100, 1) }
  const passMat = (frag: string, uniforms: Record<string, IUniform>, extra: Partial<ShaderMaterial> = {}) => {
    const m = new ShaderMaterial({ glslVersion: GLSL3, vertexShader: quadVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false })
    Object.assign(m, extra)
    return m
  }
  const reduceMat = passMat(reduceFrag, { u_src: { value: null }, u_first: { value: 1 }, u_size: { value: new Vector2() }, u_clip: clip })
  const compMat = passMat(
    compositeFrag,
    {
      u_col: { value: null },
      u_nrm: { value: null },
      u_dep: { value: null },
      u_zr: { value: null },
      u_zo: { value: new Vector2() },
      u_useZo: { value: 0 },
      u_tol: { value: 0.35 },
      u_pxm: { value: 1 },
      u_mc: { value: 2.5 },
      u_ss: { value: 1 },
      u_line: { value: 0 },
      u_clip: clip,
    },
    { depthTest: true, depthWrite: true, depthFunc: AlwaysDepth },
  )
  const downMat = passMat(downFrag, { u_src: { value: null }, u_ss: { value: 1 } })
  const passScene = new Scene()
  const passMesh = new Mesh(quad, reduceMat)
  passMesh.frustumCulled = false
  passScene.add(passMesh)

  const assets = createAssets(caps, () => rebuild(), () => hooks.requestFrame(), hooks.onCounts)
  let table: TileTable | null = null
  void loadTileTable().then((t) => {
    table = t
    rebuild()
  })

  let model: RenderModel | null = null
  let built: DetailScene | null = null
  let active = false
  let lines: Mesh | null = null
  const mats = new Map<string, PartMat>()
  const groupGeos: InstancedBufferGeometry[] = []
  const boxGeos: InstancedBufferGeometry[] = []
  const decals: Mesh[] = []
  const behind: Mesh[] = []
  const glassMeshes: Array<{ mesh: Mesh; pm: PartMat }> = []
  let gRT: WebGLRenderTarget | null = null
  let compRT: WebGLRenderTarget | null = null
  let redRTs: WebGLRenderTarget[] = []
  let opts: DetailOptions = {
    style: 'textured',
    edges: true,
    tintMods: false,
    sun: 40,
    section: { on: false, axis: 0, cut: 0, mode: 'cut', flip: false, thick: 2, capHi: true },
  }

  function bindTextures(pm: PartMat, part: PartData, skin: SkinRecord | null) {
    const u = pm.mat.uniforms
    const t = { ...part.tex }
    const ch = skin?.changes[part.material]
    if (ch && part.tex) {
      const mod = skin!.source !== 'vanilla' && skin!.source !== 'game' ? skin!.source : null
      const c = (p: string) => (mod ? [`m:${mod}:${p}`, `c:${p}`] : [`c:${p}`])
      if (ch.cm) t.cm = c(ch.cm)
      if (ch.ng) t.ng = c(ch.ng)
      if (ch.add) t.add = c(ch.add)
      if (ch.am) t.am = c(ch.am)
    }
    if (!part.tex) return
    const slots: Array<[keyof typeof t, string, boolean]> = [['cm', 'u_cm', true], ['ng', 'u_ng', false], ['add', 'u_add', true], ['am', 'u_am', false]]
    const entries: Array<[string, TexEntry | null]> = slots.map(([k, name, srgb]) => [name, t[k] ? assets.texture(t[k]!, srgb) : null])
    pm.texKeys = slots.filter(([k]) => t[k]).map(([k, , srgb]) => t[k]!.join('|') + (srgb ? '#s' : '#l'))
    const apply = () => {
      if (entries.some(([, e]) => e?.status === 'pending')) return
      const ok = entries.map(([, e]) => e?.status === 'ok')
      entries.forEach(([name, e]) => (u[name].value = e?.tex ?? null))
      u.u_has.value.set(ok[0] ? 1 : 0, ok[1] ? 1 : 0, ok[2] ? 1 : 0, ok[3] ? 1 : 0)
      const uncached = entries.some(([, e]) => e?.status === 'uncached')
      u.u_textured.value = !uncached && (ok[0] || ok[1] || ok[2]) ? 1 : 0
      u.u_alphaTest.value = ok[3] && (part.technique.startsWith('ALPHA_MASKED') || part.technique === 'DECAL_CUTOUT') ? 1 : 0
      hooks.requestFrame()
    }
    for (const [, e] of entries) if (e?.status === 'pending') e.waiters.add(apply)
    apply()
  }

  function partMaterial(mesh: MeshEntry, part: PartData, pi: number, skin: SkinRecord | null): PartMat {
    const key = mesh.key + '\u0000' + (skin?.sub ?? '') + '\u0000' + pi
    let pm = mats.get(key)
    if (pm) return pm
    const decal = part.kind === KIND_DECAL
    const uniforms: Record<string, IUniform> = {
      ...shared,
      u_pull: { value: decal ? 0.03 : 0 },
      u_kind: { value: part.kind },
      u_fixed: { value: new Vector3(...part.color) },
      u_textured: { value: 0 },
      u_has: { value: new Vector4() },
      u_alphaTest: { value: 0 },
      u_metal: { value: skin?.metalColorable ? 1 : 0 },
      u_decal: { value: decal ? 1 : 0 },
      u_cutout: { value: part.technique === 'DECAL_CUTOUT' ? 1 : 0 },
      u_cm: { value: null },
      u_ng: { value: null },
      u_add: { value: null },
      u_am: { value: null },
    }
    const mat = new ShaderMaterial({ glslVersion: GLSL3, vertexShader: modelVert, fragmentShader: modelFrag, uniforms, side: DoubleSide })
    if (decal)
      Object.assign(mat, {
        transparent: true,
        depthWrite: false,
        depthFunc: LessEqualDepth,
        blending: CustomBlending,
        blendSrc: SrcAlphaFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
      })
    pm = { mat, texKeys: [] }
    if (part.kind === KIND_GLASS) {
      const gu = { ...shared, u_pull: { value: 0 } }
      pm.glassDepth = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: modelVert,
        fragmentShader: glassFrag,
        uniforms: gu,
        side: DoubleSide,
        colorWrite: false,
      })
      pm.glassColor = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: modelVert,
        fragmentShader: glassFrag,
        uniforms: gu,
        side: DoubleSide,
        depthWrite: false,
        depthFunc: EqualDepth,
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: EqualStencilFunc,
        stencilZPass: IncrementStencilOp,
        transparent: true,
        blending: CustomBlending,
        blendSrc: SrcAlphaFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
      })
    } else bindTextures(pm, part, skin)
    mats.set(key, pm)
    return pm
  }

  function clear() {
    for (const g of groupGeos) releaseShared(g)
    for (const g of boxGeos) {
      g.index = null
      g.deleteAttribute('position')
      g.deleteAttribute('normal')
      g.dispose()
    }
    groupGeos.length = 0
    boxGeos.length = 0
    decals.length = 0
    behind.length = 0
    glassMeshes.length = 0
    rootG.clear()
    rootGlass.clear()
    lines?.geometry.dispose()
    lines = null
  }

  function rebuild() {
    clear()
    active = false
    built = null
    if (!model || !table || !model.defs) {
      hooks.requestFrame()
      return
    }
    const scene = buildDetail(model, table, (c) => assets.mesh(c))
    built = scene
    active = scene.groups.length > 0
    if (!active) {
      hooks.requestFrame()
      return
    }
    refBoxMat.uniforms.u_cmin.value.set(model.cellMin[0], model.cellMin[1], model.cellMin[2])
    refBoxMat.uniforms.u_mc.value = model.mainCell
    compMat.uniforms.u_mc.value = model.mainCell
    compMat.uniforms.u_tol.value = 0.14 * model.mainCell
    lineMat.uniforms.u_pull.value = 0.05 * model.mainCell
    const usedMats = new Set<PartMat>()
    for (const gr of scene.groups) {
      const me = gr.mesh as MeshEntry
      if (!me.data || !me.attrs) continue
      const ib = new InstancedInterleavedBuffer(gr.inst, STRIDE, 1)
      const at = (n: number, o: number) => new InterleavedBufferAttribute(ib, n, o)
      me.data.parts.forEach((part, pi) => {
        const g = new InstancedBufferGeometry()
        g.setIndex(me.attrs!.index)
        g.setAttribute('position', me.attrs!.position)
        g.setAttribute('normal', me.attrs!.normal)
        g.setAttribute('uv', me.attrs!.uv)
        g.setAttribute('i_r0', at(3, 0))
        g.setAttribute('i_r1', at(3, 3))
        g.setAttribute('i_r2', at(3, 6))
        g.setAttribute('i_t', at(3, 9))
        g.setAttribute('i_hsv', at(3, 12))
        g.setAttribute('i_paint', at(1, 15))
        g.setAttribute('i_uvo', at(2, 16))
        g.setAttribute('i_lo', at(3, 18))
        g.setAttribute('i_hi', at(3, 21))
        g.setAttribute('i_flags', at(1, 24))
        g.setAttribute('i_nlo', at(3, 25))
        g.setAttribute('i_nhi', at(3, 28))
        g.instanceCount = gr.count
        g.setDrawRange(part.start, part.count)
        groupGeos.push(g)
        const pm = partMaterial(me, part, pi, gr.skin)
        usedMats.add(pm)
        if (part.kind === KIND_GLASS) {
          const mesh = new Mesh(g, pm.glassColor!)
          mesh.frustumCulled = false
          if (gr.behind) behind.push(mesh)
          rootGlass.add(mesh)
          glassMeshes.push({ mesh, pm })
          return
        }
        const mesh = new Mesh(g, pm.mat)
        mesh.frustumCulled = false
        if (gr.behind) behind.push(mesh)
        if (part.kind === KIND_DECAL) {
          mesh.renderOrder = 1
          decals.push(mesh)
        }
        rootG.add(mesh)
      })
    }
    for (const b of scene.boxes) {
      const grid = model.grids[b.grid]
      const g = gridGeometry(b.inst.buffer as ArrayBuffer, b.count, cube)
      boxGeos.push(g)
      const mesh = new Mesh(g, refBoxMat)
      mesh.frustumCulled = false
      const sc = new Float32Array(16)
      sc[0] = sc[5] = sc[10] = grid.cell
      sc[15] = 1
      mesh.matrixAutoUpdate = false
      mesh.matrix.fromArray(mul(sc, grid.toMain))
      mesh.matrixWorldNeedsUpdate = true
      rootG.add(mesh)
    }
    if (scene.lines.length) {
      lines = new Mesh(lineGeometry(scene.lines), lineMat)
      lines.frustumCulled = false
      lines.renderOrder = 2
      rootG.add(lines)
    }
    for (const [k, pm] of mats)
      if (!usedMats.has(pm) && pm.texKeys.length === 0 && !pm.glassDepth) {
        pm.mat.dispose()
        mats.delete(k)
      }
    applyVisibility()
    hooks.requestFrame()
  }

  function applyVisibility() {
    for (const d of decals) d.visible = opts.style === 'textured'
    for (const b of behind) b.visible = opts.section.on && (opts.style === 'textured' || !decals.includes(b))
    if (lines) lines.visible = opts.edges
  }

  function setOptions(o: DetailOptions) {
    opts = o
    shared.u_style.value = STYLE[o.style]
    shared.u_tint.value = o.tintMods ? 1 : 0
    const sec = o.section
    shared.u_sec.value.set(sec.on ? 1 : 0, sec.axis, sec.mode === 'slice' ? 1 : 0, sec.flip ? 1 : 0)
    shared.u_cut.value.set(sec.cut, sec.thick)
    shared.u_capHi.value = sec.capHi ? 1 : 0
    compMat.uniforms.u_line.value = o.style === 'line' ? 1 : 0
    applyVisibility()
  }

  function setModel(m: RenderModel | null) {
    const prev = model
    model = m
    if (prev !== m) {
      for (const [k, pm] of mats) {
        pm.mat.dispose()
        pm.glassDepth?.dispose()
        pm.glassColor?.dispose()
        mats.delete(k)
      }
    }
    rebuild()
    if (prev !== m && m) {
      const keep = new Set<string>()
      for (const pm of mats.values()) for (const k of pm.texKeys) keep.add(k)
      assets.forget((k) => keep.has(k))
      const used = new Set(built?.used ?? [])
      assets.forgetMeshes((k) => used.has(k), disposeAttrs)
    }
  }

  const up = new Vector3()
  const right = new Vector3()
  const back = new Vector3()

  function updateLights(cam: Camera) {
    const e = cam.matrixWorld.elements
    right.set(e[0], e[1], e[2]).normalize()
    up.set(e[4], e[5], e[6]).normalize()
    back.set(e[8], e[9], e[10]).normalize()
    const dir = back.clone().negate()
    const light = dir.clone().multiplyScalar(-0.6).addScaledVector(up, 0.75).addScaledVector(right, -0.3).normalize()
    const fill = dir.clone().multiplyScalar(-0.3).addScaledVector(up, -0.2).addScaledVector(right, 0.8).normalize()
    const a = ((opts.sun - 40) * Math.PI) / 180
    for (const v of [light, fill]) v.applyAxisAngle(up, a)
    shared.u_light.value.copy(light)
    shared.u_fill.value.copy(fill)
    shared.u_camPos.value.setFromMatrixPosition(cam.matrixWorld)
    shared.u_camDir.value.copy(dir)
    const persp = (cam as PerspectiveCamera).isPerspectiveCamera === true
    shared.u_persp.value = persp ? 1 : 0
    const c = cam as PerspectiveCamera
    clip.value.set(c.near, c.far, persp ? 1 : 0)
  }

  function ensureTargets(w: number, h: number) {
    if (gRT && gRT.width === w && gRT.height === h) return
    gRT?.dispose()
    gRT?.depthTexture?.dispose()
    compRT?.dispose()
    for (const r of redRTs) r.dispose()
    const dt = new DepthTexture(w, h, FloatType)
    dt.minFilter = dt.magFilter = NearestFilter
    gRT = nearestRT(w, h, { count: 2, depthTexture: dt, depthBuffer: true })
    compRT = nearestRT(w, h, { depthBuffer: true, stencilBuffer: true })
    redRTs = []
    let cw = w
    let ch = h
    do {
      cw = Math.ceil(cw / 8)
      ch = Math.ceil(ch / 8)
      redRTs.push(nearestRT(cw, ch, { type: FloatType, depthBuffer: false }))
    } while (cw > 1 || ch > 1)
  }

  function runPass(mat: ShaderMaterial, target: WebGLRenderTarget | null) {
    passMesh.material = mat
    gl.setRenderTarget(target)
    gl.render(passScene, quadCam)
  }

  function reduce(w: number, h: number) {
    let src: Texture = gRT!.depthTexture!
    let sw = w
    let sh = h
    reduceMat.uniforms.u_first.value = 1
    for (const rt of redRTs) {
      reduceMat.uniforms.u_src.value = src
      reduceMat.uniforms.u_size.value.set(sw, sh)
      runPass(reduceMat, rt)
      reduceMat.uniforms.u_first.value = 0
      src = rt.texture
      sw = rt.width
      sh = rt.height
    }
    return redRTs[redRTs.length - 1]
  }

  function renderGBuffer(cam: Camera, w: number, h: number, ss: number) {
    updateLights(cam)
    shared.u_px.value = ss
    lineMat.uniforms.u_res.value.set(w, h)
    lineMat.uniforms.u_width.value = ss
    gl.setRenderTarget(gRT)
    gl.setClearColor(0x000000, 1)
    gl.clear(true, true, false)
    gl.render(sceneG, cam)
  }

  function composite(p: DetailPass, zr: WebGLRenderTarget | null, zo: [number, number] | null) {
    const pr = (p.cam as PerspectiveCamera).projectionMatrix.elements
    compMat.uniforms.u_col.value = gRT!.textures[0]
    compMat.uniforms.u_nrm.value = gRT!.textures[1]
    compMat.uniforms.u_dep.value = gRT!.depthTexture
    compMat.uniforms.u_zr.value = zr?.texture ?? null
    compMat.uniforms.u_useZo.value = zo ? 1 : 0
    if (zo) compMat.uniforms.u_zo.value.set(zo[0], zo[1])
    compMat.uniforms.u_pxm.value = (p.h / 2) * pr[5]
    compMat.uniforms.u_ss.value = p.ss
    gl.setRenderTarget(compRT)
    gl.setClearColor(0x000000, p.transparent ? 0 : 1)
    gl.clear(true, true, true)
    if (!p.transparent) p.drawBackground(p.w, p.h)
    runPass(compMat, compRT)
    for (const g of glassMeshes) g.mesh.material = g.pm.glassDepth!
    gl.render(sceneGlass, p.cam)
    for (const g of glassMeshes) g.mesh.material = g.pm.glassColor!
    gl.render(sceneGlass, p.cam)
  }

  function render(p: DetailPass, out: { w: number; h: number }) {
    ensureTargets(p.w, p.h)
    renderGBuffer(p.cam, p.w, p.h, p.ss)
    const zr = reduce(p.w, p.h)
    composite(p, zr, null)
    downMat.uniforms.u_src.value = compRT!.texture
    downMat.uniforms.u_ss.value = p.ss
    gl.setRenderTarget(null)
    gl.setViewport(0, 0, out.w, out.h)
    runPass(downMat, null)
  }

  function depthRange(cam: Camera, w: number, h: number, ss: number): [number, number] {
    ensureTargets(w, h)
    renderGBuffer(cam, w, h, ss)
    const zr = reduce(w, h)
    const px = new Float32Array(4)
    gl.readRenderTargetPixels(zr, 0, 0, 1, 1, px)
    gl.setRenderTarget(null)
    return [px[0], px[1]]
  }

  function renderTile(p: DetailPass, zo: [number, number], read: { x: number; y: number; w: number; h: number }): Uint8Array {
    ensureTargets(p.w, p.h)
    renderGBuffer(p.cam, p.w, p.h, p.ss)
    composite(p, null, zo)
    const buf = new Uint8Array(read.w * read.h * 4)
    gl.readRenderTargetPixels(compRT!, read.x, read.y, read.w, read.h, buf)
    gl.setRenderTarget(null)
    return buf
  }

  return {
    setModel,
    setOptions,
    setSelTint: (on: boolean) => void (shared.u_sel.value = on ? 1 : 0),
    render,
    renderTile,
    depthRange,
    active: () => active,
    retry: () => assets.retry(),
    counts: () => assets.counts(),
    stats: () => (built ? { models: built.models, pending: built.pending, missing: built.missing, uncached: built.uncached } : null),
    dispose() {
      clear()
      gRT?.dispose()
      compRT?.dispose()
    },
  }
}

export type DetailLayer = ReturnType<typeof createDetailLayer>
