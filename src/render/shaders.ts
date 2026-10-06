export const boxVert = `
in vec3 i_min;
in vec3 i_size;
in float i_color;
in float i_flags;
varying vec3 v_n;
varying vec2 v_fc;
varying vec2 v_sz;
flat varying vec3 v_color;
flat varying float v_flags;
flat varying float v_cap;
uniform vec4 u_sec;
uniform vec2 u_cut;
uniform vec3 u_cmin;
uniform float u_mc;
uniform float u_capHi;

bool keptRange(float lo, float hi) {
  float cut = u_cut.x;
  float t = u_cut.y;
  bool flip = u_sec.w > 0.5;
  if (u_sec.z < 0.5) return flip ? hi >= cut : lo < cut;
  return flip ? (lo <= cut + t - 1.0 && hi >= cut) : (lo <= cut - 1.0 && hi >= cut - t);
}

void main() {
  vec3 lp = i_min - 0.5 + position * i_size;
  vec3 wn = mat3(modelMatrix) * normal;
  v_cap = 0.0;
  if (u_sec.x > 0.5) {
    int ax = int(u_sec.y + 0.5);
    vec3 cm = (modelMatrix * vec4(i_min + (i_size - 1.0) * 0.5, 1.0)).xyz;
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
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(lp, 1.0);
  v_n = wn;
  vec3 an = abs(normal);
  vec3 q = position * i_size;
  if (an.x > 0.5) { v_fc = q.yz; v_sz = i_size.yz; }
  else if (an.y > 0.5) { v_fc = q.xz; v_sz = i_size.xz; }
  else { v_fc = q.xy; v_sz = i_size.xy; }
  uint c = uint(i_color);
  v_color = vec3(float(c & 255u), float((c >> 8u) & 255u), float((c >> 16u) & 255u)) / 255.0;
  v_flags = i_flags;
}
`

export const boxFrag = `
layout(location = 0) out highp vec4 fragColor;
uniform int u_style;
uniform float u_edges;
uniform float u_tint;
uniform float u_sel;
uniform vec3 u_sun;
uniform float u_px;
varying vec3 v_n;
varying vec2 v_fc;
varying vec2 v_sz;
flat varying vec3 v_color;
flat varying float v_flags;
flat varying float v_cap;

void main() {
  vec3 n = normalize(v_n);
  bool cap = v_cap > 0.5;
  float sh = 0.52 + 0.48 * max(dot(n, u_sun), 0.0) + 0.05 * max(n.y, 0.0);
  int flags = int(v_flags + 0.5);
  bool placeholder = (flags & 1) != 0;
  bool modded = (flags & 2) != 0;
  vec3 col;
  vec4 edge = vec4(0.0);
  float lw = 0.0;
  if (placeholder) {
    col = vec3(1.0, 0.1686, 0.8392);
    edge = vec4(0.349, 0.502, 0.651, 0.95);
    lw = 1.2;
  } else if (u_style == 2) {
    vec3 paper = cap ? vec3(0.8392, 0.9216, 1.0) : vec3(0.949, 0.949, 0.9529);
    col = paper * (0.93 + 0.07 * sh);
    edge = vec4(0.349, 0.502, 0.651, 0.9);
    lw = 1.0;
  } else {
    vec3 base = u_style == 1 ? vec3(0.8863, 0.8863, 0.898) : v_color;
    if (u_tint > 0.5 && modded) base = vec3(0.5804, 0.7373, 0.8902);
    col = base * sh;
    if (cap) {
      col = mix(base, vec3(0.8392, 0.9216, 1.0), 0.35) * 0.97;
      edge = vec4(0.2549, 0.3804, 0.502, 0.85);
      lw = 1.5;
    } else if (u_edges > 0.5) {
      edge = vec4(0.0784, 0.0863, 0.0941, 0.28);
      lw = 1.5;
    }
  }
  if (u_sel > 0.5 && (flags & 16) != 0) col = mix(col, vec3(0.42, 0.86, 0.52), 0.3);
  if (edge.a > 0.0) {
    vec2 d = min(v_fc, v_sz - v_fc) / max(fwidth(v_fc), vec2(1e-6));
    float e = min(d.x, d.y);
    float cellPx = 1.0 / max(max(fwidth(v_fc.x), fwidth(v_fc.y)), 1e-6);
    edge.a *= smoothstep(2.0, 7.0, cellPx / u_px);
    float w = lw * u_px;
    float cov = clamp(w * 0.5 - e + 0.5, 0.0, 1.0);
    if (placeholder) {
      float f = v_fc.x - v_fc.y;
      float g = abs(f) / max(length(vec2(dFdx(f), dFdy(f))), 1e-6);
      cov = max(cov, clamp(w * 0.5 - g + 0.5, 0.0, 1.0));
    }
    col = mix(col, edge.rgb, edge.a * cov);
  }
  fragColor = vec4(col, 1.0);
}
`

export const bgVert = `
void main() {
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

export const bgFrag = `
layout(location = 0) out highp vec4 fragColor;
uniform int u_mode;
uniform vec2 u_res;
uniform float u_scale;
uniform vec3 u_top;
uniform vec3 u_bot;
uniform vec2 u_origin;
uniform float u_yaw;
uniform float u_pitch;
uniform samplerCube u_sky;
uniform mat3 u_view;
uniform mat3 u_skyRot;
uniform float u_tan;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 blob(vec3 col, vec2 p, vec2 c, float r, vec3 bc, float a) {
  float d = length(p - vec2(c.x, 1.0 - c.y) * u_res) / (r * max(u_res.x, u_res.y));
  return mix(col, bc, a * (1.0 - clamp(d, 0.0, 1.0)));
}

