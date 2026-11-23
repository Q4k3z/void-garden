// Global water table at y = 0. Wherever terrain dips below it (the lake basin, the
// flooded lower ravine, natural hollows) water appears automatically.
// High/Ultra: true planar reflections (mirrored camera with oblique clipping, rendering
// only the "reflectable" layer: terrain, sky, trees, ruins, rocks, large creatures).
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { U } from '../core/uniforms.js';
import { WATER_VERT, WATER_FRAG } from '../shaders/water.glsl.js';

export const REFLECT_LAYER = 1;

export class Water {
  constructor(hf, heightUniforms, quality) {
    this.hf = hf;
    this.reflectScale = quality.reflections || 0;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, heightUniforms, {
      uTime: U.uTime, uSunDir: U.uSunDir, uWaterLevel: U.uWaterLevel, uGlow: U.uGlow,
      uPulse: U.uPulse, uPulseStr: U.uPulseStr, uSunShadow: U.uSunShadow, uSunShadowInfo: U.uSunShadowInfo,
      tReflect: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
      uWindStr: { value: 0.5 },
    });
    this.windU = uniforms.uWindStr;
    const defines = {};
    const geo = new THREE.PlaneGeometry(hf.size, hf.size, 8, 8);
    if (this.reflectScale > 0) {
      const w = Math.max(256, Math.round(innerWidth * this.reflectScale)), h = Math.max(256, Math.round(innerHeight * this.reflectScale));
      this.mesh = new Reflector(geo, { textureWidth: w, textureHeight: h, clipBias: 0.004, multisample: 0 });
      uniforms.textureMatrix.value = this.mesh.material.uniforms.textureMatrix.value; // shared with the reflector
      uniforms.tReflect.value = this.mesh.getRenderTarget().texture;
      this.mesh.material.dispose();
      defines.USE_REFLECT = 1;
      if (this.mesh.camera) this.mesh.camera.layers.set(REFLECT_LAYER);
    } else {
      this.mesh = new THREE.Mesh(geo);
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms, defines,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    this.mesh.material = this.material;
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = hf.water;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'water';
    this.shorePoints = this._findShore();
  }

  resize(width, height) {
    if (this.reflectScale > 0 && this.mesh.getRenderTarget) {
      this.mesh.getRenderTarget().setSize(Math.max(256, Math.round(width * this.reflectScale)), Math.max(256, Math.round(height * this.reflectScale)));
    }
  }

  /** Sample points along the shoreline (used for positional water ambience). */
  _findShore() {
    const { res, half, cell, h, water } = this.hf;
    const pts = [];
    for (let j = 2; j < res - 2; j += 3) for (let i = 2; i < res - 2; i += 3) {
      const k = j * res + i;
      if (h[k] < water && (h[k + 3] >= water || h[k - 3] >= water || h[k + 3 * res] >= water || h[k - 3 * res] >= water)) {
        pts.push(new THREE.Vector3(-half + i * cell, water, -half + j * cell));
      }
    }
    return pts;
  }

  nearestShore(x, z, out) {
    let best = 1e12, bi = -1;
    const P = this.shorePoints;
    for (let i = 0; i < P.length; i++) {
      const dx = P[i].x - x, dz = P[i].z - z, d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    if (bi < 0) return Infinity;
    out.copy(P[bi]);
    return Math.sqrt(best);
  }
}
