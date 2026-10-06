const section = `
uniform vec4 u_sec;
uniform vec2 u_cut;
uniform float u_capHi;

bool keptRange(float lo, float hi) {
  float cut = u_cut.x;
  float t = u_cut.y;
  bool flip = u_sec.w > 0.5;
  if (u_sec.z < 0.5) return flip ? hi >= cut : lo < cut;
  return flip ? (lo <= cut + t - 1.0 && hi >= cut) : (lo <= cut - 1.0 && hi >= cut - t);
}
`

const color = `
float toLin(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 toLin(vec3 c) { return vec3(toLin(c.r), toLin(c.g), toLin(c.b)); }
float toSrgb(float c) { c = clamp(c, 0.0, 1.0); return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 toSrgb(vec3 c) { return vec3(toSrgb(c.r), toSrgb(c.g), toSrgb(c.b)); }
vec3 hsv2rgb(vec3 hsv) {
  float h = hsv.x;
  vec3 k = clamp(vec3(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), 0.0, 1.0);
  return ((k - 1.0) * hsv.y + 1.0) * hsv.z;
}
vec3 unpackRgb(float c) {
  uint u = uint(c);
  return vec3(float(u & 255u), float((u >> 8u) & 255u), float((u >> 16u) & 255u)) / 255.0;
}
`

const pull = `
uniform float u_pull;
vec4 project(vec3 wp) {
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  if (u_pull > 0.0) {
    bool persp = projectionMatrix[2][3] < -0.5;
    mv.xyz += (persp ? normalize(-mv.xyz) : vec3(0.0, 0.0, 1.0)) * u_pull;
  }
  return projectionMatrix * mv;
}
`

export const modelVert = `
in vec3 i_r0;
in vec3 i_r1;
in vec3 i_r2;
in vec3 i_t;
in vec3 i_hsv;
in float i_paint;
in vec2 i_uvo;
in vec3 i_lo;
in vec3 i_hi;
in float i_flags;
in vec3 i_nlo;
in vec3 i_nhi;
out vec3 v_wp;
out vec3 v_n;
out vec2 v_uv;
flat out vec3 v_paint;
flat out vec3 v_key;
flat out float v_flags;
out float v_cap;
invariant gl_Position;
${section}
${color}
${pull}

void main() {
  vec3 wp = position.x * i_r0 + position.y * i_r1 + position.z * i_r2 + i_t;
  vec3 wn = normal.x * i_r0 + normal.y * i_r1 + normal.z * i_r2;
  v_cap = 0.0;
  if (u_sec.x > 0.5) {
    int ax = int(u_sec.y + 0.5);
    float lo = i_lo[ax];
    float hi = i_hi[ax];
    if (!keptRange(lo, hi) || ((int(i_flags + 0.5) & 4) != 0 && keptRange(i_nlo[ax], i_nhi[ax]))) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float nd = wn[ax] / max(length(wn), 1e-6);
    if (u_capHi > 0.5 && abs(nd) > 0.9) {
      float nl = nd > 0.0 ? hi + 1.0 : lo - 1.0;
      if (!keptRange(nl, nl)) v_cap = 1.0;
    }
  }
  gl_Position = project(wp);
  v_wp = wp;
  v_n = wn;
  v_uv = uv + i_uvo;
  v_paint = unpackRgb(i_paint);
  v_key = vec3(i_hsv.x, i_hsv.y + 0.8, i_hsv.z - 0.1);
  v_flags = i_flags;
}
`

const lighting = `
uniform vec3 u_light;
uniform vec3 u_fill;
uniform vec3 u_camPos;
uniform vec3 u_camDir;
uniform int u_persp;
uniform float u_uniform;

vec3 faceNormal(vec3 wp) {
  vec3 fn = normalize(cross(dFdx(wp), dFdy(wp)));
  vec3 vd = u_persp == 1 ? normalize(wp - u_camPos) : u_camDir;
  return dot(fn, vd) > 0.0 ? -fn : fn;
}

float flatShade(vec3 n) {
  if (u_uniform > 0.5) return 0.85;
  return 0.42 + 0.58 * max(0.0, dot(n, u_light)) + 0.12 * max(0.0, dot(n, u_fill));
}
`

