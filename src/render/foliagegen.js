// Procedural foliage atlas, drawn on the GPU at load time (no image files).
// A 4x2 grid of cells, each an alpha-cut leaf/blade design with veins and relief:
//   row 0: solid (neutral, for non-leaf geometry) · pinnate fern frond · broad veined leaf · petal
//   row 1: grass clump card · strap leaf (reeds) · small-leaf cluster (bushes) · lichen/moss tuft
// Output textures:
//   A: rgb = sqrt(albedo) (neutral-ish, tinted by vertex colours), a = coverage
//   N: rg = tangent-space normal xy, b = thickness (translucency), a = 1
import * as THREE from 'three';

export const FOLIAGE_CELL = { solid: 0, fern: 1, broad: 2, petal: 3, grass: 4, strap: 5, cluster: 6, tuft: 7 };

/** UV rectangle [u0, v0, u1, v1] of a cell (inset so mipmaps do not bleed between cells). */
export function cellRect(cell, inset = 0.03) {
  const cx = cell % 4, cy = Math.floor(cell / 4);
  const iu = inset / 4, iv = inset / 2;
  return [cx / 4 + iu, cy / 2 + iv, (cx + 1) / 4 - iu, (cy + 1) / 2 - iv];
}

const VERT = /* glsl */`
uniform vec4 uRect;
varying vec2 vUv;
void main(){ vUv = uv; vec2 p = mix(uRect.xy, uRect.zw, uv); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
precision highp float;
uniform int uCell;
uniform int uOut;
uniform float uCellPx;
varying vec2 vUv;
#define PI 3.14159265
float h11(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

struct Leaf { float a; vec3 alb; float h; float thick; };
Leaf empty(){ Leaf L; L.a = 0.0; L.alb = vec3(0.5); L.h = 0.0; L.thick = 0.0; return L; }

// lateral vein lines: t increases along the vein direction, lines where fract(t) ~ 0
float veinLines(float t, float width){ float f = fract(t); return 1.0 - smoothstep(0.0, width, min(f, 1.0 - f)); }

Leaf fern(vec2 p){
  Leaf L = empty();
  float cx = 0.5 + sin(p.y * 3.0) * 0.012;
  float rach = (1.0 - smoothstep(0.004, 0.011, abs(p.x - cx))) * step(p.y, 0.97);
  float N = 22.0;
  float best = 0.0, bu = 0.0, bacr = 0.0, bw = 1.0;
  for (int k = -2; k <= 2; k++) {
    float idx = floor(p.y * N) + float(k);
    if (idx < 0.0 || idx >= N) continue;
    for (int s = 0; s < 2; s++) {
      float sd = s == 0 ? -1.0 : 1.0;
      float y0 = (idx + 0.5 + sd * 0.25) / N;                  // alternate pinnae
      float env = pow(sin(PI * pow(clamp(y0, 0.0, 1.0), 0.7)), 0.7);
      float len = 0.47 * env * (1.0 - y0 * 0.35) + 0.015;
      vec2 base = vec2(cx, y0);
      // pinnae sweep toward the tip and curve slightly
      vec2 dir = normalize(vec2(sd, 0.62));
      vec2 q = p - base;
      float along = dot(q, dir);
      float across = dot(q, vec2(-dir.y, dir.x)) - sd * along * along * 0.35;
      if (along < -0.004 || along > len) continue;
      float u = clamp(along / len, 0.0, 1.0);
      // narrow, tapering pinna with fine rounded lobes (pinnules)
      float w = 0.021 * pow(sin(PI * pow(u, 0.45)), 0.75) * (1.0 + 0.12 * sin(u * 70.0 + idx * 2.0));
      float a = 1.0 - smoothstep(-0.002, 0.002, abs(across) - w);
      if (a > best) { best = a; bu = u; bacr = across; bw = max(w, 1e-4); }
    }
  }
  L.a = max(best, rach);
  float mid = 1.0 - smoothstep(0.0, 0.35, abs(bacr) / bw);
  L.h = best * (0.55 + 0.45 * (1.0 - abs(bacr) / bw)) - mid * 0.12 * best + rach * 0.9;
  vec3 c = mix(vec3(0.40, 0.52, 0.40), vec3(0.58, 0.62, 0.44), bu * 0.7);
  c = mix(c, vec3(0.60, 0.66, 0.52), mid * 0.5 * best);
  c = mix(c, vec3(0.34, 0.40, 0.32), rach);
  c *= 0.85 + 0.3 * fbm(p * 40.0);
  L.alb = c; L.thick = 0.85;
  return L;
}

Leaf broad(vec2 p){
  Leaf L = empty();
  float y = p.y, x = p.x - 0.5;
  float w = 0.44 * pow(max(sin(PI * pow(clamp(y, 0.0, 1.0), 0.72)), 0.0), 0.85) * (1.0 - 0.18 * y);
  w += sin(y * 75.0) * 0.005 * smoothstep(0.08, 0.2, y);
  float a = (1.0 - smoothstep(-0.003, 0.003, abs(x) - w)) * step(0.02, y) * step(y, 0.99);
  float pet = (1.0 - smoothstep(0.006, 0.012, abs(x))) * step(y, 0.1);
  L.a = max(a, pet);
  float midrib = 1.0 - smoothstep(0.0, 0.012, abs(x));
  float lat = veinLines((y - abs(x) * 0.85) * 9.0, 0.06) * smoothstep(0.02, 0.05, abs(x)) * (1.0 - smoothstep(0.85, 1.0, abs(x) / max(w, 1e-3)));
  float fine = veinLines((y + abs(x) * 1.6) * 34.0, 0.08) * 0.35;
  L.h = a * (0.6 - (abs(x) / max(w, 1e-3)) * 0.25) + midrib * 0.35 - lat * 0.12 - fine * 0.04;
  vec3 c = mix(vec3(0.42, 0.52, 0.42), vec3(0.50, 0.58, 0.46), fbm(p * 8.0));
  c = mix(c, vec3(0.64, 0.68, 0.54), max(midrib, lat * 0.7));
  c *= 1.0 - smoothstep(0.75, 1.0, abs(x) / max(w, 1e-3)) * 0.25; // darker rim
  L.alb = c; L.thick = 0.7;
  return L;
}

Leaf petal(vec2 p){
  Leaf L = empty();
  float y = p.y, x = p.x - 0.5;
  float w = 0.47 * pow(max(sin(PI * pow(clamp(y, 0.0, 1.0), 0.55)), 0.0), 0.6);
  w *= 1.0 + 0.04 * sin(y * 30.0) * smoothstep(0.7, 1.0, y);
  float a = (1.0 - smoothstep(-0.003, 0.003, abs(x) - w)) * step(0.01, y) * step(y, 0.99);
  float ang = atan(x, y + 0.05);
  float veins = pow(abs(sin(ang * 22.0)), 14.0) * smoothstep(0.05, 0.3, y);
  L.a = a;
  L.h = a * (0.55 - x * x * 1.5) - veins * 0.06;
  vec3 c = mix(vec3(0.40, 0.48, 0.50), vec3(0.62, 0.64, 0.66), y);
  c = mix(c, vec3(0.72, 0.74, 0.76), veins * 0.6);
  c *= 0.9 + 0.2 * fbm(p * 20.0);
  L.alb = c; L.thick = 1.0;
  return L;
}

Leaf grass(vec2 p){
  Leaf L = empty();
  for (int i = 0; i < 11; i++) {
    float fi = float(i);
    float hgt = 0.5 + h11(fi + 1.0) * 0.48;
    if (p.y > hgt) continue;
    float t = p.y / hgt;
    float x0 = 0.5 + (h11(fi + 7.3) - 0.5) * 0.42;
    float lean = (h11(fi + 3.1) - 0.5) * 0.45;
    float curve = (h11(fi + 5.7) - 0.5) * 0.35;
    float xc = x0 + lean * t + curve * t * t;
    float w = 0.024 * pow(1.0 - t, 0.75) + 0.0015;
    float d = abs(p.x - xc) - w;
    float a = 1.0 - smoothstep(-0.002, 0.002, d);
    if (a > L.a) {
      L.a = a;
      float across = (p.x - xc) / max(w, 1e-4);
      L.h = 0.6 - abs(across) * 0.4 + (1.0 - smoothstep(0.0, 0.25, abs(across))) * 0.2;
      float dry = step(0.82, h11(fi + 11.0));
      vec3 c = mix(vec3(0.38, 0.50, 0.38), vec3(0.56, 0.62, 0.44), t);
      c = mix(c, vec3(0.58, 0.54, 0.40), dry * 0.6);
      c *= 0.8 + 0.35 * h11(fi + 2.0);
      L.alb = c;
    }
  }
  L.thick = 0.9;
  return L;
}

Leaf strap(vec2 p){
  Leaf L = empty();
  float y = p.y, x = p.x - 0.5;
  float w = 0.34 * pow(max(1.0 - y, 0.0), 0.55) * smoothstep(0.0, 0.05, y);
  float a = (1.0 - smoothstep(-0.003, 0.003, abs(x) - w)) * step(y, 0.995);
  float ribs = pow(abs(sin(x / max(w, 1e-3) * 7.0)), 6.0);
  L.a = a;
  L.h = a * (0.6 - abs(x) / max(w, 1e-3) * 0.3) - ribs * 0.05;
  vec3 c = mix(vec3(0.40, 0.50, 0.40), vec3(0.58, 0.60, 0.44), y);
  c *= 0.85 + 0.25 * fbm(vec2(x * 30.0, y * 4.0));
  L.alb = c; L.thick = 0.75;
  return L;
}

Leaf cluster(vec2 p){
  Leaf L = empty();
  vec2 c0 = vec2(0.5, 0.5);
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float ang = fi / 16.0 * 2.0 * PI + h11(fi) * 0.6;
    float r = 0.06 + h11(fi + 3.0) * 0.22;
    vec2 base = c0 + vec2(cos(ang), sin(ang)) * r;
    vec2 dir = normalize(vec2(cos(ang), sin(ang)) + vec2(0.0, 0.25));
    float len = 0.12 + h11(fi + 5.0) * 0.1;
    vec2 q = p - base;
    float along = dot(q, dir), across = dot(q, vec2(-dir.y, dir.x));
    if (along < 0.0 || along > len) continue;
    float u = along / len;
    float w = len * 0.42 * sin(PI * pow(u, 0.7));
    float a = 1.0 - smoothstep(-0.003, 0.003, abs(across) - w);
    if (a > L.a) {
      L.a = a;
      float rel = abs(across) / max(w, 1e-4);
      L.h = 0.5 + (1.0 - rel) * 0.4 + fi * 0.01;
      vec3 c = mix(vec3(0.40, 0.50, 0.42), vec3(0.54, 0.60, 0.46), h11(fi + 9.0));
      c = mix(c, c * 1.25, 1.0 - smoothstep(0.0, 0.2, rel)); // midrib
      c *= 1.0 - smoothstep(0.7, 1.0, rel) * 0.2;
      L.alb = c;
    }
  }
  // twigs
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ang = fi / 5.0 * 2.0 * PI + 0.4;
    vec2 a0 = c0, a1 = c0 + vec2(cos(ang), sin(ang)) * 0.22;
    vec2 pa = p - a0, ba = a1 - a0; float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * hh);
    float tw = 1.0 - smoothstep(0.004, 0.008, d);
    if (tw > L.a * 0.5 && L.a < 0.5) { L.a = max(L.a, tw); L.alb = vec3(0.30, 0.28, 0.24); L.h = 0.3; }
  }
  L.thick = 0.6;
  return L;
}

Leaf tuft(vec2 p){
  Leaf L = empty();
  // hanging lichen / moss strands
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float x0 = 0.1 + h11(fi) * 0.8;
    float len = 0.4 + h11(fi + 2.0) * 0.55;
    float t = (1.0 - p.y) / len;
    if (t < 0.0 || t > 1.0) continue;
    float xc = x0 + sin(t * 6.0 + fi) * 0.02 * t;
    float w = 0.012 * (1.0 - t * 0.6);
    float a = 1.0 - smoothstep(-0.002, 0.002, abs(p.x - xc) - w);
    a *= step(0.25, vnoise(vec2(fi * 3.0, t * 40.0)) + t * 0.0 + 0.3);
    if (a > L.a) { L.a = a; L.h = 0.5; L.alb = mix(vec3(0.42, 0.50, 0.44), vec3(0.6, 0.62, 0.52), t); }
  }
  L.thick = 0.9;
  return L;
}

Leaf evalCell(vec2 p){
  Leaf L = empty();
  if (uCell == 0) { L.a = 1.0; L.alb = vec3(0.5); L.h = 0.5; L.thick = 0.0; }
  else if (uCell == 1) L = fern(p);
  else if (uCell == 2) L = broad(p);
  else if (uCell == 3) L = petal(p);
  else if (uCell == 4) L = grass(p);
  else if (uCell == 5) L = strap(p);
  else if (uCell == 6) L = cluster(p);
  else L = tuft(p);
  return L;
}

void main(){
  vec2 p = vUv;
  Leaf L = evalCell(p);
  if (uOut == 0) {
    // dilate colour into transparent texels so mip edges do not darken
    gl_FragColor = vec4(sqrt(clamp(L.alb, 0.0, 1.0)), clamp(L.a, 0.0, 1.0));
    return;
  }
  float e = 1.5 / uCellPx;
  float hx = evalCell(p + vec2(e, 0.0)).h - evalCell(p - vec2(e, 0.0)).h;
  float hy = evalCell(p + vec2(0.0, e)).h - evalCell(p - vec2(0.0, e)).h;
  vec3 n = normalize(vec3(-hx / (2.0 * e) * 0.012, -hy / (2.0 * e) * 0.012, 1.0));
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, L.thick, 1.0);
}
`;

