// "Bio" material: MeshStandardMaterial extended with
//  - world-coherent wind gusts (per-vertex aSway weights, works with instancing),
//  - plants bending away from the player as they walk through,
//  - per-vertex bioluminescence (aGlow) that shimmers, follows the global garden glow,
//    flares when a resonance wave passes, and can be boosted per instance.
import * as THREE from 'three';
import { U, patchSunShadow } from '../core/uniforms.js';
import { PULSE_GLSL } from '../shaders/common.glsl.js';

const VERT_PARS = /* glsl */`
attribute float aGlow;
attribute float aSway;
uniform float uTime;
uniform vec4 uWind;
uniform vec3 uPlayer;
varying float vGlow;
varying vec3 vBioWorld;
varying vec3 vBioNormal;
varying float vSway;
varying float vBioPhase;
varying vec3 vInst;
varying vec3 vBioLocal;
varying vec3 vBioLocalN;
#ifdef VG_FOLIAGE
attribute vec2 aFolUv;
varying vec2 vFolUv;
#endif
`;

const COLOR_VERT = /* glsl */`
#if defined( USE_COLOR_ALPHA )
  vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vInst = instanceColor;
#else
  vInst = vec3(1.0, 0.0, 0.0);
#endif
`;

const BEGIN_VERT = /* glsl */`
#ifdef USE_INSTANCING
  mat4 vgIM = modelMatrix * instanceMatrix;
#else
  mat4 vgIM = modelMatrix;
#endif
vec3 vgInstPos = vgIM[3].xyz;
vBioPhase = dot(vgInstPos.xz, vec2(0.37, 0.71));
vGlow = aGlow;
vSway = aSway;
vBioNormal = normalize(mat3(vgIM) * objectNormal);
#ifdef VG_FOLIAGE
vFolUv = aFolUv;
#endif
#ifdef VG_WIND
{
  vec2 wd = uWind.xy; float ws = uWind.z;
  float gust = sin(dot(vgInstPos.xz, wd) * 0.045 - uTime * 0.9 + uWind.w) * 0.5 + 0.5; gust *= gust;
  float ph = vBioPhase + position.y * 0.6;
  vec3 disp = vec3(wd.x, 0.0, wd.y) * ws * (0.25 + gust * 0.85) * (0.75 + 0.25 * sin(uTime * 1.9 + ph));
  disp += vec3(cos(ph + uTime * 1.7), 0.0, sin(ph * 1.3 + uTime * 1.31)) * ws * 0.22;
  #ifdef VG_PUSH
  {
    vec3 wpv = (vgIM * vec4(transformed, 1.0)).xyz;
    vec2 tp = wpv.xz - uPlayer.xz; float pd = length(tp);
    disp.xz += tp / max(pd, 0.001) * (1.0 - smoothstep(0.2, 1.5, pd)) * 1.1 * step(wpv.y - uPlayer.y, 1.8);
  }
  #endif
  disp *= aSway;
  mat3 m3 = mat3(vgIM);
  float s2 = dot(m3[0], m3[0]);
  transformed += (transpose(m3) * disp) / max(s2, 1e-4);
}
#endif
vBioLocal = position;
vBioLocalN = objectNormal;
#ifdef USE_INSTANCING
  float vgIid = float(gl_InstanceID);
#else
  float vgIid = 0.0;
#endif
#ifdef VG_FLAP
{
  // wings: aSway = signed span position (-1 tip .. +1 tip); instance colour .b = flap effort
  float wspan = abs(aSway);
  float ph = uTime * (2.0 + vInst.b * 2.4) + vgIid * 1.913;
  float flap = sin(ph - wspan * 1.2) * (0.18 + vInst.b * 0.82);
  transformed.y += flap * pow(wspan, 1.45) * 1.05;
  transformed.x *= 1.0 - abs(flap) * 0.07 * wspan;
}
#endif
#ifdef VG_SWIM
{
  // body undulation travelling head -> tail: aSway = position along the body (0 head, 1 tail)
  float u = aSway;
  float ph = uTime * (3.0 + vInst.b * 6.0) + vgIid * 2.31;
  transformed.x += sin(ph - u * 7.0) * (0.02 + u * u * 0.18) * (0.6 + vInst.b);
}
#endif
vBioWorld = (vgIM * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */`
uniform float uTime;
uniform float uGlow;
uniform float uGlowStrength;
uniform vec3 uSunDir;
varying float vGlow;
varying vec3 vBioWorld;
varying vec3 vBioNormal;
varying float vSway;
varying float vBioPhase;
varying vec3 vInst;
${PULSE_GLSL}
#ifdef VG_TRIPLANAR
uniform sampler2D tRockA; uniform sampler2D tRockN; uniform float uTriScale; uniform float uTriStrength;
vec3 vgTriN; float vgTriRough; float vgTriAO;
vec3 vgUnpackN(vec4 t){ vec2 xy = t.rg * 2.0 - 1.0; return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))); }
#endif
#ifdef VG_FOLIAGE
uniform sampler2D tFolA; uniform sampler2D tFolN; uniform vec2 uFolSize;
varying vec2 vFolUv;
float vgLeafThick;
#endif
varying vec3 vBioLocal;
varying vec3 vBioLocalN;
#ifdef VG_SKIN
uniform sampler2D tSkin; uniform float uSkinScale;
#endif
`;

// Creature skin: mottled pattern in object space (moves with the animal), darker cavities.
const FRAG_SKIN_COLOR = /* glsl */`
#ifdef VG_SKIN
{
  vec3 lp = vBioLocal * uSkinScale;
  vec3 ln = abs(normalize(vBioLocalN));
  vec3 bw = ln * ln * ln * ln; bw /= (bw.x + bw.y + bw.z + 1e-4);
  float m = texture2D(tSkin, lp.zy).a * bw.x + texture2D(tSkin, lp.xz).a * bw.y + texture2D(tSkin, lp.xy).a * bw.z;
  float m2 = texture2D(tSkin, lp.zy * 0.27 + 0.4).a * bw.x + texture2D(tSkin, lp.xz * 0.27 + 0.4).a * bw.y + texture2D(tSkin, lp.xy * 0.27 + 0.4).a * bw.z;
  float mottle = smoothstep(0.25, 0.75, m) * 0.6 + smoothstep(0.35, 0.7, m2) * 0.4;
  // darker dorsal countershading, paler belly (object space: +y is up for every creature)
  float counter = mix(0.85, 1.12, smoothstep(0.3, -0.6, normalize(vBioLocalN).y));
  diffuseColor.rgb *= mix(0.62, 1.22, mottle) * mix(counter, 1.0, step(0.01, vGlow));
}
#endif
`;
// Soft subsurface wrap on the terminator and a cool sheen at grazing angles.
const FRAG_SKIN_LIGHT = /* glsl */`
#if defined(VG_SKIN) && NUM_DIR_LIGHTS > 0
{
  vec3 L = directionalLights[0].direction;
  float ndl = dot(normal, L);
  float wrap = clamp((ndl + 0.55) / 1.55, 0.0, 1.0) - max(ndl, 0.0);
  vec3 sss = diffuseColor.rgb * vec3(1.0, 0.82, 0.78);
  reflectedLight.directDiffuse += sss * directionalLights[0].color * wrap * 0.35 * vgSunVis;
  float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  reflectedLight.indirectSpecular += vec3(0.05, 0.11, 0.12) * rim;
}
#endif
`;

// Leaf cards: alpha-cut shape (alpha-to-coverage where MSAA exists), coverage kept under
// minification so distant foliage does not thin out, veined albedo tinted by vertex colour.
const FRAG_FOLIAGE_COLOR = /* glsl */`
#ifdef VG_FOLIAGE
{
  vec4 fa = texture2D(tFolA, vFolUv);
  vec2 fdx = dFdx(vFolUv * uFolSize), fdy = dFdy(vFolUv * uFolSize);
  float fmip = max(0.0, 0.5 * log2(max(dot(fdx, fdx), dot(fdy, fdy))));
  float alpha = clamp(fa.a * (1.0 + fmip * 0.3), 0.0, 1.0);
  if (alpha < 0.38) discard;
  diffuseColor.a = smoothstep(0.38, 0.62, alpha);
  diffuseColor.rgb *= fa.rgb * fa.rgb * 2.0;
}
#endif
`;
const FRAG_FOLIAGE_NORMAL = /* glsl */`
#ifdef VG_FOLIAGE
{
  vec4 fn = texture2D(tFolN, vFolUv);
  vgLeafThick = fn.b;
  vec3 mapN = vec3(fn.rg * 2.0 - 1.0, 0.0);
  mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));
  // tangent frame from screen-space derivatives (no tangent attribute needed)
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 st0 = dFdx(vFolUv), st1 = dFdy(vFolUv);
  vec3 Nn = normal;
  vec3 q1perp = cross(q1, Nn), q0perp = cross(Nn, q0);
  vec3 Tt = q1perp * st0.x + q0perp * st1.x;
  vec3 Bb = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(Tt, Tt), dot(Bb, Bb));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  normal = normalize(Tt * (mapN.x * sc) + Bb * (mapN.y * sc) + Nn * mapN.z);
}
#endif
`;

// Triplanar rock texture: modulates the vertex colour and supplies a detail normal.
const FRAG_TRIPLANAR_COLOR = /* glsl */`
#ifdef VG_TRIPLANAR
{
  vec3 wn = normalize(vBioNormal);
  vec3 bw = pow(abs(wn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec3 wp = vBioWorld * uTriScale;
  vec2 uvX = wp.zy, uvY = wp.xz, uvZ = wp.xy;
  vec4 a = texture2D(tRockA, uvX) * bw.x + texture2D(tRockA, uvY) * bw.y + texture2D(tRockA, uvZ) * bw.z;
  vec4 nX = texture2D(tRockN, uvX), nY = texture2D(tRockN, uvY), nZ = texture2D(tRockN, uvZ);
  vec3 tX = vgUnpackN(nX), tY = vgUnpackN(nY), tZ = vgUnpackN(nZ);
  tX = vec3(tX.xy * uTriStrength + wn.zy, abs(tX.z) * wn.x);
  tY = vec3(tY.xy * uTriStrength + wn.xz, abs(tY.z) * wn.y);
  tZ = vec3(tZ.xy * uTriStrength + wn.xy, abs(tZ.z) * wn.z);
  vgTriN = normalize(tX.zyx * bw.x + tY.xzy * bw.y + tZ.xyz * bw.z);
  vgTriRough = nX.b * bw.x + nY.b * bw.y + nZ.b * bw.z;
  vgTriAO = nX.a * bw.x + nY.a * bw.y + nZ.a * bw.z;
  vec3 detail = clamp((a.rgb * a.rgb) / 0.12, 0.25, 2.2);
  diffuseColor.rgb *= mix(vec3(1.0), detail, uTriStrength * (1.0 - step(0.01, vGlow)));
  diffuseColor.rgb *= mix(1.0, vgTriAO, 0.6 * uTriStrength);
}
#endif
`;
const FRAG_TRIPLANAR_NORMAL = /* glsl */`
#ifdef VG_TRIPLANAR
  normal = normalize((viewMatrix * vec4(vgTriN, 0.0)).xyz);
  #ifdef DOUBLE_SIDED
    normal *= faceDirection;
  #endif
#endif
`;
const FRAG_TRIPLANAR_ROUGH = /* glsl */`
#ifdef VG_TRIPLANAR
  roughnessFactor = mix(roughnessFactor, vgTriRough, 0.7 * uTriStrength);
#endif
`;

// Moonlight scattering through thin leaves, petals and membranes when backlit.
const FRAG_TRANSLUCENCY = /* glsl */`
#if defined(VG_TRANSLUCENT) && NUM_DIR_LIGHTS > 0
{
  vec3 V = normalize(cameraPosition - vBioWorld);
  float back = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 5.0);
  float wrapL = clamp(dot(-normalize(vBioNormal), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  float thin = smoothstep(0.04, 0.45, abs(vSway)) * (1.0 - step(0.01, vGlow) * 0.6);
  #ifdef VG_FOLIAGE
    thin = max(thin, vgLeafThick * 0.9);
  #endif
  // light transmitted through a leaf takes on its hue (more saturated than reflected light)
  vec3 dcol = diffuseColor.rgb;
  vec3 tcol = dcol * mix(vec3(1.0), dcol / max(max(dcol.r, dcol.g), max(dcol.b, 1e-3)), 0.75);
  reflectedLight.directDiffuse += tcol * directionalLights[0].color * (back * 0.45 + wrapL * 0.06) * thin * vgSunVis;
}
#endif
`;

// Varyings are clamped: with MSAA, a pixel partly covered by a sub-pixel triangle (a distant eye,
// berry or wing edge) is shaded at the pixel centre outside the triangle, where per-vertex values
// extrapolate far out of range (glow values of 50-80 were measured), and bloom then smears
// those pixels into bright squares.
const FRAG_EMISSIVE = /* glsl */`
{
  float vgGl = clamp(vGlow, 0.0, 2.0);
  float flick = 0.74 + 0.26 * sin(uTime * 1.6 + vBioPhase * 3.0 + vBioWorld.y * 0.8);
  float pls = vg_pulse(vBioWorld);
  float g = vgGl * (uGlowStrength * flick * uGlow + pls * 4.5);
  #ifdef VG_INSTGLOW
    g = g * clamp(vInst.r, 0.0, 4.0) + vgGl * clamp(vInst.g, 0.0, 4.0) * 7.0;
  #endif
  #ifdef USE_COLOR
    totalEmissiveRadiance += clamp(vColor.rgb, 0.0, 1.0) * g;
  #endif
}
`;
const FRAG_CLAMP_COLOR = /* glsl */`
diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0); // see FRAG_EMISSIVE: extrapolated vertex colours
`;

export function makeBioMaterial(opts = {}) {
  const {
    roughness = 0.7, metalness = 0.0, side = THREE.FrontSide, glow = 1.6, wind = true, push = false,
    instanceGlow = false, transparent = false, opacity = 1, envMapIntensity = 0.45, flatShading = false,
    triplanar = null, translucent = false, sunShadow = true, foliage = false, alphaToCoverage = false,
    flap = false, swim = false, skin = null,
  } = opts;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness, metalness, side, transparent, opacity, envMapIntensity, flatShading,
    depthWrite: opts.depthWrite ?? !transparent,
  });
  const glowU = { value: glow };
  mat.userData.glow = glowU;
  const defines = {};
  if (wind) defines.VG_WIND = 1;
  if (push) defines.VG_PUSH = 1;
  if (instanceGlow) defines.VG_INSTGLOW = 1;
  if (triplanar) defines.VG_TRIPLANAR = 1;
  if (translucent) defines.VG_TRANSLUCENT = 1;
  if (foliage) { defines.VG_FOLIAGE = 1; mat.alphaToCoverage = alphaToCoverage; }
  if (flap) defines.VG_FLAP = 1;
  if (swim) defines.VG_SWIM = 1;
  if (skin) defines.VG_SKIN = 1;
  const skinScale = { value: skin?.scale ?? 2.0 };
  const triU = { scale: { value: triplanar?.scale ?? 0.4 }, strength: { value: triplanar?.strength ?? 1 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWind = U.uWind;
    shader.uniforms.uPlayer = U.uPlayer;
    shader.uniforms.uPulse = U.uPulse;
    shader.uniforms.uPulseStr = U.uPulseStr;
    shader.uniforms.uGlow = U.uGlow;
    shader.uniforms.uSunDir = U.uSunDir;
    shader.uniforms.uGlowStrength = glowU;
    shader.uniforms.tRockA = U.tRockA; shader.uniforms.tRockN = U.tRockN;
    shader.uniforms.tFolA = U.tFolA; shader.uniforms.tFolN = U.tFolN; shader.uniforms.uFolSize = U.uFolSize;
    shader.uniforms.tSkin = U.tRockA; shader.uniforms.uSkinScale = skinScale;
    shader.uniforms.uTriScale = triU.scale; shader.uniforms.uTriStrength = triU.strength;
    shader.defines = { ...(shader.defines || {}), ...defines };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <color_vertex>', COLOR_VERT)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BEGIN_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_CLAMP_COLOR + FRAG_FOLIAGE_COLOR + FRAG_TRIPLANAR_COLOR + FRAG_SKIN_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_TRIPLANAR_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_TRIPLANAR_NORMAL + FRAG_FOLIAGE_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_TRANSLUCENCY + FRAG_SKIN_LIGHT);
    if (sunShadow) patchSunShadow(shader, 'vBioWorld');
    else shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', 'float vgSunVis = 1.0;\n#include <lights_fragment_begin>');
  };
  const key = 'vg-bio-' + Object.keys(defines).sort().join('-') + (sunShadow ? '' : '-nosun');
  mat.customProgramCacheKey = () => key;
  return mat;
}