const brdf = `
#define PI 3.14159265359

vec3 diffuseTerm(vec3 albedo) {
  return albedo / PI;
}

vec3 specularTerm(float nl, float nv, float nh, float vh, vec3 f0, float a) {
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * d * d);
  float vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-5);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  return D * vis * F;
}

float filteredAlpha(float a, float len) {
  float v = clamp((1.0 - len) / max(len, 1e-4), 0.0, 1.0);
  return sqrt(min(a * a + v, 1.0));
}

vec2 envBrdf(float roughness, float nv) {
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a004 + r.zw;
}
`

const pbr = `
uniform vec3 u_keyColor;
uniform vec3 u_fillColor;
uniform vec3 u_skyColor;
uniform vec3 u_groundColor;
uniform float u_emissive;
uniform float u_exposure;

float tone(float x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

vec3 env(vec3 dir) {
  return mix(u_groundColor, u_skyColor, smoothstep(-1.0, 1.0, dir.y));
}

vec3 directLight(vec3 lightColor, vec3 L, vec3 N, vec3 V, vec3 albedo, vec3 f0, float a) {
  float nl = max(dot(N, L), 0.0);
  float nv = max(dot(N, V), 1e-4);
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float vh = max(dot(V, H), 0.0);
  return lightColor * (diffuseTerm(albedo) + specularTerm(nl, nv, nh, vh, f0, a)) * nl;
}

vec3 shadePbr(vec3 N, vec3 base, float metal, float gloss, float len, float ao, float e) {
  vec3 albedo = base * (1.0 - metal);
  vec3 f0 = mix(vec3(0.04), base, metal);
  float roughness = 1.0 - gloss;
  float a = filteredAlpha(max(roughness * roughness, 2e-3), len);
  vec3 V = u_persp == 1 ? normalize(u_camPos - v_wp) : -u_camDir;
  vec3 rad = directLight(u_keyColor, u_light, N, V, albedo, f0, a);
  rad += directLight(u_fillColor, u_fill, N, V, albedo, f0, a);
  float nv = max(dot(N, V), 1e-4);
  rad += albedo * env(N) * ao;
  vec3 envSpec = mix(env(reflect(-V, N)), 0.5 * (u_skyColor + u_groundColor), roughness);
  vec2 AB = envBrdf(roughness, nv);
  rad += envSpec * (f0 * AB.x + AB.y) * ao;
  rad += base * e * u_emissive;
  return rad;
}
`

export const DEFAULT_CM = 'vec4(0.991102, 0.0, 0.991102, 1.0)'
export const DEFAULT_NG = 'vec4(0.498039, 0.498039, 1.0, 0.003922)'
export const DEFAULT_ADD = 'vec4(1.0, 0.0, 0.0, 0.0)'

