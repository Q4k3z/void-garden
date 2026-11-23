// Uniforms shared by every custom material. Objects are shared by reference, so
// updating `.value` once per frame updates all programs.
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector4(0.8, 0.6, 0.55, 0) }, // xy dir, z strength, w gust phase
  uPulse: { value: new THREE.Vector4(0, -999, 0, 0) },    // xyz origin, w radius of resonance wave
  uPulseStr: { value: 0 },
  uPlayer: { value: new THREE.Vector3() },
  uWaterLevel: { value: 0 },
  uGlow: { value: 1 },          // global bioluminescence multiplier (garden awakening)
  uSunDir: { value: new THREE.Vector3(0.3, 0.45, -0.8).normalize() },
  // procedural PBR surface textures (render/texgen.js)
  tRockA: { value: null }, tRockN: { value: null },
  tGroundA: { value: null }, tGroundN: { value: null },
  tSandA: { value: null }, tSandN: { value: null },
  // procedural foliage atlas (render/foliagegen.js)
  tFolA: { value: null }, tFolN: { value: null }, uFolSize: { value: new THREE.Vector2(2048, 1024) },
  // baked long-range terrain shadow: R = height above which a point sees the moon
  uSunShadow: { value: null },
  uSunShadowInfo: { value: new THREE.Vector2(320, 640) }, // half size, size
  // cave tunnel volume (terrain fragments inside it are discarded): A = x, z, dirX, dirZ; B = length, halfWidth, floorY, height
  uCaveA: { value: new THREE.Vector4(0, 0, 1, 0) },
  uCaveB: { value: new THREE.Vector4(0, 0, 0, 0) },
};

/** GLSL: moon visibility from the baked terrain shadow height map. */
export const SUN_SHADOW_GLSL = /* glsl */`
uniform sampler2D uSunShadow;
uniform vec2 uSunShadowInfo;
float vgSunVisibility(vec3 wp){
  vec2 uv = (wp.xz + uSunShadowInfo.x) / uSunShadowInfo.y;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  float s = texture2D(uSunShadow, uv).r;          // shadow plane height (m)
  float soft = 0.7 + abs(s - wp.y) * 0.06;
  return smoothstep(s - soft, s + soft, wp.y);
}
`;

/** Patch MeshStandardMaterial lighting so the moon is dimmed by the baked terrain shadow. */
export function patchSunShadow(shader, worldExpr) {
  const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(/getDirectionalLightInfo\([^;]*\);/, (m) => `${m}\n\t\tdirectLight.color *= vgSunVis;`);
  if (chunk === THREE.ShaderChunk.lights_fragment_begin) console.warn('VOID GARDEN: sun-shadow patch did not apply');
  shader.uniforms.uSunShadow = U.uSunShadow;
  shader.uniforms.uSunShadowInfo = U.uSunShadowInfo;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + SUN_SHADOW_GLSL)
    .replace('#include <lights_fragment_begin>', `float vgSunVis = vgSunVisibility(${worldExpr});\n${chunk}`);
}
