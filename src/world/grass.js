// GPU grass of textured clump cards. A fixed grid of tuft instances follows the camera; each instance
// maps to a world-anchored cell, gets its height from the height texture and its
// density from a baked mask, so blades never "swim" and no CPU work is needed per frame.
// It uses the standard lit pipeline (moonlight, shadows, bio-lights, height fog).
import * as THREE from 'three';
import { U, patchSunShadow } from '../core/uniforms.js';
import { NOISE_GLSL, PULSE_GLSL, HEIGHT_GLSL } from '../shaders/common.glsl.js';
import { smoothstep, clamp } from '../core/noise.js';
import { cellRect, FOLIAGE_CELL } from '../render/foliagegen.js';

// One tuft = three crossed clump cards textured with ~11 alpha-cut blades each (foliage atlas),
// bent in the vertex shader. Far more blades on screen than modelled strips, for fewer vertices.
function buildTuft(rect) {
  const pos = [], nor = [], blade = [], uv = [], idx = [];
  const cards = 3, segs = 3, W = 0.64, Hh = 0.46;
  for (let c = 0; c < cards; c++) {
    const a = (c / cards) * Math.PI + c * 0.21;
    const dx = Math.cos(a), dz = Math.sin(a);
    const nx = -dz, nz = dx;
    const start = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const y = Hh * t;
      pos.push(-dx * W * 0.5, y, -dz * W * 0.5, dx * W * 0.5, y, dz * W * 0.5);
      nor.push(nx * 0.5, 1, nz * 0.5, nx * 0.5, 1, nz * 0.5);
      blade.push(t, t);
      const v = rect[1] + (rect[3] - rect[1]) * t;
      uv.push(rect[0], v, rect[2], v);
    }
    for (let s = 0; s < segs; s++) {
      const i0 = start + s * 2;
      idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
    }
  }
  return { pos, nor, blade, uv, idx };
}

