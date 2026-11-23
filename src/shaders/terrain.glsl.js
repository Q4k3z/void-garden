// Terrain surface shading, injected into MeshStandardMaterial so it keeps PBR lighting,
// shadow maps, the bio-light pool and the custom height fog.
// Layers: rock (triplanar, so cliffs never stretch), moss/soil ground (two-scale sampling
// against visible tiling), shore sand. Layers are height-blended using each texture's
// height channel, so moss fills rock crevices first and sand settles between pebbles.
import { NOISE_GLSL, PULSE_GLSL } from './common.glsl.js';

export const TERRAIN_VERT_PARS = /* glsl */`
attribute float aAO;
attribute float aMoist;
varying vec3 vTWorld;
varying vec3 vTNormal;
varying float vTAO;
varying float vTMoist;
`;

export const TERRAIN_VERT_MAIN = /* glsl */`
vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTNormal = normalize(mat3(modelMatrix) * objectNormal);
vTAO = aAO;
vTMoist = aMoist;
`;

export const TERRAIN_FRAG_PARS = /* glsl */`
varying vec3 vTWorld;
varying vec3 vTNormal;
varying float vTAO;
varying float vTMoist;
uniform float uTime;
uniform float uWaterLevel;
uniform float uGlow;
uniform sampler2D tRockA; uniform sampler2D tRockN;
uniform sampler2D tGroundA; uniform sampler2D tGroundN;
uniform sampler2D tSandA; uniform sampler2D tSandN;
uniform vec4 uCaveA; uniform vec4 uCaveB;
${NOISE_GLSL}
${PULSE_GLSL}
float tRockW; float tWet; float tUnder; float tFade; float tVeinMask; float tRough; float tTexAO;
vec3 tNormalW;

vec3 unpackN(vec4 t){ vec2 xy = t.rg * 2.0 - 1.0; return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))); }
`;

