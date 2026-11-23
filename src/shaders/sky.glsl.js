// Sky dome: haze gradient matched to the fog, moon with halo, ringed gas giant,
// star field, nebula band, aurora curtains and occasional meteors.
import { NOISE_GLSL } from './common.glsl.js';

export const PALETTE = {
  fog: [0.022, 0.060, 0.072],
  sunFog: [0.075, 0.150, 0.165],
  lowFog: [0.014, 0.050, 0.048],
  zenith: [0.003, 0.009, 0.022],
  mid: [0.010, 0.032, 0.050],
};
const v3 = (a) => `vec3(${a.map((x) => x.toFixed(4)).join(',')})`;

// Shared horizon/sky gradient so water reflections and fog agree with the dome.
export const SKY_BASE_GLSL = /* glsl */`
vec3 vg_skyBase(vec3 d, vec3 sunDir){
  float y = d.y;
  float sunA = pow(max(dot(d, sunDir), 0.0), 8.0);
  vec3 horizon = mix(${v3(PALETTE.fog)}, ${v3(PALETTE.sunFog)}, sunA * 0.55);
  horizon = mix(horizon, ${v3(PALETTE.lowFog)}, (1.0 - smoothstep(-0.05, 0.25, y)) * 0.3);
  vec3 col = mix(horizon, ${v3(PALETTE.mid)}, smoothstep(0.02, 0.32, y));
  col = mix(col, ${v3(PALETTE.zenith)}, smoothstep(0.28, 0.95, y));
  float sd = max(dot(d, sunDir), 0.0);
  col += vec3(0.20, 0.42, 0.46) * pow(sd, 24.0) * 0.28 + vec3(0.55, 0.85, 0.9) * pow(sd, 200.0) * 0.7;
  return col;
}
`;

