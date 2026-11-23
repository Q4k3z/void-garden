// Cinematic lighting: low alien moon (directional, shadow-mapped around the player with
// texel snapping to stop shimmer), cool sky/ground hemisphere fill, and a small pool
// of point lights that is continuously re-assigned to the nearest bioluminescent
// hotspots (flowers, crystals, ruins...). The pool keeps the shader light count fixed,
// so no recompiles occur while the lit set follows the player.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class Lighting {
  constructor(scene, quality, sunDir) {
    this.scene = scene;
    this.sunDir = sunDir.clone();
    this.hemi = new THREE.HemisphereLight(0x7aaebd, 0x141f22, 1.3);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xbfe2e8, 2.3);
    this.moon.castShadow = !!quality.shadows;
    const s = this.moon.shadow;
    s.mapSize.set(quality.shadowSize, quality.shadowSize);
    this.span = 150;
    s.camera.left = -this.span / 2; s.camera.right = this.span / 2; s.camera.top = this.span / 2; s.camera.bottom = -this.span / 2;
    s.camera.near = 1; s.camera.far = 420;
    s.bias = -0.00035; s.normalBias = 0.045;
    s.radius = 2.5;
    scene.add(this.moon, this.moon.target);
    this.pool = [];
    for (let i = 0; i < quality.bioLights; i++) {
      const l = new THREE.PointLight(0x6fffe0, 0, 14, 2);
      scene.add(l);
      this.pool.push({ light: l, spot: null, level: 0 });
    }
    this.timer = 0;
    this.fwd = this.sunDir.clone().negate();
    this.right = new THREE.Vector3().crossVectors(this.fwd, UP).normalize();
    this.up2 = new THREE.Vector3().crossVectors(this.right, this.fwd).normalize();
    this._c = new THREE.Vector3();
    this.chosen = new Set();
  }

  setShadows(on, size) {
    this.moon.castShadow = on;
    if (size && size !== this.moon.shadow.mapSize.x) {
      this.moon.shadow.mapSize.set(size, size);
      if (this.moon.shadow.map) { this.moon.shadow.map.dispose(); this.moon.shadow.map = null; }
    }
  }

  update(dt, camPos, spots) {
    // shadow frustum follows the camera, snapped to shadow-map texels in light space
    const texel = this.span / this.moon.shadow.mapSize.x;
    const r = Math.round(camPos.dot(this.right) / texel) * texel;
    const u = Math.round(camPos.dot(this.up2) / texel) * texel;
    const f = camPos.dot(this.fwd);
    const c = this._c.copy(this.right).multiplyScalar(r).addScaledVector(this.up2, u).addScaledVector(this.fwd, f);
    this.moon.target.position.copy(c);
    this.moon.position.copy(c).addScaledVector(this.sunDir, 200);
    this.moon.target.updateMatrixWorld();

    // bio-light pool
    this.timer -= dt;
    if (this.timer <= 0 && spots.length) {
      this.timer = 0.3;
      const scored = [];
      for (const s of spots) {
        const dx = s.x - camPos.x, dy = s.y - camPos.y, dz = s.z - camPos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 55 * 55) continue;
        const boost = (s.priority || 1) * (s.ref && s.ref.awakened ? 2 : 1) * (s.flare ? 1 + s.flare : 1);
        scored.push({ s, score: d2 / boost });
      }
      scored.sort((a, b) => a.score - b.score);
      this.chosen.clear();
      for (let i = 0; i < Math.min(this.pool.length, scored.length); i++) this.chosen.add(scored[i].s);
      // free slots whose spot is no longer chosen
      for (const p of this.pool) if (p.spot && !this.chosen.has(p.spot)) p.leaving = true; else p.leaving = false;
    }
    for (const p of this.pool) {
      if (p.spot && !p.leaving) {
        const s = p.spot;
        const target = (s.intensity || 6) * (s.ref && s.ref.flare ? 1 + s.ref.flare * 3 : 1) * (s.flare ? 1 + s.flare * 3 : 1);
        p.level += (1 - p.level) * Math.min(1, dt * 2.5);
        p.light.intensity = target * p.level;
      } else {
        p.level = Math.max(0, p.level - dt * 2.5);
        p.light.intensity *= p.level > 0 ? 1 - Math.min(1, dt * 2.5) : 0;
        if (p.level <= 0.01) {
          p.spot = null; p.leaving = false;
          // claim an unassigned chosen spot
          for (const s of this.chosen) {
            if (this.pool.some((q) => q.spot === s)) continue;
            p.spot = s; p.level = 0;
            p.light.position.set(s.x, s.y, s.z);
            p.light.color.setHex(s.color || 0x6fffe0);
            p.light.distance = s.range || 14;
            break;
          }
        }
      }
    }
  }
}
