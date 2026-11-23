// Procedural PBR material textures, generated on the GPU at load time (no image files).
// Each surface gets two seamlessly tiling RGBA8 textures with mipmaps:
//   A: rgb = sqrt(albedo) (perceptual precision for dark albedos), a = height (for blending)
//   N: rg  = tangent-space normal xy, b = roughness, a = cavity AO
// Surfaces: rock (fractured plates, cracks, grain, mineral specks), ground (moss clumps over
// soil and pebbles), sand (wind/water ripples, grains).
import * as THREE from 'three';

const FRAG = /* glsl */`
precision highp float;
uniform int uLayer;
uniform int uOut;
uniform float uSize;
uniform sampler2D tHeight;
varying vec2 vUv;
float H(vec2 uv){ return textureLod(tHeight, fract(uv), 0.0).r; }

vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float h12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// periodic gradient noise: tiles every 'per' lattice cells
float gnoise(vec2 x, float per){
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = h22(mod(i, per)) * 2.0 - 1.0, g10 = h22(mod(i + vec2(1, 0), per)) * 2.0 - 1.0;
  vec2 g01 = h22(mod(i + vec2(0, 1), per)) * 2.0 - 1.0, g11 = h22(mod(i + vec2(1, 1), per)) * 2.0 - 1.0;
  float a = dot(g00, f), b = dot(g10, f - vec2(1, 0)), c = dot(g01, f - vec2(0, 1)), d = dot(g11, f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4;
}
float fbm(vec2 uv, float base, int oct){
  float s = 0.0, a = 0.5, p = base;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * gnoise(uv * p, p); p *= 2.0; a *= 0.5; }
  return s;
}
// periodic voronoi: x = F1, y = F2, z = cell hash
vec3 voro(vec2 uv, float per){
  vec2 x = uv * per; vec2 i = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    vec2 o = vec2(float(xx), float(y)); vec2 c = mod(i + o, per);
    vec2 r = o + h22(c) * 0.9 + 0.05 - f; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h12(c); } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

struct Surf { float h; vec3 alb; float rough; };

// anisotropic periodic noise (stretched layers / bedding planes)
float fbmA(vec2 uv, vec2 base, int oct){
  float s = 0.0, a = 0.5; vec2 p = base;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; vec2 x = uv * p; vec2 ii = floor(x), f = fract(x);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float n00 = h12(mod(ii, p)), n10 = h12(mod(ii + vec2(1, 0), p)), n01 = h12(mod(ii + vec2(0, 1), p)), n11 = h12(mod(ii + vec2(1, 1), p));
    s += a * (mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 2.0 - 1.0); p *= 2.0; a *= 0.5; }
  return s;
}

Surf rock(vec2 uv){
  vec2 w = vec2(fbm(uv, 3.0, 4), fbm(uv + 0.37, 3.0, 4)) * 0.12;
  float big = fbm(uv + w, 2.0, 6);
  float layers = fbmA(uv + w * 0.5, vec2(2.0, 12.0), 4);      // bedding planes
  float fine = fbm(uv + w, 16.0, 4);
  float grain = fbm(uv, 128.0, 2);
  // sparse, irregular fractures only in part of the tile
  vec3 v = voro(uv + w * 1.5, 7.0);
  float crackMask = smoothstep(0.05, 0.35, fbm(uv + 0.53, 2.0, 3));
  float crack = (1.0 - smoothstep(0.0, 0.025 + fine * 0.01, v.y - v.x)) * crackMask;
  // chipped, pitted micro relief and sharp weathering creases
  float pits = smoothstep(0.55, 0.85, fbm(uv + 0.19, 32.0, 2) + 0.5) * 0.06;
  float crease = pow(1.0 - abs(fbm(uv + w, 6.0, 4)), 9.0);
  float chips = pow(1.0 - abs(fbm(uv + 0.77, 20.0, 3)), 12.0);
  Surf s;
  s.h = 0.5 + big * 0.34 + layers * 0.15 + fine * 0.2 + grain * 0.06 - crack * 0.26 - crease * 0.12 - chips * 0.05 - pits;
  vec3 dark = vec3(0.06, 0.07, 0.072), light = vec3(0.25, 0.258, 0.248);
  vec3 base = mix(dark, light, clamp(0.5 + big * 1.2 + layers * 0.5 + fine * 0.35, 0.0, 1.0));
  base *= 1.0 - crease * 0.35;
  base = mix(base, vec3(0.205, 0.17, 0.135), smoothstep(0.05, 0.4, fbm(uv + 0.71, 2.0, 4)) * 0.5); // iron staining
  base = mix(base, base * vec3(0.8, 0.95, 1.0), smoothstep(0.0, 0.5, layers) * 0.4);
  base *= 0.88 + fine * 0.3;
  float speck = step(0.994, h12(mod(floor(uv * 512.0), 512.0)));
  base = mix(base, vec3(0.26, 0.29, 0.28), speck * 0.35);
  base *= 1.0 - crack * 0.55 - pits * 2.0;
  s.alb = base;
  s.rough = clamp(0.8 + grain * 0.2 - speck * 0.3, 0.45, 1.0);
  return s;
}

Surf ground(vec2 uv){
  float soil = 0.28 + fbm(uv, 6.0, 5) * 0.3;
  vec3 v = voro(uv, 13.0);
  float peb = smoothstep(0.3, 0.05, v.x) * step(0.8, v.z);
  float clump = smoothstep(-0.08, 0.22, fbm(uv + 0.31, 5.0, 4));
  float fuzz = fbm(uv, 64.0, 3) * 0.5 + 0.5;
  float tuft = smoothstep(0.0, 0.5, fbm(uv + 0.11, 22.0, 3) + 0.25);
  float moss = clump * (0.45 + 0.3 * fuzz + 0.2 * tuft);
  float soilH = soil + peb * 0.32;
  float mossH = 0.22 + moss * 0.78;
  Surf s;
  s.h = max(soilH, mossH);
  float isMoss = smoothstep(-0.02, 0.04, mossH - soilH);
  vec3 soilC = mix(vec3(0.045, 0.042, 0.038), vec3(0.075, 0.068, 0.058), fbm(uv, 9.0, 3) + 0.5);
  soilC = mix(soilC, vec3(0.085, 0.09, 0.088) * (0.8 + v.z * 0.4), peb);
  vec3 mossC = mix(vec3(0.026, 0.07, 0.052), vec3(0.075, 0.14, 0.098), fuzz);
  mossC = mix(mossC, vec3(0.06, 0.12, 0.11), tuft * 0.4);
  mossC *= 0.75 + 0.35 * moss;
  s.alb = mix(soilC, mossC, isMoss);
  s.rough = mix(mix(0.9, 0.55, peb), 0.97, isMoss);
  return s;
}

Surf sand(vec2 uv){
  float warp = fbm(uv, 3.0, 3) * 0.12;
  float rip = sin((uv.x + warp) * 6.2831853 * 14.0 + sin((uv.y + warp) * 6.2831853 * 3.0) * 1.2) * 0.5 + 0.5;
  rip = pow(rip, 1.6);
  float grains = fbm(uv, 96.0, 3);
  vec3 v = voro(uv, 21.0);
  float peb = smoothstep(0.22, 0.04, v.x) * step(0.82, v.z);
  Surf s;
  s.h = 0.38 + rip * 0.22 * (0.6 + 0.4 * (fbm(uv, 4.0, 2) + 0.5)) + grains * 0.08 + peb * 0.25;
  vec3 c = mix(vec3(0.13, 0.15, 0.145), vec3(0.205, 0.215, 0.195), clamp(rip * 0.6 + grains * 0.8 + 0.3, 0.0, 1.0));
  c *= 0.88 + 0.24 * h12(mod(floor(uv * 1024.0), 1024.0));
  c = mix(c, vec3(0.09, 0.1, 0.1), peb);
  s.alb = c;
  s.rough = 0.82 - peb * 0.25;
  return s;
}

Surf eval(vec2 uv){
  uv = fract(uv);
  Surf s = Surf(0.0, vec3(0.0), 1.0);
  if (uLayer == 0) s = rock(uv);
  else if (uLayer == 1) s = ground(uv);
  else s = sand(uv);
  return s;
}

void main(){
  vec2 uv = vUv;
  Surf s = eval(uv);
  if (uOut == 0) {
    gl_FragColor = vec4(sqrt(clamp(s.alb, 0.0, 1.0)), clamp(s.h, 0.0, 1.0));
    return;
  }
  if (uOut == 2) { gl_FragColor = vec4(s.h, 0.0, 0.0, 1.0); return; } // full-precision height
  // normals and cavity from the already-rendered height (alpha of the A texture)
  float e = 1.0 / uSize;
  float hl = H(uv - vec2(e, 0.0)), hr = H(uv + vec2(e, 0.0));
  float hd = H(uv - vec2(0.0, e)), hu = H(uv + vec2(0.0, e));
  float S = uLayer == 0 ? 0.05 : uLayer == 1 ? 0.026 : 0.014;
  vec3 n = normalize(vec3(-(hr - hl) / (2.0 * e) * S, -(hu - hd) / (2.0 * e) * S, 1.0));
  float r = 7.0 * e, avg = 0.0;
  avg += H(uv + vec2(r, 0.0)) + H(uv - vec2(r, 0.0)) + H(uv + vec2(0.0, r)) + H(uv - vec2(0.0, r));
  avg += H(uv + vec2(r, r) * 0.7) + H(uv - vec2(r, r) * 0.7) + H(uv + vec2(r, -r) * 0.7) + H(uv - vec2(r, -r) * 0.7);
  avg *= 0.125;
  float ao = clamp(1.0 - (avg - s.h) * 2.6, 0.35, 1.0);
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, s.rough, ao);
}
`;

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function generateSurfaceTextures(renderer, size = 1024) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uLayer: { value: 0 }, uOut: { value: 0 }, uSize: { value: size }, tHeight: { value: null } },
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(quad);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  const out = {};
  const heightRT = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  ['rock', 'ground', 'sand'].forEach((name, layer) => {
    // full-precision height first; the normal pass reads it instead of re-evaluating the surface 9x
    mat.uniforms.uLayer.value = layer; mat.uniforms.uOut.value = 2; mat.uniforms.tHeight.value = null;
    renderer.setRenderTarget(heightRT); renderer.render(scene, cam);
    for (let o = 0; o < 2; o++) {
      const rt = new THREE.WebGLRenderTarget(size, size, {
        type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
        generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      });
      rt.texture.anisotropy = aniso;
      mat.uniforms.uLayer.value = layer;
      mat.uniforms.uOut.value = o;
      mat.uniforms.tHeight.value = o === 1 ? heightRT.texture : null;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      out[name + (o === 0 ? 'A' : 'N')] = rt.texture;
      (out._targets ||= []).push(rt);
    }
  });
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  heightRT.dispose(); mat.dispose(); quad.geometry.dispose();
  return out;
}