// Runs after <color_fragment>: albedo, roughness and the world-space shading normal.
export const TERRAIN_FRAG_COLOR = /* glsl */`
{
  vec3 wp = vTWorld;
  vec3 wn = normalize(vTNormal);
  float slope = 1.0 - wn.y;
  float dist = length(wp - cameraPosition);
  tFade = 1.0 - smoothstep(50.0, 210.0, dist);
  #ifdef VG_BACKDROP
    if (max(abs(wp.x), abs(wp.z)) < 318.5) discard;
  #else
    // open the hillside where the cave tunnel runs (the rock shell mesh forms its walls)
    if (uCaveB.x > 0.0) {
      vec2 rel = wp.xz - uCaveA.xy;
      float al = dot(rel, uCaveA.zw);
      float sd = abs(-rel.x * uCaveA.w + rel.y * uCaveA.z);
      if (al > 0.3 && al < uCaveB.x && sd < uCaveB.y * 0.95 && wp.y < uCaveB.z + al * 0.03 + uCaveB.w * 0.95) discard;
    }
  #endif
  float nBroad = vg_fbm(wp.xz * 0.031);
  float nMid = vg_vnoise(wp.xz * 0.23);

  // ---- layer masks from geometry
  tRockW = smoothstep(0.26, 0.48, slope + (nMid - 0.5) * 0.22);
  float shore = (1.0 - smoothstep(0.15, 1.6, abs(wp.y - uWaterLevel - 0.35) + nMid * 0.7)) * (1.0 - tRockW);
  float highW = smoothstep(58.0, 92.0, wp.y + nBroad * 14.0);

  vec3 albedo; vec3 nrm = wn; float rough = 0.9; float tao = 1.0;
  if (dist < 520.0) {
    // ---- rock: triplanar
    vec3 bw = pow(abs(wn), vec3(5.0)); bw /= (bw.x + bw.y + bw.z);
    // two scales (the large one rotated) so the rock never reads as a repeating tile
    float rs = 0.19, rs2 = 0.047;
    mat2 rot = mat2(0.6, -0.8, 0.8, 0.6);
    vec2 uvX = wp.zy * rs, uvY = wp.xz * rs, uvZ = wp.xy * rs;
    vec2 uvX2 = rot * wp.zy * rs2 + 0.31, uvY2 = rot * wp.xz * rs2 + 0.57, uvZ2 = rot * wp.xy * rs2 + 0.13;
    vec4 rA1 = texture2D(tRockA, uvX) * bw.x + texture2D(tRockA, uvY) * bw.y + texture2D(tRockA, uvZ) * bw.z;
    vec4 rA2 = texture2D(tRockA, uvX2) * bw.x + texture2D(tRockA, uvY2) * bw.y + texture2D(tRockA, uvZ2) * bw.z;
    // detail-overlay combination keeps full contrast (averaging two patterns would wash it out)
    float l2 = dot(rA2.rgb * rA2.rgb, vec3(0.3333));
    vec4 rA = vec4(sqrt(rA1.rgb * rA1.rgb * clamp(l2 / 0.12, 0.45, 1.9)), mix(rA1.a, rA2.a, 0.45));
    vec4 nX = mix(texture2D(tRockN, uvX), texture2D(tRockN, uvX2), 0.35);
    vec4 nY = mix(texture2D(tRockN, uvY), texture2D(tRockN, uvY2), 0.35);
    vec4 nZ = mix(texture2D(tRockN, uvZ), texture2D(tRockN, uvZ2), 0.35);
    vec3 tX = unpackN(nX), tY = unpackN(nY), tZ = unpackN(nZ);
    tX.xy *= 1.7; tY.xy *= 1.7; tZ.xy *= 1.7;
    tX = vec3(tX.xy + wn.zy, abs(wn.x)); tY = vec3(tY.xy + wn.xz, abs(wn.y)); tZ = vec3(tZ.xy + wn.xy, abs(wn.z));
    vec3 rockN = normalize(tX.zyx * bw.x * vec3(sign(wn.x), 1.0, 1.0) + tY.xzy * bw.y * vec3(1.0, sign(wn.y), 1.0) + tZ.xyz * bw.z * vec3(1.0, 1.0, sign(wn.z)));
    float rockR = nX.b * bw.x + nY.b * bw.y + nZ.b * bw.z;
    float rockAO = nX.a * bw.x + nY.a * bw.y + nZ.a * bw.z;
    vec3 rockC = rA.rgb * rA.rgb;
    // broad strata tint so cliffs keep geological banding (fades with distance)
    float farFade = 1.0 - smoothstep(60.0, 300.0, dist);
    float strata = sin(wp.y * 0.95 + nBroad * 6.0 + vg_vnoise(wp.xz * 0.07) * 4.8);
    rockC *= 0.85 + 0.25 * strata * mix(0.3, 1.0, farFade);
    rockC = mix(rockC, rockC * vec3(1.15, 0.98, 0.85), smoothstep(0.62, 0.95, vg_vnoise(vec2(wp.y * 0.33, (wp.x + wp.z) * 0.021))) * 0.6);

    // ---- ground: two scales + rotation to break tiling
    vec2 g1 = wp.xz * 0.33;
    vec2 g2 = mat2(0.8, -0.6, 0.6, 0.8) * wp.xz * 0.083 + 0.37;
    vec4 gA1 = texture2D(tGroundA, g1), gA2 = texture2D(tGroundA, g2);
    vec4 gN1 = texture2D(tGroundN, g1), gN2 = texture2D(tGroundN, g2);
    float gmix = 0.35 + 0.3 * nMid;
    vec4 gA = mix(gA1, gA2, gmix); vec4 gN = mix(gN1, gN2, gmix);
    vec3 groundC = gA.rgb * gA.rgb;
    // moisture: wetter ground is greener and darker, dry ground is dustier
    groundC = mix(groundC * vec3(1.15, 1.0, 0.95), groundC * vec3(0.85, 1.08, 1.0), smoothstep(0.2, 0.75, vTMoist));
    groundC *= 0.75 + 0.5 * nBroad;
    groundC = mix(groundC, vec3(0.22, 0.235, 0.225), highW * 0.55);
    vec3 tg = unpackN(gN);
    tg.xy *= 1.3;
    vec3 groundN = normalize(vec3(tg.x + wn.x, wn.y * tg.z, tg.y + wn.z));

    // ---- sand
    vec2 s1 = wp.xz * 0.45;
    vec4 sA = texture2D(tSandA, s1), sN = texture2D(tSandN, s1);
    vec3 sandC = sA.rgb * sA.rgb;
    vec3 ts = unpackN(sN);
    vec3 sandN = normalize(vec3(ts.x + wn.x, wn.y * ts.z, ts.y + wn.z));

    // ---- height blend
    float hr = rA.a + tRockW * 1.2 - (1.0 - tRockW) * 0.6;
    float hs = sA.a + shore * 1.1 - 0.5;
    float hg = gA.a + (1.0 - tRockW) * (1.0 - shore) * 0.9 - 0.2;
    // moss creeps over the tops of gentler rock
    hg = max(hg, gA.a + (1.0 - smoothstep(0.32, 0.6, slope)) * smoothstep(0.3, 0.8, vTMoist) * 0.6 - 0.25);
    float m = max(hr, max(hg, hs)) - 0.18;
    float wr = max(hr - m, 0.0), wg = max(hg - m, 0.0), ws = max(hs - m, 0.0);
    float wsum = wr + wg + ws + 1e-4; wr /= wsum; wg /= wsum; ws /= wsum;
    albedo = rockC * wr + groundC * wg + sandC * ws;
    nrm = normalize(rockN * wr + groundN * wg + sandN * ws);
    rough = rockR * wr + gN.b * wg + sN.b * ws;
    tao = rockAO * wr + gN.a * wg + sN.a * ws;
    tRockW = wr;
    // fade texture detail into the macro colour far away (avoids shimmer)
    float texFade = smoothstep(260.0, 500.0, dist);
    vec3 macro = mix(mix(vec3(0.045, 0.085, 0.072), vec3(0.15, 0.165, 0.16), tRockW), vec3(0.22, 0.235, 0.225), highW * 0.5);
    albedo = mix(albedo, macro, texFade);
    nrm = normalize(mix(nrm, wn, texFade));
  } else {
    albedo = mix(mix(vec3(0.045, 0.085, 0.072), vec3(0.15, 0.165, 0.16), tRockW), vec3(0.22, 0.235, 0.225), highW * 0.5);
  }

  tWet = 1.0 - smoothstep(0.0, 1.4, wp.y - uWaterLevel);
  albedo *= 1.0 - tWet * 0.45;
  tUnder = clamp((uWaterLevel - wp.y) / 5.0, 0.0, 1.0);
  albedo = mix(albedo, vec3(0.012, 0.06, 0.068), tUnder * 0.85);
  albedo *= mix(0.55, 1.0, vTAO) * mix(0.6, 1.0, tao);
  diffuseColor.rgb = albedo;
  tNormalW = nrm;
  tRough = mix(rough, 0.25, tWet * 0.8);
  tTexAO = tao;
  tVeinMask = smoothstep(0.35, 0.85, vTMoist) * (1.0 - tRockW) * (1.0 - tUnder) * tFade;
}
`;

