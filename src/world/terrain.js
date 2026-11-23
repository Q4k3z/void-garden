// Terrain rendering: 10x10 chunks with four LOD levels each (1, 2, 4, 8 m spacing),
// skirts to hide LOD cracks, and a coarse polar "backdrop" ring that carries the
// analytic far mountain ranges out to the horizon.
import * as THREE from 'three';
import { U, patchSunShadow } from '../core/uniforms.js';
import { WORLD } from '../config.js';
import {
  TERRAIN_VERT_PARS, TERRAIN_VERT_MAIN, TERRAIN_FRAG_PARS, TERRAIN_FRAG_COLOR, TERRAIN_FRAG_ROUGH,
  TERRAIN_FRAG_NORMAL, TERRAIN_FRAG_AO, TERRAIN_FRAG_EMISSIVE,
} from '../shaders/terrain.glsl.js';

export function makeTerrainMaterial(backdrop = false) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.35 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWaterLevel = U.uWaterLevel;
    shader.uniforms.uPulse = U.uPulse;
    shader.uniforms.uPulseStr = U.uPulseStr;
    shader.uniforms.uGlow = U.uGlow;
    for (const k of ['tRockA', 'tRockN', 'tGroundA', 'tGroundN', 'tSandA', 'tSandN', 'uCaveA', 'uCaveB']) shader.uniforms[k] = U[k];
    if (backdrop) shader.defines = { ...(shader.defines || {}), VG_BACKDROP: 1 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + TERRAIN_VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + TERRAIN_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + TERRAIN_FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + TERRAIN_FRAG_NORMAL)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + TERRAIN_FRAG_AO)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + TERRAIN_FRAG_EMISSIVE);
    patchSunShadow(shader, 'vTWorld');
  };
  mat.customProgramCacheKey = () => (backdrop ? 'vg-terrain-backdrop' : 'vg-terrain');
  return mat;
}

function buildChunkGeometry(hf, ci, cj, step, cx, cz) {
  const { res, half, cell } = hf;
  const cells = WORLD.chunk / cell;
  const N = cells / step;
  const gi0 = ci * cells, gj0 = cj * cells;
  const vCount = (N + 1) * (N + 1);
  const skirtCount = 4 * (N + 1);
  const total = vCount + skirtCount;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), ao = new Float32Array(total), mo = new Float32Array(total);
  const H = hf.h;
  let v = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const gi = Math.min(res - 1, gi0 + i * step), gj = Math.min(res - 1, gj0 + j * step);
    const k = gj * res + gi;
    pos[v * 3] = -half + gi * cell - cx; pos[v * 3 + 1] = H[k]; pos[v * 3 + 2] = -half + gj * cell - cz;
    nor[v * 3] = hf.nx[k]; nor[v * 3 + 1] = hf.ny[k]; nor[v * 3 + 2] = hf.nz[k];
    ao[v] = hf.ao[k]; mo[v] = hf.moist[k];
    v++;
  }
  const idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1), d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // Skirts: duplicate each edge vertex lowered by `drop`, stitch both windings.
  const drop = 2.5 + step * 2.2;
  const edges = [
    Array.from({ length: N + 1 }, (_, i) => i),                         // j = 0
    Array.from({ length: N + 1 }, (_, i) => N * (N + 1) + i),           // j = N
    Array.from({ length: N + 1 }, (_, j) => j * (N + 1)),               // i = 0
    Array.from({ length: N + 1 }, (_, j) => j * (N + 1) + N),           // i = N
  ];
  for (const e of edges) {
    const start = v;
    for (const s of e) {
      pos[v * 3] = pos[s * 3]; pos[v * 3 + 1] = pos[s * 3 + 1] - drop; pos[v * 3 + 2] = pos[s * 3 + 2];
      nor[v * 3] = nor[s * 3]; nor[v * 3 + 1] = nor[s * 3 + 1]; nor[v * 3 + 2] = nor[s * 3 + 2];
      ao[v] = ao[s] * 0.6; mo[v] = mo[s]; v++;
    }
    for (let t = 0; t < e.length - 1; t++) {
      const a = e[t], b = e[t + 1], c = start + t, d = start + t + 1;
      idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setAttribute('aMoist', new THREE.BufferAttribute(mo, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function buildBackdrop(hf) {
  const segA = 384, rings = 64;
  const r0 = 296, r1 = WORLD.backdropRadius;
  const verts = (segA + 1) * (rings + 1);
  const pos = new Float32Array(verts * 3), ao = new Float32Array(verts).fill(0.92), mo = new Float32Array(verts).fill(0.25);
  let v = 0;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = r0 * Math.pow(r1 / r0, Math.pow(t, 1.08));
    for (let a = 0; a <= segA; a++) {
      const ang = (a / segA) * Math.PI * 2;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      pos[v * 3] = x; pos[v * 3 + 1] = hf.baseHeight(x, z); pos[v * 3 + 2] = z;
      v++;
    }
  }
  const idx = [];
  for (let r = 0; r < rings; r++) for (let a = 0; a < segA; a++) {
    const p = r * (segA + 1) + a, q = p + segA + 1;
    idx.push(p, q, p + 1, p + 1, q, q + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setAttribute('aMoist', new THREE.BufferAttribute(mo, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ensure upward-facing winding
  const n = g.attributes.normal;
  if (n.getY(segA + 5) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  g.computeBoundingSphere();
  return g;
}

export class Terrain {
  constructor(hf, quality) {
    this.hf = hf;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = makeTerrainMaterial(false);
    this.chunks = [];
  }

  build() {
    const hf = this.hf;
    const n = WORLD.size / WORLD.chunk;
    const lodScale = this.quality.terrainLod;
    const dists = [0, 96 * lodScale, 200 * lodScale, 360 * lodScale];
    for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++) {
      const cx = -hf.half + (ci + 0.5) * WORLD.chunk, cz = -hf.half + (cj + 0.5) * WORLD.chunk;
      const lod = new THREE.LOD();
      lod.position.set(cx, 0, cz);
      for (let L = 0; L < 4; L++) {
        const g = buildChunkGeometry(hf, ci, cj, 1 << L, cx, cz);
        const m = new THREE.Mesh(g, this.material);
        m.receiveShadow = true;
        m.castShadow = L <= 1;
        lod.addLevel(m, dists[L]);
      }
      lod.updateMatrix(); lod.matrixAutoUpdate = false;
      this.group.add(lod);
      this.chunks.push(lod);
    }
    this.backdrop = new THREE.Mesh(buildBackdrop(hf), makeTerrainMaterial(true));
    this.backdrop.name = 'backdrop';
    this.backdrop.matrixAutoUpdate = false;
    this.group.add(this.backdrop);
    return this.group;
  }

  /** Height map as a float texture for GPU-side lookups (grass, particles, water depth). */
  makeHeightTexture() {
    const { res } = this.hf;
    const tex = new THREE.DataTexture(this.hf.h, res, res, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    this.heightTex = tex;
    return tex;
  }

  heightUniforms() {
    return {
      uHeightTex: { value: this.heightTex },
      uHeightInfo: { value: new THREE.Vector3(this.hf.half, this.hf.cell, this.hf.res) },
    };
  }
}