export function generateFoliageAtlas(renderer, cellPx = 512) {
  const W = cellPx * 4, H = cellPx * 2;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uCell: { value: 0 }, uOut: { value: 0 }, uCellPx: { value: cellPx }, uRect: { value: new THREE.Vector4() } },
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevTone = renderer.toneMapping;
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.toneMapping = THREE.NoToneMapping;
  const out = {};
  for (let o = 0; o < 2; o++) {
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    renderer.setRenderTarget(rt);
    // transparent texels carry a mid-green colour / flat normal so filtered edges stay clean
    if (o === 0) renderer.setClearColor(new THREE.Color(0.66, 0.74, 0.64), 0); else renderer.setClearColor(new THREE.Color(0.5, 0.5, 0.5), 1);
    renderer.clear();
    renderer.autoClear = false;
    for (let c = 0; c < 8; c++) {
      const cx = c % 4, cy = Math.floor(c / 4);
      mat.uniforms.uCell.value = c; mat.uniforms.uOut.value = o;
      mat.uniforms.uRect.value.set(cx / 4, cy / 2, (cx + 1) / 4, (cy + 1) / 2);
      renderer.render(scene, cam);
    }
    renderer.autoClear = prevAuto;
    out[o === 0 ? 'folA' : 'folN'] = rt.texture;
    (out._targets ||= []).push(rt);
  }
  // generateMipmaps runs on setRenderTarget switch; force it for the last target
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.toneMapping = prevTone;
  mat.dispose(); quad.geometry.dispose();
  out.size = new THREE.Vector2(W, H);
  return out;
}
