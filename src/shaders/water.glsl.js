// Water: procedural ripples + expanding ring ripples, depth-based absorption using the
// terrain height texture, sky/horizon reflection approximation, moon glitter path,
// bioluminescent shoreline and plankton sparkles.
import { NOISE_GLSL, PULSE_GLSL, HEIGHT_GLSL } from './common.glsl.js';
import { SKY_BASE_GLSL } from './sky.glsl.js';
import { SUN_SHADOW_GLSL } from '../core/uniforms.js';

export const WATER_VERT = /* glsl */`
varying vec3 vWorld;
#ifdef USE_REFLECT
uniform mat4 textureMatrix;
varying vec4 vReflUv;
#endif
#include <common>
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  #ifdef USE_REFLECT
  vReflUv = textureMatrix * vec4(position, 1.0);
  #endif
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform float uWaterLevel;
uniform float uGlow;
uniform float uWindStr;
varying vec3 vWorld;
#ifdef USE_REFLECT
uniform sampler2D tReflect;
varying vec4 vReflUv;
#endif
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}
${PULSE_GLSL}
${HEIGHT_GLSL}
${SKY_BASE_GLSL}
${SUN_SHADOW_GLSL}

vec2 ripples(vec2 p){
  vec2 g = vec2(0.0);
  vec2 cell = floor(p / 5.0);
  float h = vg_hash12(cell);
  if (h < 0.42) {
    vec2 off = (vg_hash22(cell + 3.1) - 0.5) * 2.0;
    vec2 rel = (fract(p / 5.0) - 0.5) * 5.0 - off;
    float d = length(rel);
    float life = fract(uTime * (0.18 + h * 0.3) + h * 7.0);
    float rr = life * 1.7;
    float w = exp(-pow((d - rr) * 3.5, 2.0)) * (1.0 - life) * (1.0 - life);
    g += (rel / max(d, 1e-3)) * cos((d - rr) * 14.0) * w * 0.35;
  }
  return g;
}

void main(){
  float terrainH = vg_height(vWorld.xz);
  float depth = uWaterLevel - terrainH;
  if (depth < -0.4) discard;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  float fade = 1.0 - smoothstep(30.0, 160.0, dist);

  vec2 p = vWorld.xz;
  vec2 g = vec2(0.0);
  // a calm night lake: gentle swell plus fine wind ripples that strengthen with the gusts
  float windAmt = 0.6 + 0.6 * clamp(uWindStr, 0.0, 1.5);
  g += vg_vnoised(p * 0.28 + vec2(uTime * 0.040, uTime * 0.025)).yz * 0.034;
  g += vg_vnoised(p * 0.85 - vec2(uTime * 0.070, -uTime * 0.050)).yz * 0.028 * windAmt;
  g += vg_vnoised(p * 2.4 + vec2(uTime * 0.13, uTime * 0.09)).yz * 0.022 * fade * windAmt;
  g += vg_vnoised(p * 6.5 - vec2(uTime * 0.21, uTime * 0.17)).yz * 0.014 * fade * fade * windAmt;
  g += ripples(p) * fade;
  // shore-parallel waves
  float shoreF = 1.0 - smoothstep(0.0, 1.2, depth);
  g += vec2(sin(depth * 9.0 - uTime * 1.6)) * 0.02 * shoreF;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

  if (!gl_FrontFacing) {
    // seen from below: Snell's window and total internal reflection
    vec3 nd = -n;
    float cosT = max(dot(-v, vec3(0.0, 1.0, 0.0)), 0.0);
    vec3 above = vg_skyBase(refract(-v, nd, 1.33), uSunDir) * 1.4;
    vec3 tir = vec3(0.01, 0.07, 0.08);
    gl_FragColor = vec4(mix(tir, above, smoothstep(0.62, 0.7, cosT)), 0.92);
    #include <fog_fragment>
    return;
  }

  float NdV = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 rd = reflect(-v, n);
  rd.y = abs(rd.y);
  float sunVis = vgSunVisibility(vWorld);
  #ifdef USE_REFLECT
    // true planar reflection, distorted by the ripple normal
    vec2 ruv = vReflUv.xy / vReflUv.w + vec2(n.x, n.z) * (0.018 + 0.014 * fade);
    vec3 refl = texture2D(tReflect, ruv).rgb;
  #else
    vec3 refl = vg_skyBase(rd, uSunDir);
    // approximate reflection of the dark ridge line close to the horizon
    refl *= mix(0.18, 1.0, smoothstep(0.015, 0.2, rd.y));
  #endif
  float sp = max(dot(rd, uSunDir), 0.0);
  vec3 spec = vec3(0.75, 0.95, 1.0) * (pow(sp, 1400.0) * 24.0 + pow(sp, 160.0) * 0.45 + pow(sp, 24.0) * 0.02) * sunVis;

  float absorb = 1.0 - exp(-depth * 0.32);
  vec3 shallow = vec3(0.020, 0.150, 0.140);
  vec3 deep = vec3(0.003, 0.020, 0.030);
  vec3 body = mix(shallow, deep, absorb);
  float lambert = 0.35 + 0.65 * max(dot(n, uSunDir), 0.0) * sunVis;
  body *= lambert * 0.8;

  vec3 col = mix(body, refl, fres) + spec;

  // bioluminescent shore line + plankton sparkles + resonance wave
  float foamN = vg_vnoise(p * 1.6 + vec2(uTime * 0.25, -uTime * 0.2)) * vg_vnoise(p * 0.7 - uTime * 0.1);
  float lineGlow = smoothstep(0.55, 0.0, depth) * smoothstep(0.08, 0.45, foamN + 0.15);
  vec2 sc = floor(p * 1.7);
  float sh = vg_hash12(sc);
  vec2 sOff = vg_hash22(sc + 7.7) * 0.6 + 0.2;                       // point position inside the cell
  float sDot = 1.0 - smoothstep(0.02, 0.07, length(fract(p * 1.7) - sOff));
  float sparkle = step(0.965, sh) * sDot * pow(max(sin(uTime * (1.5 + sh * 3.0) + sh * 50.0), 0.0), 12.0);
  float spMask = (1.0 - smoothstep(0.5, 6.0, depth)) * fade;
  float pulse = vg_pulse(vWorld);
  col += vec3(0.08, 0.85, 0.75) * (lineGlow * 0.55 + sparkle * spMask * 2.5) * uGlow;
  col += vec3(0.1, 0.9, 0.8) * pulse * (0.4 + spMask);

  float alpha = clamp(0.42 + absorb * 0.55 + fres * 0.4, 0.0, 0.97) * smoothstep(-0.05, 0.25, depth);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;
