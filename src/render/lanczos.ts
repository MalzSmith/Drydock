import { FloatType, GLSL3, Mesh, NearestFilter, OrthographicCamera, Scene, ShaderMaterial, UnsignedByteType, WebGLRenderTarget, type Texture, type TextureDataType, type WebGLRenderer } from 'three'
import { quadGeometry } from './detailLayer.ts'
import { quadVert } from './detailShaders.ts'

export const LANCZOS_MAX_SS = 8
const BAND_BYTES = 128 << 20

export const lanczosApron = (ss: number) => 3 * ss + 2

export type TilePlan = { ss: number; apron: number; ow: number; oh: number; tw: number; th: number }

export function tilePlan(w: number, ss: number, maxTile: number): TilePlan {
  const apron = lanczosApron(ss)
  const fit = Math.floor((maxTile - 2 * apron) / ss)
  const ow = Math.min(fit, w)
  const oh = Math.max(1, Math.min(fit, Math.floor(BAND_BYTES / (w * 4))))
  return { ss, apron, ow, oh, tw: ow * ss + 2 * apron, th: oh * ss + 2 * apron }
}

const kernel = `
layout(location = 0) out highp vec4 fragColor;
uniform highp sampler2D u_src;
uniform int u_ss;
uniform int u_apron;
uniform int u_th;
uniform int u_opaque;
const float PI = 3.14159265358979;
float sinc(float x) {
  if (abs(x) < 1e-6) return 1.0;
  float p = PI * x;
  return sin(p) / p;
}
float lanczos(float x) {
  return abs(x) < 3.0 ? sinc(x) * sinc(x / 3.0) : 0.0;
}
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec4 tap(int k, int x);
vec4 resolve(int x, int o) {
  float s = float(u_ss);
  float c = float(u_apron) + (float(o) + 0.5) * s;
  int k0 = int(ceil(c - 3.0 * s - 0.5));
  int k1 = int(floor(c + 3.0 * s - 0.5));
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  vec4 lo = vec4(1e9);
  vec4 hi = vec4(-1e9);
  for (int t = 0; t < ${6 * LANCZOS_MAX_SS + 2}; t++) {
    int k = k0 + t;
    if (k > k1) break;
    float d = (float(k) + 0.5 - c) / s;
    vec4 v = tap(k, x);
    float w = lanczos(d);
    sum += v * w;
    wsum += w;
    if (abs(d) < 1.0) {
      lo = min(lo, v);
      hi = max(hi, v);
    }
  }
  return clamp(sum / wsum, lo, hi);
}
`

const rowFrag = `${kernel}
vec4 tap(int k, int y) {
  vec4 t = texelFetch(u_src, ivec2(k, y), 0);
  if (t.a <= 0.0) return vec4(0.0);
  return vec4(toLinear(clamp(t.rgb / t.a, 0.0, 1.0)) * t.a, t.a);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  fragColor = resolve(p.y, p.x);
}
`

const colFrag = `${kernel}
vec4 tap(int k, int x) {
  return texelFetch(u_src, ivec2(x, u_th - 1 - k), 0);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 v = resolve(p.x, p.y);
  float a = clamp(v.a, 0.0, 1.0);
  vec3 rgb = a > 0.0 ? toSrgb(clamp(v.rgb / a, 0.0, 1.0)) : vec3(0.0);
  fragColor = vec4(rgb, u_opaque == 1 ? 1.0 : a);
}
`

export type Resolver = {
  run(src: Texture, plan: TilePlan, ow: number, oh: number, opaque: boolean): Uint8Array
  dispose(): void
}

export function createResolver(gl: WebGLRenderer): Resolver {
  const uniforms = () => ({ u_src: { value: null as Texture | null }, u_ss: { value: 1 }, u_apron: { value: 0 }, u_th: { value: 1 }, u_opaque: { value: 1 } })
  const material = (frag: string) => new ShaderMaterial({ glslVersion: GLSL3, vertexShader: quadVert, fragmentShader: frag, uniforms: uniforms(), depthTest: false, depthWrite: false })
  const rowMat = material(rowFrag)
  const colMat = material(colFrag)
  const quad = quadGeometry()
  const mesh = new Mesh(quad, rowMat)
  mesh.frustumCulled = false
  const scene = new Scene()
  scene.add(mesh)
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  let mid: WebGLRenderTarget | null = null
  let out: WebGLRenderTarget | null = null

  const sized = (rt: WebGLRenderTarget | null, w: number, h: number, type: TextureDataType) => {
    if (!rt || rt.width < w || rt.height < h) {
      rt?.dispose()
      rt = new WebGLRenderTarget(w, h, { type, minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false, depthBuffer: false })
    }
    rt.viewport.set(0, 0, w, h)
    return rt
  }

  const pass = (mat: ShaderMaterial, src: Texture, plan: TilePlan, opaque: boolean, target: WebGLRenderTarget) => {
    const u = mat.uniforms
    u.u_src.value = src
    u.u_ss.value = plan.ss
    u.u_apron.value = plan.apron
    u.u_th.value = plan.th
    u.u_opaque.value = opaque ? 1 : 0
    mesh.material = mat
    gl.setRenderTarget(target)
    gl.render(scene, cam)
  }

  return {
    run(src, plan, ow, oh, opaque) {
      mid = sized(mid, ow, plan.th, FloatType)
      out = sized(out, ow, oh, UnsignedByteType)
      pass(rowMat, src, plan, opaque, mid)
      pass(colMat, mid.texture, plan, opaque, out)
      const buf = new Uint8Array(ow * oh * 4)
      gl.readRenderTargetPixels(out, 0, 0, ow, oh, buf)
      gl.setRenderTarget(null)
      return buf
    },
    dispose() {
      mid?.dispose()
      out?.dispose()
      mid = out = null
    },
  }
}