export const TERRAIN_FRAG_ROUGH = /* glsl */`
roughnessFactor = tRough;
`;

// Runs after <normal_fragment_maps>: use the blended texture normal.
export const TERRAIN_FRAG_NORMAL = /* glsl */`
normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);
`;

export const TERRAIN_FRAG_AO = /* glsl */`
reflectedLight.indirectDiffuse *= vTAO * tTexAO;
reflectedLight.indirectSpecular *= vTAO * tTexAO;
`;

// Mycelium veins following the drainage network; they flare as resonance waves pass.
export const TERRAIN_FRAG_EMISSIVE = /* glsl */`
{
  vec3 wp = vTWorld;
  vec2 q = wp.xz * 0.11 + vec2(vg_vnoise(wp.xz * 0.045) * 4.0, vg_vnoise(wp.xz * 0.045 + 7.0) * 4.0);
  float vl = abs(vg_vnoise(q) - 0.5) * 2.0;
  float vein = 1.0 - smoothstep(0.0, 0.06, vl);
  float flick = 0.6 + 0.4 * sin(uTime * 0.7 + wp.x * 0.11 + wp.z * 0.13);
  float p = vg_pulse(wp);
  totalEmissiveRadiance += vec3(0.10, 0.85, 0.72) * vein * tVeinMask * (0.08 * flick * uGlow + p * 2.2);
  float shore = (1.0 - smoothstep(0.0, 0.5, abs(wp.y - uWaterLevel - 0.06))) * tFade;
  totalEmissiveRadiance += vec3(0.05, 0.45, 0.42) * shore * (0.25 + 0.2 * sin(uTime * 1.3 + wp.x * 0.4 + wp.z * 0.3)) * uGlow;
}
`;
