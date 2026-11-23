// GLSL helpers shared by terrain, vegetation, water, sky and particles.
export const NOISE_GLSL = /* glsl */`
float vg_hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 vg_hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vg_hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vg_vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = vg_hash12(i), b = vg_hash12(i + vec2(1.0, 0.0)), c = vg_hash12(i + vec2(0.0, 1.0)), d = vg_hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// value noise + analytic derivative (x = value, yz = d/dx, d/dy)
vec3 vg_vnoised(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); vec2 du = 6.0 * f * (1.0 - f);
  float a = vg_hash12(i), b = vg_hash12(i + vec2(1.0, 0.0)), c = vg_hash12(i + vec2(0.0, 1.0)), d = vg_hash12(i + vec2(1.0, 1.0));
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
float vg_fbm(vec2 p){
  float s = 0.0, a = 0.5; mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) { s += a * vg_vnoise(p); p = m * p * 2.03 + 11.7; a *= 0.5; }
  return s / 0.9375;
}
float vg_vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = vg_hash13(i), n100 = vg_hash13(i + vec3(1,0,0)), n010 = vg_hash13(i + vec3(0,1,0)), n110 = vg_hash13(i + vec3(1,1,0));
  float n001 = vg_hash13(i + vec3(0,0,1)), n101 = vg_hash13(i + vec3(1,0,1)), n011 = vg_hash13(i + vec3(0,1,1)), n111 = vg_hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
`;

export const PULSE_GLSL = /* glsl */`
uniform vec4 uPulse; uniform float uPulseStr;
float vg_pulse(vec3 wp){
  float d = length(wp.xz - uPulse.xz);
  float w = 3.0 + uPulse.w * 0.04;
  float ring = exp(-pow((d - uPulse.w) / w, 2.0));
  float wake = (1.0 - smoothstep(0.0, uPulse.w + 0.01, d)) * 0.25; // afterglow inside the ring
  return (ring + wake) * uPulseStr;
}
`;

// Height-map lookup on the GPU (manual bilinear so float-linear filtering is not required)
export const HEIGHT_GLSL = /* glsl */`
uniform sampler2D uHeightTex; uniform vec3 uHeightInfo; // x = half size, y = cell size, z = resolution
float vg_height(vec2 xz){
  vec2 f = clamp((xz + uHeightInfo.x) / uHeightInfo.y, vec2(0.0), vec2(uHeightInfo.z - 1.001));
  ivec2 i = ivec2(floor(f)); vec2 t = fract(f);
  float a = texelFetch(uHeightTex, i, 0).r, b = texelFetch(uHeightTex, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeightTex, i + ivec2(0, 1), 0).r, d = texelFetch(uHeightTex, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
`;