export class Grass {
  constructor(world, heightUniforms) {
    this.world = world;
    const q = world.quality;
    this.enabled = q.grassGrid > 0;
    if (!this.enabled) return;
    const G = q.grassGrid, cell = q.grassCell;
    this.radius = (G * cell) / 2;
    const tuft = buildTuft(cellRect(FOLIAGE_CELL.grass));
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tuft.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(tuft.nor, 3));
    geo.setAttribute('aBlade', new THREE.Float32BufferAttribute(tuft.blade, 1));
    geo.setAttribute('aFolUv', new THREE.Float32BufferAttribute(tuft.uv, 2));
    geo.setIndex(tuft.idx);
    const cells = new Float32Array(G * G * 2);
    for (let j = 0, k = 0; j < G; j++) for (let i = 0; i < G; i++) { cells[k++] = i; cells[k++] = j; }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = G * G;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.densityTex = this._bakeDensity();
    const uniforms = {
      ...heightUniforms,
      uDensityTex: { value: this.densityTex },
      uCam: { value: new THREE.Vector3() },
      uGrid: { value: new THREE.Vector2(G, cell) },
      uTime: U.uTime, uWind: U.uWind, uPlayer: U.uPlayer, uPulse: U.uPulse, uPulseStr: U.uPulseStr, uGlow: U.uGlow, uSunDir: U.uSunDir,
      tFolA: U.tFolA, uFolSize: U.uFolSize,
    };
    this.uniforms = uniforms;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3 });
    mat.alphaToCoverage = (q.msaa || 0) > 0 && q.post;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aBlade; attribute vec2 aCell; attribute vec2 aFolUv;
          uniform sampler2D uDensityTex; uniform vec3 uCam; uniform vec2 uGrid; uniform float uTime; uniform vec4 uWind; uniform vec3 uPlayer;
          varying float vBlade; varying vec3 vGWorld; varying float vGHash; varying float vGCol; varying vec2 vGUv; varying vec2 vGTint;
          ${NOISE_GLSL}
          ${HEIGHT_GLSL}`)
        .replace('#include <beginnormal_vertex>', `
          vec2 gCellIdx = floor(uCam.xz / uGrid.y) - uGrid.x * 0.5 + aCell;
          vec2 gJit = vg_hash22(gCellIdx);
          vec2 gWP = (gCellIdx + gJit) * uGrid.y;
          float gRot = vg_hash12(gCellIdx + 13.1) * 6.2831;
          float gc = cos(gRot), gs = sin(gRot);
          vec3 objectNormal = vec3(normal.x * gc - normal.z * gs, normal.y, normal.x * gs + normal.z * gc);
          objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.55));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`)
        .replace('#include <begin_vertex>', `
          vec3 transformed;
          {
            vec2 dUV = clamp((gWP + uHeightInfo.x) / (2.0 * uHeightInfo.x), 0.0, 1.0);
            vec4 dtex = texture2D(uDensityTex, dUV);
            float dens = dtex.r;
            vGTint = dtex.gb;
            float dist = distance(gWP, uCam.xz);
            float radius = uGrid.x * uGrid.y * 0.5;
            float fade = 1.0 - smoothstep(radius * 0.62, radius * 0.96, dist);
            float h1 = vg_hash12(gCellIdx + 71.7);
            float keep = step(h1, dens);
            float sc = keep * fade * mix(0.55, 1.35, gJit.x) * (0.6 + 0.6 * dens);
            vec3 p = position * sc;
            p = vec3(p.x * gc - p.z * gs, p.y, p.x * gs + p.z * gc);
            float t = aBlade;
            vec2 wd = uWind.xy;
            float gust = sin(dot(gWP, wd) * 0.06 - uTime * 1.3) * 0.5 + 0.5;
            float sway = (0.10 + gust * 0.22) * uWind.z + sin(uTime * 2.4 + gJit.y * 30.0) * 0.04;
            p.xz += wd * sway * t * t * sc;
            vec2 tp = gWP - uPlayer.xz; float pd = length(tp);
            p.xz += tp / max(pd, 0.01) * (1.0 - smoothstep(0.1, 1.1, pd)) * 0.35 * t * sc;
            p.y -= (1.0 - smoothstep(0.1, 1.1, pd)) * 0.25 * t * sc;
            float gy = vg_height(gWP);
            transformed = vec3(gWP.x, gy, gWP.y) + p;
            vBlade = t; vGWorld = transformed; vGHash = h1; vGCol = gJit.y; vGUv = aFolUv;
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uGlow; uniform vec3 uSunDir;
          uniform sampler2D tFolA; uniform vec2 uFolSize;
          varying float vBlade; varying vec3 vGWorld; varying float vGHash; varying float vGCol; varying vec2 vGUv; varying vec2 vGTint;
          ${PULSE_GLSL}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          // thin matte blades: keep only a soft moonlit sheen (up-biased normals over-reflect at grazing angles)
          reflectedLight.directSpecular *= 0.3;
          reflectedLight.indirectSpecular *= 0.4;
          #if NUM_DIR_LIGHTS > 0
          {
            vec3 gV = normalize(cameraPosition - vGWorld);
            float gBack = pow(clamp(dot(-gV, uSunDir), 0.0, 1.0), 4.0);
            vec3 gd = diffuseColor.rgb;
            vec3 gt = gd * mix(vec3(1.0), gd / max(max(gd.r, gd.g), max(gd.b, 1e-3)), 0.75);
            reflectedLight.directDiffuse += gt * directionalLights[0].color * gBack * gBl * 0.3 * vgSunVis;
          }
          #endif`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          #ifdef DOUBLE_SIDED
            normal *= faceDirection; // blades are lit like the ground on both faces
          #endif`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // clamped: MSAA shades distant sub-pixel blades outside the triangle, where the varying extrapolates
          float gBl = clamp(vBlade, 0.0, 1.0);
          vec2 gTn = clamp(vGTint, 0.0, 1.0);
          vec3 gBase = mix(vec3(0.020, 0.055, 0.050), vec3(0.040, 0.095, 0.080), vGCol);
          vec3 gTip = mix(vec3(0.060, 0.150, 0.125), vec3(0.100, 0.200, 0.170), vGCol);
          // biome tints: dry gold on the amber heights, dusky violet in the fungal wood
          gBase = mix(gBase, vec3(0.055, 0.045, 0.020), gTn.x);
          gTip = mix(gTip, mix(vec3(0.200, 0.150, 0.060), vec3(0.150, 0.130, 0.065), vGCol), gTn.x);
          gBase = mix(gBase, vec3(0.030, 0.026, 0.050), gTn.y);
          gTip = mix(gTip, mix(vec3(0.085, 0.070, 0.150), vec3(0.060, 0.095, 0.130), vGCol), gTn.y);
          diffuseColor.rgb = mix(gBase, gTip, gBl) * mix(0.55, 1.0, gBl);
          {
            vec4 fa = texture2D(tFolA, vGUv);
            vec2 fdx = dFdx(vGUv * uFolSize), fdy = dFdy(vGUv * uFolSize);
            float fmip = max(0.0, 0.5 * log2(max(dot(fdx, fdx), dot(fdy, fdy))));
            float alpha = clamp(fa.a * (1.0 + fmip * 0.35), 0.0, 1.0);
            if (alpha < 0.38) discard;
            diffuseColor.a = smoothstep(0.38, 0.62, alpha);
            diffuseColor.rgb *= fa.rgb * fa.rgb * 2.0;
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float gTipGlow = smoothstep(0.8, 1.0, gBl) * step(0.72, vGHash);
          float gp = vg_pulse(vGWorld);
          totalEmissiveRadiance += vec3(0.15, 0.95, 0.8) * gTipGlow * (0.35 * uGlow * (0.7 + 0.3 * sin(uTime * 2.0 + vGHash * 40.0)) + gp * 3.0);`);
      patchSunShadow(shader, 'vGWorld');
    };
    mat.customProgramCacheKey = () => 'vg-grass';
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'grass';
  }

  _bakeDensity() {
    const hf = this.world.hf;
    const N = 320;
    // R = density, G = dryness (amber highland tint), B = fungal (violet tint)
    const data = new Uint8Array(N * N * 4);
    const W = hf.water, biome = this.world.biomeAt;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -hf.half + ((i + 0.5) / N) * hf.size, z = -hf.half + ((j + 0.5) / N) * hf.size;
      const h = hf.heightAt(x, z);
      const s = hf.slopeAt(x, z), m = hf.moistAt(x, z);
      let d = (1 - smoothstep(0.32, 0.5, s)) * smoothstep(W + 0.15, W + 0.8, h) * (1 - smoothstep(55, 80, h));
      d *= 0.45 + m * 0.55;
      if (this.world.isExcluded(x, z, 0.6)) d *= 0.15;
      const b = biome ? biome(x, z) : null;
      const dry = b ? b.amber : 0, vio = b ? b.fungal : 0;
      d *= 1 - dry * 0.3;
      const k = (j * N + i) * 4;
      data[k] = Math.round(clamp(d, 0, 1) * 255);
      data[k + 1] = Math.round(clamp(dry, 0, 1) * 255);
      data[k + 2] = Math.round(clamp(vio, 0, 1) * 255);
      data[k + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    return tex;
  }

  update(camPos) { if (this.enabled) this.uniforms.uCam.value.copy(camPos); }
}