export const modelFrag = `
layout(location = 0) out highp vec4 fragColor;
layout(location = 1) out highp vec4 fragNormal;
in vec3 v_wp;
in vec3 v_n;
in vec2 v_uv;
flat in vec3 v_paint;
flat in vec3 v_key;
flat in float v_flags;
in float v_cap;
uniform int u_style;
uniform float u_tint;
uniform float u_sel;
uniform int u_kind;
uniform vec3 u_fixed;
uniform int u_textured;
uniform vec4 u_has;
uniform int u_alphaTest;
uniform int u_metal;
uniform int u_decal;
uniform int u_cutout;
uniform sampler2D u_cm;
uniform sampler2D u_ng;
uniform sampler2D u_add;
uniform sampler2D u_am;
${color}
${lighting}
${brdf}
${pbr}

vec3 g_dp1;
vec3 g_dp2;
vec2 g_du1;
vec2 g_du2;

vec3 shadeTextured(vec3 n, vec3 fn, out float alpha) {
  vec2 uv = v_uv;
  vec4 cm = u_has.x > 0.5 ? texture(u_cm, uv) : ${DEFAULT_CM};
  vec4 ng = u_has.y > 0.5 ? texture(u_ng, uv) : ${DEFAULT_NG};
  vec4 ext = u_has.z > 0.5 ? texture(u_add, uv) : ${DEFAULT_ADD};
  alpha = u_has.w > 0.5 ? texture(u_am, uv).r : 1.0;
  float coloring = ext.a;
  if (u_metal == 0) coloring *= clamp(1.0 - clamp(cm.a - 0.4, 0.0, 1.0) / 0.3, 0.0, 1.0);
  vec3 b = cm.rgb;
  if (coloring > 0.0) {
    float value = toSrgb(max(b.r, max(b.g, b.b)));
    vec3 hsv = vec3(clamp(v_key.x, 0.0, 1.0), clamp(v_key.y, 0.0, 1.0), clamp(value + v_key.z, 0.0, 1.0));
    b += (toLin(hsv2rgb(hsv)) - b) * coloring;
  }
  vec3 dp1 = g_dp1;
  vec3 dp2 = g_dp2;
  vec2 du1 = g_du1;
  vec2 du2 = g_du2;
  float r = du1.x * du2.y - du2.x * du1.y;
  vec3 t;
  vec3 bt;
  if (abs(r) > 1e-12) {
    t = normalize((dp1 * du2.y - dp2 * du1.y) / r);
    bt = normalize((dp2 * du1.x - dp1 * du2.x) / r);
  } else {
    t = normalize(dp1);
    bt = cross(fn, t);
  }
  vec3 nm = ng.rgb * 2.0 - 1.0;
  vec3 sn = normalize(t * nm.x - bt * nm.y + n * nm.z);
  if (dot(sn, n) < 0.05) sn = n;
  float e = u_kind == 3 ? clamp(ext.g - 1.0 / 255.0, 0.0, 1.0) : 0.0;
  vec3 x = shadePbr(sn, b, cm.a, ng.a, length(nm), ext.r, e) * u_exposure;
  return toSrgb(vec3(tone(x.r), tone(x.g), tone(x.b)));
}

void main() {
  g_dp1 = dFdx(v_wp);
  g_dp2 = dFdy(v_wp);
  g_du1 = dFdx(v_uv);
  g_du2 = dFdy(v_uv);
  vec3 fn = faceNormal(v_wp);
  bool modded = (int(v_flags + 0.5) & 2) != 0;
  bool tinted = u_tint > 0.5 && modded;
  bool textured = u_style == 0 && u_textured == 1 && !tinted;
  if (u_decal == 1 && !textured) discard;
  if (textured && u_alphaTest == 1 && texture(u_am, v_uv).r < 0.5) discard;
  vec3 col;
  vec3 outN = fn;
  if (textured) {
    vec3 nn = v_n;
    if (dot(nn, fn) < 0.0) nn = -nn;
    float l = length(nn);
    nn = l > 1e-12 ? nn / l : nn;
    if (length(nn) < 0.5) nn = fn;
    float alpha;
    col = shadeTextured(nn, fn, alpha);
    outN = nn;
    if (u_decal == 1) {
      if (u_cutout == 1) alpha = alpha < 0.5 ? 0.0 : 1.0;
      fragColor = vec4(col, alpha);
      fragNormal = vec4(0.0);
      return;
    }
  } else {
    vec3 albedo = u_kind == 3 ? vec3(0.95, 0.92, 0.78) : u_kind == 2 ? u_fixed : v_paint;
    if (u_style == 2) albedo = vec3(0.8863, 0.8863, 0.898);
    else if (u_style == 3) albedo = vec3(0.949, 0.949, 0.9529);
    else if (tinted) albedo = vec3(0.5804, 0.7373, 0.8902);
    float shade = flatShade(fn);
    if (u_kind == 3 && u_style < 2 && !tinted) shade = 0.75 + 0.25 * max(0.0, dot(fn, u_light));
    col = albedo * shade;
  }
  if (u_sel > 0.5 && (int(v_flags + 0.5) & 16) != 0) col = mix(col, vec3(0.42, 0.86, 0.52), 0.3);
  if (v_cap > 0.5) col = mix(col, vec3(0.8392, 0.9216, 1.0), 0.35) * 0.97;
  fragColor = vec4(col, 1.0);
  fragNormal = vec4(outN * 0.5 + 0.5, 1.0);
}
`