vec3 sky(vec2 p, int mode) {
  vec3 col = mode == 2 ? vec3(0.0392, 0.0588, 0.0863) : vec3(0.0275, 0.0353, 0.0471);
  float ou = u_yaw / 6.2831853;
  float ov = u_pitch * 0.12;
  vec2 q = vec2(p.x + ou * u_res.x, p.y + ov * u_res.y);
  if (mode == 2) {
    col = blob(col, p - vec2(ou, ov) * u_res * 0.5, vec2(0.7, 0.3), 0.45, vec3(0.349, 0.494, 0.639), 0.55);
    col = blob(col, p - vec2(ou, ov) * u_res * 0.5, vec2(0.2, 0.8), 0.5, vec3(0.2549, 0.3804, 0.502), 0.5);
    col = blob(col, p - vec2(ou, ov) * u_res * 0.5, vec2(0.45, 0.5), 0.25, vec3(0.5804, 0.7373, 0.8902), 0.18);
  } else {
    col = blob(col, p - vec2(ou, ov) * u_res * 0.5, vec2(0.3, 0.4), 0.4, vec3(0.1725, 0.2706, 0.3647), 0.5);
  }
  float cell = 46.0 * u_scale;
  vec2 id = floor(q / cell);
  vec2 f = q / cell - id;
  float r1 = h21(id);
  float r2 = h21(id + 17.3);
  float r3 = h21(id + 91.7);
  vec2 sp = vec2(0.2 + 0.6 * r1, 0.2 + 0.6 * r2);
  float size = (r3 * r3 * 1.6 + 0.3) * u_scale * 1.2 / cell;
  vec2 dd = abs(f - sp);
  if (max(dd.x, dd.y) < max(size, 0.5 / cell) * 0.5 + 0.5 / cell)
    col = mix(col, vec3(0.902, 0.941, 1.0), 0.35 + 0.65 * h21(id + 3.1));
  if (mode == 1) {
    float R = u_res.y * 1.2;
    vec2 c = vec2(u_res.x * 0.5 + sin(u_yaw) * u_res.x * 0.15, u_res.y * (1.95 - atan(sin(u_pitch), cos(u_pitch)) * 0.5));
    vec2 pc = vec2(p.x, u_res.y - p.y);
    float dc = length(pc - c);
    float t = clamp(length(pc - (c - vec2(0.0, R * 0.5))) / (R * 1.05), 0.0, 1.0);
    vec3 pl = t < 0.75 ? mix(vec3(0.5804, 0.7373, 0.8902), vec3(0.2549, 0.3804, 0.502), t / 0.75) : mix(vec3(0.2549, 0.3804, 0.502), vec3(0.1137, 0.1765, 0.2392), (t - 0.75) / 0.25);
    float ring = clamp(3.0 * u_scale - abs(dc - R - 3.0 * u_scale) + 0.5, 0.0, 1.0);
    if (dc < R) col = pl;
    col = mix(col, vec3(0.7098, 0.851, 0.9922), 0.55 * ring);
  }
  return col;
}

void main() {
  vec2 p = gl_FragCoord.xy + u_origin;
  vec2 uv = p / u_res;
  vec3 col;
  if (u_mode == 0) {
    col = mix(u_bot, u_top, uv.y);
  } else if (u_mode == 1) {
    col = vec3(0.949, 0.949, 0.9529);
    float st = 22.0 * u_scale;
    vec2 q = vec2(p.x, u_res.y - p.y);
    vec2 i = floor(q / st);
    vec2 fr = q - i * st;
    float lw = max(1.0, u_scale);
    float lx = fr.x < lw ? (mod(i.x, 5.0) < 0.5 ? 0.11 : 0.05) : 0.0;
    float ly = fr.y < lw ? (mod(i.y, 5.0) < 0.5 ? 0.11 : 0.05) : 0.0;
    col = mix(col, vec3(0.1137, 0.1216, 0.1255), max(lx, ly));
  } else if (u_mode == 2) {
    float d = length(p - u_res * 0.5) / (length(u_res) * 0.5);
    col = mix(vec3(0.2549, 0.3804, 0.502), vec3(0.1137, 0.1765, 0.2392), clamp(d, 0.0, 1.0));
  } else if (u_mode == 3) {
    vec2 q = floor(vec2(p.x, u_res.y - p.y) / 12.0);
    col = mod(q.x + q.y, 2.0) < 0.5 ? vec3(0.9608, 0.9608, 0.9725) : vec3(0.9059, 0.9059, 0.9176);
  } else if (u_mode == 4) {
    col = sky(p, 0);
  } else if (u_mode == 5) {
    col = sky(p, 1);
  } else if (u_mode == 6) {
    col = sky(p, 2);
  } else {
    vec2 ndc = uv * 2.0 - 1.0;
    vec3 ray = normalize(u_view * vec3(ndc.x * u_tan * u_res.x / u_res.y, ndc.y * u_tan, -1.0));
    col = texture(u_sky, u_skyRot * ray).rgb;
  }
  fragColor = vec4(col, 1.0);
}
`