export const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  vec4 p = projectionMatrix * viewMatrix * wp;
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}
`;

export const SKY_FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uPlanetDir;
uniform vec3 uRingN;
uniform vec3 uStarLight;
uniform float uTime;
uniform float uAurora;
uniform float uMeteor;
uniform float uDetail;
varying vec3 vDir;
${NOISE_GLSL}
${SKY_BASE_GLSL}

vec3 planet(vec3 d, vec3 col){
  // a dim, banded ice giant seen mostly in shadow: a thin lit crescent and a faint debris ring
  vec3 C = uPlanetDir * 1000.0; float R = 112.0;
  float b = dot(d, C); float c = dot(C, C) - R * R; float disc = b * b - c;
  float tP = 1e9;
  if (disc > 0.0) {
    tP = b - sqrt(disc);
    vec3 X = d * tP; vec3 n = normalize(X - C);
    vec3 axis = normalize(vec3(0.45, 1.0, -0.2));
    float lat = dot(n, axis);
    float swirl = vg_vnoise(vec2(lat * 7.0, atan(n.z, n.x) * 3.0)) * 2.0;
    float bands = sin(lat * 19.0 + swirl) * 0.5 + 0.5;
    vec3 pc = mix(vec3(0.07, 0.19, 0.22), vec3(0.17, 0.13, 0.27), bands);
    pc = mix(pc, vec3(0.30, 0.22, 0.16), smoothstep(0.82, 0.98, vg_vnoise(vec2(lat * 30.0, swirl))) * 0.5);
    float lit = smoothstep(-0.05, 0.6, dot(n, uStarLight));
    float rim = pow(1.0 - max(dot(n, -d), 0.0), 4.0);
    vec3 shaded = pc * (0.02 + lit * 0.42) + vec3(0.15, 0.55, 0.6) * rim * lit * 0.35;
    float edge = smoothstep(0.0, 5.0, sqrt(disc));
    col = mix(col, shaded, edge * 0.92);
  }
  float dn = dot(d, uRingN);
  if (abs(dn) > 1e-4) {
    float tR = dot(C, uRingN) / dn;
    if (tR > 0.0 && tR < tP) {
      float rr = length(d * tR - C) / R;
      if (rr > 1.5 && rr < 2.15) {
        float band = vg_vnoise(vec2(rr * 45.0, 0.5)) * 0.6 + vg_vnoise(vec2(rr * 140.0, 3.1)) * 0.4;
        float a = smoothstep(1.5, 1.58, rr) * (1.0 - smoothstep(2.0, 2.15, rr)) * (0.15 + 0.5 * band);
        vec3 rc = mix(vec3(0.16, 0.26, 0.28), vec3(0.26, 0.22, 0.30), band) * 0.35;
        col = mix(col, rc, a * 0.45);
      }
    }
  }
  return col;
}

void main(){
  vec3 d = normalize(vDir);
  vec3 col = vg_skyBase(d, uSunDir);
  float y = d.y;
  float above = smoothstep(-0.02, 0.08, y);

  if (uDetail > 0.5) {
    // galactic band: denser stars, unresolved glow, dark dust rift along the core
    vec3 bandN = normalize(vec3(0.35, 0.55, 0.76));
    float bandD = dot(d, bandN);
    float bandMask = exp(-pow(bandD / 0.3, 2.0));
    float dust = vg_vnoise3(d * 6.0 + 2.0) * 0.6 + vg_vnoise3(d * 15.0 + 5.0) * 0.4;
    float lanes = smoothstep(0.42, 0.72, dust) * exp(-pow(bandD / 0.09, 2.0));
    // star field (two densities)
    for (int L = 0; L < 2; L++) {
      float sc = L == 0 ? 180.0 : 420.0;
      float thr = (L == 0 ? 0.988 : 0.993) - bandMask * (L == 0 ? 0.006 : 0.014) * (1.0 - lanes);
      vec3 p = d * sc; vec3 id = floor(p); vec3 f = fract(p) - 0.5;
      float h = vg_hash13(id + float(L) * 17.0);
      if (h > thr) {
        vec3 off = (vec3(vg_hash13(id + 1.3), vg_hash13(id + 2.7), vg_hash13(id + 5.1)) - 0.5) * 0.5;
        float dd = length(f - off);
        float br = (h - thr) / (1.0 - thr);
        float tw = 0.65 + 0.35 * sin(uTime * (1.0 + h * 5.0) + h * 80.0);
        vec3 sc3 = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.85, 0.7), vg_hash13(id + 9.0));
        col += sc3 * smoothstep(0.14, 0.0, dd) * (0.35 + br) * tw * (L == 0 ? 2.4 : 1.3) * smoothstep(0.02, 0.3, y);
      }
    }
    float nb = vg_vnoise3(d * 3.1) * 0.55 + vg_vnoise3(d * 7.3 + 4.0) * 0.3 + vg_vnoise3(d * 15.0) * 0.15;
    vec3 glowC = mix(vec3(0.050, 0.056, 0.066), vec3(0.075, 0.062, 0.050), exp(-pow(acos(clamp(dot(d, normalize(vec3(-0.8, 0.25, 0.55))), -1.0, 1.0)) / 0.6, 2.0)));
    col += glowC * bandMask * bandMask * (0.3 + nb * 0.9) * (1.0 - lanes * 0.9) * above * 0.5;
    vec3 nebCol = mix(vec3(0.10, 0.04, 0.20), vec3(0.03, 0.16, 0.18), vg_vnoise3(d * 2.0 + 9.0));
    col += nebCol * smoothstep(0.45, 0.9, nb) * bandMask * 0.14 * above;
    // aurora curtains
    if (uAurora > 0.01 && y > 0.0) {
      float az = atan(d.z, d.x);
      float curtain = vg_fbm(vec2(az * 2.4 + uTime * 0.015, uTime * 0.04));
      float streak = vg_vnoise(vec2(az * 70.0 + curtain * 6.0, uTime * 0.25));
      float hMask = smoothstep(0.04, 0.14, y) * (1.0 - smoothstep(0.18 + curtain * 0.3, 0.6, y));
      vec3 ac = mix(vec3(0.05, 0.75, 0.55), vec3(0.45, 0.2, 0.75), smoothstep(0.1, 0.45, y));
      col += ac * hMask * smoothstep(0.42, 0.75, curtain) * (0.35 + 0.65 * streak) * uAurora * 0.55;
    }
    col = planet(d, col);
    // meteors
    if (uMeteor > 0.01 && y > 0.05) {
      vec2 uv = d.xz / (d.y + 0.35);
      for (int i = 0; i < 3; i++) {
        float slot = floor(uTime * 0.7 + float(i) * 0.37);
        float ph = fract(uTime * 0.7 + float(i) * 0.37);
        vec2 a = (vg_hash22(vec2(slot, float(i))) - 0.5) * 2.4;
        vec2 dir = normalize(vg_hash22(vec2(slot + 3.0, float(i) + 1.0)) - 0.5 + vec2(0.001));
        vec2 head = a + dir * ph * 0.9;
        vec2 rel = uv - head; float along = dot(rel, -dir); float side = abs(dot(rel, vec2(-dir.y, dir.x)));
        float trail = smoothstep(0.0, 0.004, 0.004 - side) * smoothstep(0.35, 0.0, along) * step(0.0, along);
        col += vec3(0.7, 0.95, 1.0) * trail * (1.0 - ph) * 2.5 * uMeteor;
      }
    }
  }
  // moon disc + faint 22-degree halo
  float sd = dot(d, uSunDir);
  float disc = smoothstep(0.99955, 0.99968, sd);
  float crater = vg_vnoise(d.xy * 900.0) * 0.25 + vg_vnoise(d.yz * 2300.0) * 0.12;
  col = mix(col, vec3(1.6, 2.0, 2.05) * (1.1 - crater), disc);
  float halo = exp(-pow((acos(clamp(sd, -1.0, 1.0)) - 0.384) / 0.012, 2.0));
  col += vec3(0.006, 0.013, 0.015) * halo * above;
  gl_FragColor = vec4(col, 1.0);
}
`;