export const glassFrag = `
layout(location = 0) out highp vec4 fragColor;
in vec3 v_wp;
in vec3 v_n;
in vec2 v_uv;
uniform int u_style;
uniform vec4 u_gColor;
uniform vec4 u_gAdd;
uniform float u_gRefl;
uniform float u_gFresnel;
uniform float u_gGlossAdd;
uniform float u_gLight;
uniform vec3 u_glassSky;
uniform vec3 u_glassGround;
uniform float u_inner;
uniform float u_glassDiffuse;
uniform sampler2D u_gTex;
uniform sampler2D u_gGloss;
uniform vec2 u_gHas;
${color}
${lighting}
${brdf}
${pbr}

vec3 glassSpec(vec3 lightColor, vec3 L, vec3 N, float nv, vec3 V, float a) {
  float nl = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float vh = max(dot(V, H), 0.0);
  return lightColor * specularTerm(nl, nv, nh, vh, vec3(1.0), a) * nl;
}

void main() {
  vec3 V = u_persp == 1 ? normalize(u_camPos - v_wp) : -u_camDir;
  vec3 N = normalize(v_n);
  if (dot(N, V) <= 0.0) discard;
  if (u_style != 0) {
    float al = u_inner > 0.5 ? 0.15 : 0.5;
    vec3 fl = vec3(0.17, 0.22, 0.28) * (0.55 + 0.75 * flatShade(N));
    fragColor = vec4(fl * al, al);
    return;
  }
  vec4 t = u_gHas.x > 0.5 ? texture(u_gTex, v_uv) : vec4(1.0, 1.0, 1.0, 0.0);
  float ga = u_gHas.y > 0.5 ? texture(u_gGloss, v_uv).a : 0.0;
  float g = clamp(ga + u_gGlossAdd, 0.0, 1.0);
  float roughness = 1.0 - g;
  float a = max(roughness * roughness, 2e-3);
  vec3 base = u_gColor.rgb * t.rgb;
  float cover = clamp(u_gColor.a * t.a + u_gAdd.a, 0.0, 1.0);
  vec3 diffuse = base * (env(N) + u_keyColor * max(dot(N, u_light), 0.0) / PI + u_fillColor * max(dot(N, u_fill), 0.0) / PI) * u_gLight * u_glassDiffuse;
  float nv = max(dot(N, V), 1e-4);
  vec3 R = reflect(-V, N);
  vec3 spec = mix(mix(u_glassGround, u_glassSky, smoothstep(-1.0, 1.0, R.y)), 0.5 * (u_glassSky + u_glassGround), roughness);
  spec += glassSpec(u_keyColor, u_light, N, nv, V, a);
  spec += glassSpec(u_fillColor, u_fill, N, nv, V, a);
  float w = clamp(u_gRefl + u_gFresnel * pow(1.0 - nv, 5.0), 0.0, 1.0);
  vec3 rgb = diffuse * cover + u_gAdd.rgb + spec * w;
  float alpha = clamp(max(cover, w), 0.0, 1.0);
  vec3 x = rgb / max(alpha, 1e-4) * u_exposure;
  fragColor = vec4(toSrgb(vec3(tone(x.r), tone(x.g), tone(x.b))) * alpha, alpha);
}
`

export const refBoxVert = `
in vec3 i_min;
in vec3 i_size;
in float i_color;
in float i_flags;
out vec3 v_wp;
out vec2 v_fc;
out vec2 v_sz;
flat out vec3 v_color;
flat out float v_flags;
flat out float v_cap;
uniform vec3 u_cmin;
uniform float u_mc;
${section}
${color}

void main() {
  int flags = int(i_flags + 0.5);
  vec3 c = i_min + (i_size - 1.0) * 0.5;
  vec3 lp = i_min - 0.5 + position * i_size;
  if ((flags & 8) != 0) lp = c + (lp - c) * 0.96;
  vec3 wn = mat3(modelMatrix) * normal;
  v_cap = 0.0;
  if (u_sec.x > 0.5) {
    int ax = int(u_sec.y + 0.5);
    vec3 cm = (modelMatrix * vec4(c, 1.0)).xyz;
    mat3 mm = mat3(modelMatrix);
    float h = 0.5 * (abs(mm[0][ax]) * i_size.x + abs(mm[1][ax]) * i_size.y + abs(mm[2][ax]) * i_size.z);
    float lo = floor((cm[ax] - h) / u_mc + 0.51) - u_cmin[ax];
    float hi = floor((cm[ax] + h) / u_mc - 0.49) - u_cmin[ax];
    if (!keptRange(lo, hi)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float nd = wn[ax] / max(length(wn), 1e-6);
    if (u_capHi > 0.5 && abs(nd) > 0.9) {
      float nl = nd > 0.0 ? hi + 1.0 : lo - 1.0;
      if (!keptRange(nl, nl)) v_cap = 1.0;
    }
  }
  vec4 wp = modelMatrix * vec4(lp, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  v_wp = wp.xyz;
  vec3 an = abs(normal);
  vec3 q = position * i_size;
  if (an.x > 0.5) { v_fc = q.yz; v_sz = i_size.yz; }
  else if (an.y > 0.5) { v_fc = q.xz; v_sz = i_size.xz; }
  else { v_fc = q.xy; v_sz = i_size.xy; }
  v_color = unpackRgb(i_color);
  v_flags = i_flags;
}
`

export const refBoxFrag = `
layout(location = 0) out highp vec4 fragColor;
layout(location = 1) out highp vec4 fragNormal;
in vec3 v_wp;
in vec2 v_fc;
in vec2 v_sz;
flat in vec3 v_color;
flat in float v_flags;
flat in float v_cap;
uniform int u_style;
uniform float u_tint;
uniform float u_sel;
uniform float u_px;
${lighting}

void main() {
  vec3 n = faceNormal(v_wp);
  int flags = int(v_flags + 0.5);
  bool placeholder = (flags & 1) != 0;
  bool modded = (flags & 2) != 0;
  vec3 col;
  if (placeholder) {
    col = vec3(1.0, 0.1686, 0.8392);
    vec2 d = min(v_fc, v_sz - v_fc) / max(fwidth(v_fc), vec2(1e-6));
    float e = min(d.x, d.y);
    float w = 1.2 * u_px;
    float cov = clamp(w * 0.5 - e + 0.5, 0.0, 1.0);
    float f = v_fc.x - v_fc.y;
    float g = abs(f) / max(length(vec2(dFdx(f), dFdy(f))), 1e-6);
    cov = max(cov, clamp(w * 0.5 - g + 0.5, 0.0, 1.0));
    col = mix(col, vec3(0.349, 0.502, 0.651), 0.95 * cov);
  } else {
    vec3 albedo = v_color;
    if (u_style == 2) albedo = vec3(0.8863, 0.8863, 0.898);
    else if (u_style == 3) albedo = vec3(0.949, 0.949, 0.9529);
    else if (u_tint > 0.5 && modded) albedo = vec3(0.5804, 0.7373, 0.8902);
    col = albedo * flatShade(n);
  }
  if (u_sel > 0.5 && (flags & 16) != 0) col = mix(col, vec3(0.42, 0.86, 0.52), 0.3);
  if (v_cap > 0.5) col = mix(col, vec3(0.8392, 0.9216, 1.0), 0.35) * 0.97;
  fragColor = vec4(col, 1.0);
  fragNormal = vec4(n * 0.5 + 0.5, 1.0);
}
`

export const lineVert = `
in vec3 i_a;
in vec3 i_b;
uniform vec2 u_res;
uniform float u_width;
uniform vec3 u_cmin;
uniform float u_mc;
${section}
${pull}

void main() {
  if (u_sec.x > 0.5) {
    int ax = int(u_sec.y + 0.5);
    float t = (i_a[ax] + i_b[ax]) * 0.5 / u_mc - u_cmin[ax];
    float klo = ceil(t - 0.5 - 1e-3);
    float khi = floor(t + 0.5 + 1e-3);
    if (!keptRange(klo, khi)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
  }
  vec4 a = project(i_a);
  vec4 b = project(i_b);
  if (a.w <= 0.0 || b.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 sa = a.xy / a.w * u_res * 0.5;
  vec2 sb = b.xy / b.w * u_res * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = u_width * 0.5;
  vec4 p = position.x < 0.5 ? a : b;
  vec2 s = (position.x < 0.5 ? sa - dir * hw : sb + dir * hw) + nrm * position.y * hw;
  gl_Position = vec4(s / (u_res * 0.5) * p.w, p.z, p.w);
}
`

export const lineFrag = `
layout(location = 0) out highp vec4 fragColor;
layout(location = 1) out highp vec4 fragNormal;
void main() {
  fragColor = vec4(1.0);
  fragNormal = vec4(1.0, 1.0, 1.0, 0.0);
}
`

export const quadVert = `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const linearize = `
uniform vec3 u_clip;
float linz(float d) {
  float n = u_clip.x;
  float f = u_clip.y;
  if (u_clip.z > 0.5) {
    float z = d * 2.0 - 1.0;
    return 2.0 * n * f / (f + n - z * (f - n));
  }
  return n + d * (f - n);
}
`

export const reduceFrag = `
layout(location = 0) out highp vec4 fragColor;
uniform highp sampler2D u_src;
uniform int u_first;
uniform ivec2 u_size;
${linearize}

void main() {
  ivec2 o = ivec2(gl_FragCoord.xy) * 8;
  float mn = 1e30;
  float mx = -1e30;
  for (int j = 0; j < 8; j++)
    for (int i = 0; i < 8; i++) {
      ivec2 q = o + ivec2(i, j);
      if (q.x >= u_size.x || q.y >= u_size.y) continue;
      if (u_first == 1) {
        float d = texelFetch(u_src, q, 0).r;
        if (d >= 1.0) continue;
        float z = linz(d);
        mn = min(mn, z);
        mx = max(mx, z);
      } else {
        vec2 v = texelFetch(u_src, q, 0).rg;
        mn = min(mn, v.r);
        mx = max(mx, v.g);
      }
    }
  fragColor = vec4(mn, mx, 0.0, 1.0);
}
`

export const compositeFrag = `
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D u_col;
uniform sampler2D u_nrm;
uniform highp sampler2D u_dep;
uniform highp sampler2D u_zr;
uniform vec2 u_zo;
uniform int u_useZo;
uniform float u_tol;
uniform float u_pxm;
uniform float u_mc;
uniform float u_ss;
uniform int u_line;
uniform float u_refLook;
${linearize}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(u_dep, 0);
  float d = texelFetch(u_dep, p, 0).r;
  if (d >= 1.0) discard;
  float z = linz(d);
  vec2 zr = u_useZo == 1 ? u_zo : texelFetch(u_zr, ivec2(0), 0).rg;
  float zInv = zr.y > zr.x ? 0.3 * u_refLook / (zr.y - zr.x) : 0.0;
  vec4 nr = texelFetch(u_nrm, p, 0);
  bool line = nr.a < 0.5;
  vec3 np = round(nr.rgb * 255.0);
  float cellPx = u_mc * (u_clip.z > 0.5 ? u_pxm / z : u_pxm) / u_ss;
  float fade = clamp((cellPx - 3.0) / 14.0, 0.0, 1.0);
  float cue = 1.0 - (z - zr.x) * zInv;
  float edge = (line && u_line == 0 ? 1.0 - 0.28 * fade : 1.0) * cue;
  bool flagged = false;
  for (int k = 0; k < 4; k++) {
    ivec2 q = p + (k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1));
    if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
    float dq = texelFetch(u_dep, q, 0).r;
    float zq = dq >= 1.0 ? 1e30 : linz(dq);
    if (zq - z > u_tol) {
      edge = min(edge, mix(1.0, 0.55, u_refLook));
      flagged = true;
    } else if (dq < 1.0) {
      vec3 nq = round(texelFetch(u_nrm, q, 0).rgb * 255.0);
      if (nq != np && dot(nq / 127.5 - 1.0, np / 127.5 - 1.0) < 0.8) {
        edge = min(edge, mix(1.0, 0.8, u_refLook));
        flagged = true;
      }
    }
  }
  vec3 col = texelFetch(u_col, p, 0).rgb;
  if (u_line == 1) {
    col *= cue;
    float a = max(flagged ? 0.9 : 0.0, line ? 0.9 * fade : 0.0);
    col = mix(col, vec3(0.349, 0.502, 0.651), a);
  } else {
    col *= edge;
  }
  fragColor = vec4(col, 1.0);
  gl_FragDepth = d;
}
`

export const downFrag = `
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D u_src;
uniform int u_ss;
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy) * u_ss;
  vec4 s = vec4(0.0);
  for (int j = 0; j < 4; j++)
    for (int i = 0; i < 4; i++)
      if (i < u_ss && j < u_ss) s += texelFetch(u_src, o + ivec2(i, j), 0);
  fragColor = s / float(u_ss * u_ss);
}
`
