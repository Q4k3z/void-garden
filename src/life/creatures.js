// Fauna. Every creature runs the same behaviour loop:
//   IDLE -> WANDER -> DETECT (player) -> REACT -> RETURN -> IDLE
// with species-specific awareness (detection radius scales with the player's noise:
// sprinting is loud, crouching is quiet), movement and reactions.
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { U } from '../core/uniforms.js';
import { GeoBuilder, curvePoints, col } from '../world/geo.js';
import { makeBioMaterial } from '../world/materials.js';
import { Skyrays, GlowEels, Grazers, Prowlers } from './fauna2.js';

export const S = { IDLE: 'IDLE', WANDER: 'WANDER', DETECT: 'DETECT', REACT: 'REACT', RETURN: 'RETURN' };
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _n = new THREE.Vector3();
const _col = new THREE.Color();

class Brain {
  constructor() { this.state = S.IDLE; this.t = 0; this.dur = 2; }
  set(s, dur = 2) { this.state = s; this.t = 0; this.dur = dur; }
  get calm() { return this.state === S.IDLE || this.state === S.WANDER || this.state === S.RETURN; }
}

/** Solve a 2-bone chain; writes the knee position. */
function solveKnee(hip, foot, l1, l2, pole, out) {
  _a.subVectors(foot, hip);
  let d = _a.length();
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) { _a.multiplyScalar(maxD / d); d = maxD; foot.copy(hip).add(_a); }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  const dir = _a.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  return out.copy(hip).addScaledVector(dir, a).addScaledVector(_b, h);
}
/** Matrix that maps a unit +Y cylinder (base at origin) onto segment A->B. */
function segmentMatrix(A, B, radiusScale, out) {
  _c.subVectors(B, A);
  const len = _c.length();
  _q.setFromUnitVectors(UP, _c.divideScalar(Math.max(len, 1e-5)));
  _s.set(radiusScale, len, radiusScale);
  return out.compose(A, _q, _s);
}

// ============================================================== Lumen Drifter
function makeTendrilMaterial(color) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const u = { uPhase: { value: 0 }, uTrail: { value: new THREE.Vector3() }, uLen: { value: 3 } };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uPhase; uniform vec3 uTrail; uniform float uLen; varying float vK;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float k = clamp(-position.y / uLen, 0.0, 1.0); vK = k;
        transformed.x += sin(uTime * 2.1 + k * 5.0 + uPhase + position.x * 9.0) * k * 0.28 + uTrail.x * k * k;
        transformed.z += cos(uTime * 1.7 + k * 4.0 + uPhase + position.z * 9.0) * k * 0.28 + uTrail.z * k * k;
        transformed.y += uTrail.y * k * k;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vK;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * (1.0 - clamp(vK, 0.0, 1.0) * 0.75) );'); // clamp: MSAA extrapolation on thin tubes
  };
  mat.customProgramCacheKey = () => 'vg-tendril';
  return mat;
}

class Drifter {
  constructor(rng, home, hf, world) {
    this.rng = rng; this.hf = hf; this.world = world;
    this.home = home.clone();
    this.brain = new Brain();
    this.size = rng.float(0.75, 1.35);
    this.alt = rng.float(3.5, 9);
    this.pos = home.clone(); this.pos.y = hf.heightAt(home.x, home.z) + this.alt;
    this.vel = new THREE.Vector3();
    this.target = this.pos.clone();
    this.ph = rng.float(0, 6);
    this.rate = 1.0;
    this.flash = 0;
    this.violet = rng.chance(0.3);
    const glowC = this.violet ? 0xa98bff : 0x6fffe6;
    const g = new THREE.Group();
    // bell
    const prof = [V(0.001, 0.95, 0), V(0.32, 0.9, 0), V(0.6, 0.7, 0), V(0.78, 0.38, 0), V(0.84, 0.06, 0), V(0.76, -0.06, 0), V(0.62, 0.02, 0)].map((p) => new THREE.Vector2(p.x, p.y));
    this.bellMat = new THREE.MeshStandardMaterial({ color: this.violet ? 0x3a2f66 : 0x1f6a66, emissive: glowC, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    this.bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), this.bellMat);
    g.add(this.bell);
    const ob = new GeoBuilder();
    ob.ellipsoid(V(0, 0.45, 0), V(0.3, 0.32, 0.3), 12, 8, col(glowC), 1);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; ob.ellipsoid(V(Math.cos(a) * 0.78, 0.0, Math.sin(a) * 0.78), V(0.045, 0.045, 0.045), 5, 3, col(glowC), 1); }
    this.organMat = makeBioMaterial({ wind: false, glow: 2.4, roughness: 0.4 });
    this.organ = new THREE.Mesh(ob.toGeometry(), this.organMat);
    this.bell.add(this.organ);
    // tendrils
    this.tMat = makeTendrilMaterial(glowC);
    const len = rng.float(2.4, 4.2);
    this.tMat.userData.u.uLen.value = len;
    this.tMat.userData.u.uPhase.value = rng.float(0, 10);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? 0.55 : 0.3;
      const l = len * (i % 2 ? 1 : 0.65);
      const pts = [V(Math.cos(a) * r, 0, Math.sin(a) * r), V(Math.cos(a) * r * 0.9, -l * 0.5, Math.sin(a) * r * 0.9), V(Math.cos(a) * r * 0.8, -l, Math.sin(a) * r * 0.8)];
      const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.016, 4, false);
      g.add(new THREE.Mesh(tg, this.tMat));
    }
    g.scale.setScalar(this.size);
    this.group = g;
    this.lastCall = -99;
  }

  pickWander() {
    const r = this.rng;
    const a = r.angle(), d = r.float(5, 24);
    const x = this.home.x + Math.cos(a) * d, z = this.home.z + Math.sin(a) * d;
    this.target.set(x, Math.max(this.hf.heightAt(x, z), this.hf.water) + this.alt * r.float(0.7, 1.3), z);
  }

  update(dt, ctx) {
    const b = this.brain; b.t += dt;
    const p = ctx.player;
    const d = this.pos.distanceTo(p.eye);
    const detectR = 10.5 * Math.sqrt(p.noise);
    if (b.calm && d < detectR) { b.set(S.DETECT, 0.9); this.flash = 0.6; }
    switch (b.state) {
      case S.IDLE:
        this.rate = 0.8;
        if (b.t > b.dur) { this.pickWander(); b.set(S.WANDER, 30); }
        break;
      case S.WANDER:
        this.rate = 1.0;
        if (this.pos.distanceTo(this.target) < 2.2 || b.t > b.dur) b.set(S.IDLE, this.rng.float(3, 8));
        break;
      case S.DETECT:
        this.rate = 0.5; this.vel.multiplyScalar(Math.exp(-dt * 2));
        if (b.t > b.dur) {
          if (d < detectR * 0.95) {
            _a.subVectors(this.pos, p.eye).setY(0).normalize();
            this.target.copy(this.pos).addScaledVector(_a, 20).add(V(0, 6, 0));
            b.set(S.REACT, 6); this.flash = 1.6;
            if (ctx.t - this.lastCall > 4) { ctx.audio?.creatureCall('drifter', this.pos); this.lastCall = ctx.t; }
            ctx.observe?.('drifter', this);
          } else { this.pickWander(); b.set(S.WANDER, 20); }
        }
        break;
      case S.REACT:
        this.rate = 2.3;
        if (b.t > 3.5 && d > detectR * 1.7) { this.target.copy(this.home); this.target.y = this.hf.heightAt(this.home.x, this.home.z) + this.alt; b.set(S.RETURN, 30); }
        break;
      case S.RETURN:
        this.rate = 1.0;
        if (this.pos.distanceTo(this.target) < 3 || b.t > b.dur) b.set(S.IDLE, 4);
        break;
    }
    // curiosity: drift toward a fresh resonance pulse, but keep distance from the player
    if (ctx.pulseFresh && b.calm && this.pos.distanceTo(ctx.pulseOrigin) < 60) {
      _a.subVectors(this.pos, ctx.pulseOrigin).setY(0).normalize();
      this.target.copy(ctx.pulseOrigin).addScaledVector(_a, 9).add(V(0, 5, 0));
      b.set(S.WANDER, 25); this.flash = 0.8;
    }
    // bell pulse propulsion
    const prev = Math.sin(this.ph);
    this.ph += dt * this.rate * 2.4;
    const s = Math.sin(this.ph);
    const contraction = Math.pow(Math.max(0, s), 3);
    if (prev < 0.95 && s >= 0.95) {
      _a.subVectors(this.target, this.pos);
      const dist = _a.length();
      if (dist > 0.5) this.vel.addScaledVector(_a.normalize(), (0.9 + this.rate * 0.6) * Math.min(1, dist / 4));
    }
    this.vel.multiplyScalar(Math.exp(-dt * 0.8));
    const ground = Math.max(this.hf.heightAt(this.pos.x, this.pos.z), this.hf.water);
    if (this.pos.y < ground + 1.8) this.vel.y += (ground + 1.8 - this.pos.y) * 3 * dt;
    this.vel.y += Math.sin(ctx.t * 0.6 + this.ph * 0.1) * 0.05 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.world.colliders.resolve(this.pos, 1.0 * this.size);
    // pose
    this.group.position.copy(this.pos);
    this.bell.scale.set(1 - contraction * 0.16, 1 + contraction * 0.1, 1 - contraction * 0.16);
    _a.copy(this.vel).multiplyScalar(0.5).add(_b.set(0, 2.2, 0)).normalize();
    _q.setFromUnitVectors(UP, _a);
    this.group.quaternion.slerp(_q, Math.min(1, dt * 2));
    _c.copy(this.vel).multiplyScalar(-0.7).applyQuaternion(_q2.copy(this.group.quaternion).invert());
    this.tMat.userData.u.uTrail.value.lerp(_c, Math.min(1, dt * 3));
    this.flash = Math.max(0, this.flash - dt * 0.6);
    const glow = 0.5 + contraction * 0.5 + this.flash * 2.2 + ctx.pulseNear(this.pos) * 2;
    this.bellMat.emissiveIntensity = glow * 0.6 * U.uGlow.value;
    this.organMat.userData.glow.value = (1.6 + glow) * U.uGlow.value;
  }
}

// ================================================================== Skitterers
function buildSkitterBody() {
  const b = new GeoBuilder();
  const shell = col(0x1d2f3a), shell2 = col(0x2b2446), belly = col(0x0f1a1d), glowC = col(0x7dffe6);
  b.ellipsoid(V(0, 0.02, -0.22), V(0.2, 0.15, 0.27), 12, 8, (nx, ny, nz) => (ny > 0.55 && Math.abs(nx) < 0.18 && Math.sin(nz * 20) > 0.2 ? glowC : ny > 0 ? shell.clone().lerp(shell2, Math.sin(nz * 14) * 0.5 + 0.5) : belly), (nx, ny, nz) => (ny > 0.55 && Math.abs(nx) < 0.18 && Math.sin(nz * 20) > 0.2 ? 1 : 0));
  b.ellipsoid(V(0, 0.04, 0.06), V(0.16, 0.12, 0.15), 10, 7, (nx, ny) => (ny > 0 ? shell2 : belly), 0);
  b.ellipsoid(V(0, 0.05, 0.24), V(0.1, 0.085, 0.11), 10, 6, (nx, ny, nz) => (nz > 0.55 && Math.abs(ny) < 0.4 ? glowC : shell), (nx, ny, nz) => (nz > 0.55 && Math.abs(ny) < 0.4 ? 0.9 : 0));
  for (const sd of [-1, 1]) {
    const pts = [V(sd * 0.04, 0.09, 0.3), V(sd * 0.12, 0.25, 0.42), V(sd * 0.2, 0.33, 0.5)];
    b.tube(curvePoints(pts, 6), () => 0.008, 3, () => shell, (t) => t * 0.3);
    b.ellipsoid(pts[2], V(0.025, 0.025, 0.025), 5, 3, glowC, 1);
  }
  return b.toGeometry();
}

class SkitterSystem {
  constructor(rng, world, feedSpots, count) {
    this.world = world; this.hf = world.hf; this.rng = rng;
    this.L1 = 0.2; this.L2 = 0.27;
    const bodyMat = makeBioMaterial({ wind: false, glow: 1.6, instanceGlow: true, roughness: 0.4, metalness: 0.1, skin: { scale: 5 } });
    this.body = new THREE.InstancedMesh(buildSkitterBody(), bodyMat, count);
    this.body.castShadow = true; this.body.frustumCulled = false; this.body.name = 'skitterers';
    const legGeo = new THREE.CylinderGeometry(0.018, 0.012, 1, 5); legGeo.translate(0, 0.5, 0);
    this.legs = new THREE.InstancedMesh(legGeo, new THREE.MeshStandardMaterial({ color: 0x15222a, roughness: 0.6 }), count * 12);
    this.legs.frustumCulled = false; this.legs.castShadow = true;
    this.group = new THREE.Group(); this.group.add(this.body, this.legs);
    this.items = [];
    const herds = Math.max(1, Math.round(count / 5));
    const spots = feedSpots.length ? feedSpots : [{ x: 20, z: 20 }];
    for (let h = 0; h < herds; h++) {
      const home = spots[Math.floor(rng.next() * spots.length)];
      for (let k = 0; k < 5 && this.items.length < count; k++) {
        const it = {
          herd: h, home: V(home.x, 0, home.z), brain: new Brain(),
          pos: V(home.x + rng.float(-4, 4), 0, home.z + rng.float(-4, 4)), yaw: rng.angle(), speed: 0, target: V(home.x, 0, home.z),
          legs: [], glow: 1, flash: 0, phase: rng.float(0, 6), scale: rng.float(0.85, 1.2), lastCall: -99, visible: true,
          alive: true, respawnAt: 0, chasedBy: null, fleeFrom: null,
        };
        it.pos.y = this.hf.heightAt(it.pos.x, it.pos.z);
        const hips = [[-0.1, 0.1], [0.1, 0.1], [-0.12, -0.02], [0.12, -0.02], [-0.11, -0.16], [0.11, -0.16]];
        hips.forEach(([x, z], i) => {
          const sd = Math.sign(x);
          it.legs.push({ hip: V(x, 0.05, z), rest: V(x + sd * 0.26, 0, z + (i < 2 ? 0.1 : i > 3 ? -0.08 : 0)), group: [0, 3, 4].includes(i) ? 0 : 1, foot: V(), from: V(), to: V(), t: 1 });
        });
        this.items.push(it);
      }
    }
    this.herdHomes = [];
    const c = new THREE.Color(1, 0, 0);
    this.items.forEach((it, i) => {
      this.body.setColorAt(i, c);
      for (const L of it.legs) { this._legWorld(it, L.rest, L.foot); L.foot.y = this.hf.heightAt(L.foot.x, L.foot.z); }
    });
    this.knee = V(); this.hipW = V();
  }

  _bodyQuat(it, out) { return out.setFromAxisAngle(UP, it.yaw); }
  _hide(i) {
    this.items[i].visible = false;
    _m.makeScale(0, 0, 0);
    this.body.setMatrixAt(i, _m);
    for (let k = 0; k < 12; k++) this.legs.setMatrixAt(i * 12 + k, _m);
  }
  _legWorld(it, local, out) {
    return out.copy(local).multiplyScalar(it.scale).applyAxisAngle(UP, it.yaw).add(it.pos);
  }

  update(dt, ctx) {
    const hf = this.hf, p = ctx.player, W = hf.water;
    const detectBase = 7.5 * p.noise;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i], b = it.brain; b.t += dt;
      // taken by a prowler: stay hidden, then a new one wanders back into the herd's range
      if (!it.alive) {
        if (ctx.t < it.respawnAt) { if (it.visible) this._hide(i); continue; }
        it.alive = true; it.chasedBy = null; it.fleeFrom = null;
        it.pos.set(it.home.x + this.rng.float(-5, 5), 0, it.home.z + this.rng.float(-5, 5));
        it.pos.y = hf.heightAt(it.pos.x, it.pos.z);
        b.set(S.IDLE, 2);
        for (const L of it.legs) { this._legWorld(it, L.rest, L.foot); L.foot.y = hf.heightAt(L.foot.x, L.foot.z); L.t = 1; }
      }
      const dx = it.pos.x - p.pos.x, dz = it.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const camD = Math.hypot(it.pos.x - ctx.cam.x, it.pos.z - ctx.cam.z);
      if (b.calm && d < detectBase) { b.set(S.DETECT, 0.45 + this.rng.next() * 0.3); it.flash = 0.5; it.fleeFrom = null; }
      // a hunting prowler close by: the whole herd bolts away from it
      const pr = ctx.prowlerNear ? ctx.prowlerNear(it.pos, it.chasedBy ? 16 : 9) : null;
      if (pr && b.state !== S.REACT) {
        for (const o of this.items) if (o.alive && o.herd === it.herd && o.brain.state !== S.REACT && o.pos.distanceTo(it.pos) < 14) { o.brain.set(S.REACT, this.rng.float(3, 5)); o.flash = 1.4; o.fleeFrom = pr; }
        if (ctx.t - it.lastCall > 2.5 && camD < 60) { ctx.audio?.creatureCall('skitter', it.pos); it.lastCall = ctx.t; }
      }
      // striders nearby make them wary too
      if (b.state === S.IDLE && ctx.striderNear(it.pos, 6)) b.set(S.WANDER, 4), it.target.set(it.pos.x + dx * 0.5, 0, it.pos.z + dz * 0.5);
      let wantSpeed = 0;
      switch (b.state) {
        case S.IDLE:
          if (b.t > b.dur) {
            const a = this.rng.angle(), r = this.rng.float(2, 14);
            it.target.set(it.home.x + Math.cos(a) * r, 0, it.home.z + Math.sin(a) * r);
            b.set(S.WANDER, 25);
          }
          break;
        case S.WANDER: wantSpeed = 0.85; if (Math.hypot(it.target.x - it.pos.x, it.target.z - it.pos.z) < 0.8 || b.t > b.dur) b.set(S.IDLE, this.rng.float(2.5, 8)); break;
        case S.DETECT:
          if (b.t > b.dur) {
            if (d < detectBase * 1.05) {
              // panic spreads through the herd
              for (const o of this.items) if (o.herd === it.herd && o.brain.state !== S.REACT && o.pos.distanceTo(it.pos) < 14) { o.brain.set(S.REACT, this.rng.float(2.5, 4)); o.flash = 1.4; }
              if (ctx.t - it.lastCall > 2.5) { ctx.audio?.creatureCall('skitter', it.pos); it.lastCall = ctx.t; }
              ctx.observe?.('skitter', it);
            } else b.set(S.IDLE, 2);
          }
          break;
        case S.REACT: {
          wantSpeed = it.fleeFrom ? 6.0 : 4.2; // a hunter at their heels: run flat out
          const src = it.fleeFrom ? it.fleeFrom.pos : p.pos;
          const fx = it.pos.x - src.x, fz = it.pos.z - src.z, fd = Math.hypot(fx, fz);
          const inv = 1 / Math.max(fd, 0.01);
          it.target.set(it.pos.x + fx * inv * 6 + Math.sin(it.phase + ctx.t) * 1.5, 0, it.pos.z + fz * inv * 6 + Math.cos(it.phase + ctx.t) * 1.5);
          if (b.t > b.dur && fd > 18) { b.set(S.RETURN, 40); it.target.copy(it.home); it.fleeFrom = null; }
          break;
        }
        case S.RETURN: wantSpeed = 1.3; it.target.set(it.home.x, 0, it.home.z); if (Math.hypot(it.home.x - it.pos.x, it.home.z - it.pos.z) < 6 || b.t > b.dur) b.set(S.IDLE, 3); break;
      }
      // steering
      if (wantSpeed > 0) {
        let ty = Math.atan2(it.target.x - it.pos.x, it.target.z - it.pos.z);
        // avoid water and cliffs by probing ahead
        const ax = it.pos.x + Math.sin(ty) * 1.2, az = it.pos.z + Math.cos(ty) * 1.2;
        if (hf.heightAt(ax, az) < W + 0.15 || hf.slopeAt(ax, az) > 0.62) { ty += 1.6; if (b.state === S.WANDER) b.set(S.IDLE, 1); }
        let dy = ty - it.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        it.yaw += THREE.MathUtils.clamp(dy, -dt * 5, dt * 5);
      }
      it.speed += (wantSpeed - it.speed) * Math.min(1, dt * (wantSpeed > it.speed ? 6 : 4));
      it.pos.x += Math.sin(it.yaw) * it.speed * dt; it.pos.z += Math.cos(it.yaw) * it.speed * dt;
      this.world.colliders.resolve(it.pos, 0.3);
      const gy = hf.heightAt(it.pos.x, it.pos.z);
      it.flash = Math.max(0, it.flash - dt * 0.8);
      const pn = ctx.pulseNear(it.pos);
      this.body.instanceColor.setXYZ(i, 1, it.flash * 0.6 + pn * 0.5, 0);

      if (camD > 150) { it.visible = false; this.body.setMatrixAt(i, _m.makeScale(0, 0, 0)); for (let k = 0; k < 6; k++) { this.legs.setMatrixAt(i * 12 + k * 2, _m); this.legs.setMatrixAt(i * 12 + k * 2 + 1, _m); } continue; }
      it.visible = true;
      // gait: tripod alternation
      const detailed = camD < 75;
      let footY = 0;
      const stepLen = 0.14 + it.speed * 0.07;
      const stepDur = THREE.MathUtils.clamp(0.22 - it.speed * 0.03, 0.09, 0.22);
      let stepping0 = false, stepping1 = false;
      for (let k = 0; k < 6; k++) { const o = it.legs[k]; if (o.t < 1) { if (o.group === 0) stepping0 = true; else stepping1 = true; } }
      for (let k = 0; k < 6; k++) {
        const L = it.legs[k];
        this._legWorld(it, L.rest, _d);
        _d.x += Math.sin(it.yaw) * it.speed * 0.1; _d.z += Math.cos(it.yaw) * it.speed * 0.1;
        _d.y = hf.heightAt(_d.x, _d.z);
        if (L.t >= 1) {
          const dist = Math.hypot(L.foot.x - _d.x, L.foot.z - _d.z);
          const otherStepping = L.group === 0 ? stepping1 : stepping0;
          if ((dist > stepLen * it.scale && !otherStepping) || dist > 0.6) {
            L.from.copy(L.foot); L.to.copy(_d); L.t = 0;
            if (L.group === 0) stepping0 = true; else stepping1 = true;
          }
        }
        if (L.t < 1) {
          L.t = Math.min(1, L.t + dt / stepDur);
          const e = L.t * L.t * (3 - 2 * L.t);
          L.foot.lerpVectors(L.from, L.to, e); L.foot.y += Math.sin(Math.PI * L.t) * 0.07 * it.scale;
        }
        footY += L.foot.y;
      }
      footY /= 6;
      const graze = b.state === S.IDLE ? Math.max(0, Math.sin(ctx.t * 2.2 + it.phase)) * 0.12 : 0;
      it.pos.y = Math.max(gy, footY) + 0.2 * it.scale + Math.sin(ctx.t * 14 + it.phase) * 0.008 * it.speed;
      hf.normalAt(it.pos.x, it.pos.z, _n);
      _q.setFromUnitVectors(UP, _n);
      _q2.setFromAxisAngle(UP, it.yaw);
      _q.multiply(_q2);
      if (graze || b.state === S.DETECT) { _q2.setFromAxisAngle(_e.set(1, 0, 0), b.state === S.DETECT ? -0.25 : graze * 1.6); _q.multiply(_q2); }
      this.body.setMatrixAt(i, _m.compose(it.pos, _q, _s.setScalar(it.scale)));
      for (let k = 0; k < 6; k++) {
        const L = it.legs[k];
        const base = i * 12 + k * 2;
        if (!detailed) { _m.makeScale(0, 0, 0); this.legs.setMatrixAt(base, _m); this.legs.setMatrixAt(base + 1, _m); continue; }
        this.hipW.copy(L.hip).multiplyScalar(it.scale).applyQuaternion(_q).add(it.pos);
        _e.copy(L.hip).setY(0).applyAxisAngle(UP, it.yaw).normalize().add(_c.set(0, 1.4, 0));
        _d.copy(L.foot);
        solveKnee(this.hipW, _d, this.L1 * it.scale, this.L2 * it.scale, _e, this.knee);
        this.legs.setMatrixAt(base, segmentMatrix(this.hipW, this.knee, 1, _m));
        this.legs.setMatrixAt(base + 1, segmentMatrix(this.knee, _d, 1, _m));
      }
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.body.instanceColor.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
  }
}

// ================================================================ Veil Strider
function buildStriderBody(rng) {
  const b = new GeoBuilder();
  const skin = col(0x1a3036), skin2 = col(0x2a3d4f), belly = col(0x0f1c20), glowC = col(0x7dffe6), vio = col(0xb08cff);
  b.ellipsoid(V(0, 0, 0), V(0.95, 0.8, 2.0), 20, 12, (nx, ny, nz) => (ny > 0 ? skin.clone().lerp(skin2, Math.abs(Math.sin(nz * 9))) : belly), (nx, ny, nz) => (ny < -0.6 && Math.sin(nz * 12) > 0.6 ? 0.8 : 0),
    { displace: (nx, ny, nz) => Math.sin(nz * 12) * 0.03 * Math.max(0, ny) });
  // dorsal sail
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(V(0, 0.7 + Math.sin(Math.PI * t) * 1.3, -1.6 + t * 3.0)); }
  b.ribbon(pts, () => 0.04, V(1, 0, 0), (t) => glowC.clone().lerp(vio, t), () => 0.9);
  for (let i = 0; i <= 12; i += 2) { const p = pts[i]; b.ribbon([V(0, 0.7, p.z), p], () => 0.02, V(1, 0, 0), () => skin2, () => 0.2); }
  const sail = []; for (let i = 0; i <= 12; i++) { const t = i / 12; sail.push(V(0, 0.7 + Math.sin(Math.PI * t) * 0.65, -1.6 + t * 3.0)); }
  b.ribbon(sail, (t) => Math.sin(Math.PI * t) * 1.2 + 0.05, V(0, 1, 0), () => skin.clone().lerp(glowC, 0.25), () => 0.25);
  // belly tendrils
  for (let i = 0; i < 9; i++) {
    const x = rng.float(-0.5, 0.5), z = rng.float(-1.4, 1.2), l = rng.float(0.6, 1.6);
    b.tube([V(x, -0.6, z), V(x * 1.1, -0.6 - l * 0.5, z + 0.05), V(x * 1.2, -0.6 - l, z + 0.1)], (t) => 0.035 * (1 - t * 0.6), 4, (t) => skin.clone().lerp(glowC, t), (t) => t * 0.9, { sway: (t) => t });
  }
  return b.toGeometry();
}
function buildStriderHead() {
  const b = new GeoBuilder();
  const skin = col(0x1f3740), glowC = col(0x8fffe9);
  b.ellipsoid(V(0, 0, 0.25), V(0.28, 0.24, 0.55), 14, 8, skin, 0);
  for (const sd of [-1, 1]) for (const k of [0, 1]) b.ellipsoid(V(sd * 0.2, 0.08 - k * 0.1, 0.45 + k * 0.08), V(0.05, 0.05, 0.05), 6, 4, glowC, 1);
  for (const sd of [-1, 1]) b.ribbon([V(sd * 0.15, 0.15, 0.05), V(sd * 0.45, 0.35, -0.3), V(sd * 0.55, 0.3, -0.6)], (t) => (1 - t) * 0.18, V(0, 1, 0), (t) => skin.clone().lerp(glowC, t), (t) => t * 0.8);
  return b.toGeometry();
}

class Strider {
  constructor(rng, home, world, materials) {
    this.rng = rng; this.world = world; this.hf = world.hf;
    this.home = home.clone();
    this.brain = new Brain();
    this.pos = V(home.x, 0, home.z); this.pos.y = this.hf.heightAt(home.x, home.z);
    this.yaw = rng.angle(); this.speed = 0; this.target = this.pos.clone();
    this.look = V(); this.lookW = 0; this.lastCall = -99;
    this.scale = rng.float(0.9, 1.15);
    this.hipH = 5.6 * this.scale;
    this.L1 = 3.5 * this.scale; this.L2 = 4.3 * this.scale;
    const g = new THREE.Group();
    this.body = new THREE.Mesh(materials.body, materials.mat); this.body.castShadow = true; this.body.scale.setScalar(this.scale);
    this.head = new THREE.Mesh(materials.head, materials.mat); this.head.castShadow = true; this.head.scale.setScalar(this.scale);
    g.add(this.body, this.head);
    this.neck = [];
    for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(materials.neck, materials.mat); m.castShadow = true; m.scale.setScalar(this.scale * (0.95 - i * 0.07)); g.add(m); this.neck.push(m); }
    this.legs = [];
    const hipLocal = [V(-0.75, -0.2, 1.0), V(0.75, -0.2, 1.0), V(0, -0.3, -1.4)];
    const restLocal = [V(-2.9, 0, 2.4), V(2.9, 0, 2.4), V(0, 0, -3.6)];
    for (let k = 0; k < 3; k++) {
      const up = new THREE.Mesh(materials.leg, materials.legMat), lo = new THREE.Mesh(materials.leg, materials.legMat);
      up.castShadow = lo.castShadow = true; up.matrixAutoUpdate = lo.matrixAutoUpdate = false;
      g.add(up, lo);
      const L = { hip: hipLocal[k].multiplyScalar(this.scale), rest: restLocal[k].multiplyScalar(this.scale), up, lo, foot: V(), from: V(), to: V(), t: 1 };
      this.legs.push(L);
    }
    this.group = g;
    this._bodyPos = V();
    for (const L of this.legs) { this._local(L.rest, L.foot); L.foot.y = this.hf.heightAt(L.foot.x, L.foot.z); }
    this.next = 0;
    this.knee = V(); this.hipW = V();
  }
  _local(v, out) { return out.copy(v).applyAxisAngle(UP, this.yaw).add(this.pos); }
  canStand(x, z) { const h = this.hf.heightAt(x, z); return h > this.hf.water - 1.6 && this.hf.slopeAt(x, z) < 0.42 && Math.hypot(x, z) < this.world.playRadius - 15; }

  update(dt, ctx) {
    const b = this.brain; b.t += dt;
    const p = ctx.player;
    const d = Math.hypot(this.pos.x - p.pos.x, this.pos.z - p.pos.z);
    const detectR = 26 * Math.pow(p.noise, 0.35);
    if (b.calm && d < detectR) { b.set(S.DETECT, 2.5); if (ctx.t - this.lastCall > 10) { ctx.audio?.creatureCall('strider', this.head.position); this.lastCall = ctx.t; } }
    let want = 0;
    switch (b.state) {
      case S.IDLE: {
        this.lookW = 0;
        if (b.t > b.dur) {
          for (let tries = 0; tries < 12; tries++) {
            const a = this.rng.angle(), r = this.rng.float(15, 45);
            const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
            if (this.canStand(x, z)) { this.target.set(x, 0, z); break; }
          }
          b.set(S.WANDER, 60);
        }
        break;
      }
      case S.WANDER: want = 1.0; this.lookW = 0; if (Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 3 || b.t > b.dur) b.set(S.IDLE, this.rng.float(6, 14)); break;
      case S.DETECT:
        want = 0; this.look.copy(p.eye); this.lookW = 1;
        if (b.t > b.dur) {
          if (d < 12 * Math.pow(p.noise, 0.3)) {
            const ax = this.pos.x - p.pos.x, az = this.pos.z - p.pos.z, al = Math.hypot(ax, az) || 1;
            this.target.set(this.pos.x + ax / al * 30, 0, this.pos.z + az / al * 30);
            if (!this.canStand(this.target.x, this.target.z)) this.target.set(this.home.x, 0, this.home.z);
            b.set(S.REACT, 12);
            ctx.observe?.('strider', this);
          } else if (d > detectR * 1.1) b.set(S.RETURN, 30);
          else b.t = 0; // keep watching, curious
        }
        break;
      case S.REACT: want = 2.0; this.look.copy(p.eye); this.lookW = 0.5; if (b.t > b.dur || Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 3) b.set(S.RETURN, 40); break;
      case S.RETURN: want = 1.0; this.lookW = 0; this.target.set(this.home.x, 0, this.home.z); if (Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z) < 12 || b.t > b.dur) b.set(S.IDLE, 8); break;
    }
    if (want > 0) {
      const ty = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
      let dy = ty - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += THREE.MathUtils.clamp(dy, -dt * 0.6, dt * 0.6);
      if (Math.abs(dy) > 1.2) want *= 0.3;
    }
    this.speed += (want - this.speed) * Math.min(1, dt * 1.2);
    const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt, nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
    if (this.canStand(nx, nz)) { this.pos.x = nx; this.pos.z = nz; } else if (b.state !== S.IDLE) { b.set(S.IDLE, 2); }
    this.world.colliders.resolve(this.pos, 1.2);

    // legs: one at a time, in sequence
    let fy = 0;
    for (let k = 0; k < 3; k++) {
      const L = this.legs[k];
      this._local(L.rest, _d); _d.x += Math.sin(this.yaw) * this.speed * 0.9; _d.z += Math.cos(this.yaw) * this.speed * 0.9;
      _d.y = this.hf.heightAt(_d.x, _d.z);
      if (L.t >= 1 && k === this.next) {
        const dist = Math.hypot(L.foot.x - _d.x, L.foot.z - _d.z);
        if (dist > 1.2 * this.scale) { L.from.copy(L.foot); L.to.copy(_d); L.t = 0; }
        else if (this.speed < 0.05) this.next = (this.next + 1) % 3;
      }
      if (L.t < 1) {
        L.t = Math.min(1, L.t + dt / (0.85 - this.speed * 0.15));
        const e = L.t * L.t * (3 - 2 * L.t);
        L.foot.lerpVectors(L.from, L.to, e); L.foot.y += Math.sin(Math.PI * L.t) * 0.9 * this.scale;
        if (L.t >= 1) { this.next = (k + 1) % 3; ctx.audio?.footfall?.('strider', L.foot); }
      }
      fy += Math.max(L.foot.y, this.hf.water - 1.6);
    }
    fy /= 3;
    const bodyY = fy + this.hipH + Math.sin(ctx.t * 0.8) * 0.12;
    this.pos.y += (bodyY - this.pos.y) * Math.min(1, dt * 3);
    this.body.position.copy(this.pos);
    const sway = Math.sin(ctx.t * 1.6) * 0.04 * (0.3 + this.speed);
    this.body.rotation.set(0, this.yaw, sway, 'YXZ');
    this.body.updateMatrix();
    for (let k = 0; k < 3; k++) {
      const L = this.legs[k];
      this.hipW.copy(L.hip).applyAxisAngle(UP, this.yaw).add(this.pos);
      _e.copy(L.hip).setY(0).applyAxisAngle(UP, this.yaw).normalize().multiplyScalar(0.6).add(_c.set(0, 1, 0));
      _d.copy(L.foot);
      solveKnee(this.hipW, _d, this.L1, this.L2, _e, this.knee);
      L.up.matrix.copy(segmentMatrix(this.hipW, this.knee, 1.5 * this.scale, _m)); L.up.matrixWorldNeedsUpdate = true;
      L.lo.matrix.copy(segmentMatrix(this.knee, _d, 1.0 * this.scale, _m)); L.lo.matrixWorldNeedsUpdate = true;
    }
    // neck & head
    const fwd = _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const shoulder = _b.copy(this.pos).addScaledVector(fwd, 1.6 * this.scale).add(_c.set(0, 0.5 * this.scale, 0));
    let headTarget;
    if (this.lookW > 0.01) {
      _d.subVectors(this.look, shoulder).normalize();
      if (_d.dot(fwd) < -0.2) _d.addScaledVector(fwd, 0.8).normalize();
      headTarget = _e.copy(shoulder).addScaledVector(_d, 3.4 * this.scale);
    } else if (b.state === S.IDLE) {
      const grazeDown = Math.sin(ctx.t * 0.5 + this.home.x) * 0.5 + 0.5;
      headTarget = _e.copy(shoulder).addScaledVector(fwd, 2.4 * this.scale).add(_c.set(0, (1.6 - grazeDown * 4.6) * this.scale, 0));
    } else headTarget = _e.copy(shoulder).addScaledVector(fwd, 2.6 * this.scale).add(_c.set(0, 1.8 * this.scale, 0));
    if (!this._head) this._head = headTarget.clone();
    this._head.lerp(headTarget, Math.min(1, dt * 1.5));
    const mid = _c.copy(shoulder).add(this._head).multiplyScalar(0.5).add(_d.set(0, 1.2 * this.scale, 0)).addScaledVector(fwd, -0.3);
    for (let i = 0; i < 7; i++) {
      const t = (i + 1) / 8, it = 1 - t;
      this.neck[i].position.set(it * it * shoulder.x + 2 * it * t * mid.x + t * t * this._head.x, it * it * shoulder.y + 2 * it * t * mid.y + t * t * this._head.y, it * it * shoulder.z + 2 * it * t * mid.z + t * t * this._head.z);
    }
    this.head.position.copy(this._head);
    const lookAt = this.lookW > 0.01 ? this.look : _d.copy(this._head).addScaledVector(fwd, 3).add(_n.set(0, -0.6, 0));
    _m.lookAt(lookAt, this.head.position, UP); this.head.quaternion.setFromRotationMatrix(_m);
  }
}

// =================================================================== Glowmoths
function buildMothGeometry() {
  const pos = [], wing = [];
  const tri = (a, b, c, w) => { pos.push(...a, ...b, ...c); wing.push(w, w, w); };
  tri([0, 0, 0.05], [-0.12, 0.0, 0.02], [-0.09, 0, -0.07], -1); tri([0, 0, 0.05], [-0.09, 0, -0.07], [0, 0, -0.03], -1);
  tri([0, 0, 0.05], [0.09, 0, -0.07], [0.12, 0.0, 0.02], 1); tri([0, 0, 0.05], [0, 0, -0.03], [0.09, 0, -0.07], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  return g;
}
class Moths {
  constructor(rng, world, flowers, count) {
    this.world = world; this.hf = world.hf; this.rng = rng;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWing; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float mph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
          float flap = sin(uTime * 28.0 + mph) * 0.9;
          float ang = flap * aWing;
          transformed.y += abs(transformed.x) * sin(ang) * 1.4;
          transformed.x *= cos(ang);`);
    };
    mat.customProgramCacheKey = () => 'vg-moth';
    this.mesh = new THREE.InstancedMesh(buildMothGeometry(), mat, count);
    this.mesh.frustumCulled = false; this.mesh.name = 'glowmoths';
    this.swarms = [];
    const anchors = flowers.length ? flowers : [{ x: 0, z: 0, top: 3 }];
    const nSw = Math.max(1, Math.round(count / 32));
    this.items = [];
    for (let s = 0; s < nSw; s++) {
      const f = anchors[Math.floor(rng.next() * anchors.length)];
      this.swarms.push({ anchor: V(f.x, f.top + 0.6, f.z), flower: f });
    }
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const sw = i % nSw;
      const a = this.swarms[sw].anchor;
      this.items.push({ sw, pos: V(a.x + rng.float(-2, 2), a.y + rng.float(-0.5, 1.5), a.z + rng.float(-2, 2)), vel: V(rng.float(-1, 1), 0, rng.float(-1, 1)), ph: rng.float(0, 6), r: rng.float(0.8, 2.6) });
      this.mesh.setColorAt(i, c.setHSL(rng.chance(0.25) ? 0.12 : 0.47 + rng.float(-0.03, 0.03), 0.9, rng.float(0.55, 0.7)).multiplyScalar(2.2));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  attractTo(flower) {
    let best = null, bd = 130;
    for (const s of this.swarms) { const d = Math.hypot(s.anchor.x - flower.x, s.anchor.z - flower.z); if (d < bd) { bd = d; best = s; } }
    if (best) { best.anchor.set(flower.x, flower.top + 0.6, flower.z); best.flower = flower; }
  }
  update(dt, ctx) {
    const p = ctx.player;
    for (let i = 0; i < this.items.length; i++) {
      const m = this.items[i], a = this.swarms[m.sw].anchor;
      // orbit + cohesion toward the anchor
      _a.subVectors(a, m.pos);
      const dist = _a.length();
      _b.set(-_a.z, 0, _a.x).normalize().multiplyScalar(1.6);
      _a.multiplyScalar((dist - m.r) * 1.2 / Math.max(dist, 0.01));
      _a.add(_b);
      _a.x += Math.sin(ctx.t * 3 + m.ph) * 1.5; _a.y += Math.sin(ctx.t * 2.3 + m.ph * 2) * 1.2; _a.z += Math.cos(ctx.t * 2.7 + m.ph) * 1.5;
      // scatter from the player
      _c.subVectors(m.pos, p.eye); const pd = _c.length();
      if (pd < 3.5) _a.addScaledVector(_c.normalize(), (3.5 - pd) * 9);
      _a.addScaledVector(_d.set(0, 1, 0), ctx.pulseNear(m.pos) * 4);
      m.vel.addScaledVector(_a, dt);
      const sp = m.vel.length(); if (sp > 4.5) m.vel.multiplyScalar(4.5 / sp);
      m.vel.multiplyScalar(Math.exp(-dt * 0.8));
      m.pos.addScaledVector(m.vel, dt);
      const g = this.hf.heightAt(m.pos.x, m.pos.z) + 0.25; if (m.pos.y < g) { m.pos.y = g; m.vel.y = Math.abs(m.vel.y); }
      _q.setFromAxisAngle(UP, Math.atan2(m.vel.x, m.vel.z));
      this.mesh.setMatrixAt(i, _m.compose(m.pos, _q, _s.setScalar(1)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// =================================================================== Shy tubes
class ShyTubes {
  constructor(rng, world, shorePoints) {
    this.world = world; this.hf = world.hf;
    const b = new GeoBuilder();
    b.tube([V(0, -0.05, 0), V(0, 0.25, 0.01), V(0, 0.5, 0)], (t) => 0.035 * (1 - t * 0.3), 6, (t) => col(0x1e3b44).lerp(col(0x7dffe6), Math.pow(t, 4)), (t) => Math.pow(t, 5) * 1.0, { capEnd: true });
    b.ellipsoid(V(0, 0.5, 0), V(0.045, 0.03, 0.045), 6, 4, col(0x9fffee), 1);
    const mat = makeBioMaterial({ wind: false, glow: 1.6, roughness: 0.4 });
    this.clusters = [];
    const chosen = [];
    for (let i = 0; i < shorePoints.length && chosen.length < 24; i++) {
      const p = shorePoints[Math.floor(rng.next() * shorePoints.length)];
      if (chosen.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 14)) continue;
      // nudge onto land just above the waterline
      let best = null;
      for (let k = 0; k < 10; k++) { const a = rng.angle(), d = rng.float(1, 4); const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; const h = this.hf.heightAt(x, z); if (h > this.hf.water + 0.15 && h < this.hf.water + 1.4) { best = { x, z }; break; } }
      if (best && !world.isExcluded(best.x, best.z, 0.5)) chosen.push(best);
    }
    const total = chosen.length * 12;
    this.mesh = new THREE.InstancedMesh(b.toGeometry(), mat, Math.max(1, total));
    this.mesh.name = 'shyTubes';
    let idx = 0;
    for (const c of chosen) {
      const tubes = [];
      for (let k = 0; k < 12; k++) {
        const a = rng.angle(), d = Math.sqrt(rng.next()) * 0.7;
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        tubes.push({ i: idx++, x, z, y: this.hf.heightAt(x, z), s: rng.float(0.6, 1.4), e: 1, delay: rng.float(0, 2.5), tilt: V(rng.float(-0.2, 0.2), 1, rng.float(-0.2, 0.2)).normalize() });
      }
      this.clusters.push({ x: c.x, z: c.z, tubes, retreat: 0 });
    }
    this.mesh.count = idx;
    for (const cl of this.clusters) for (const t of cl.tubes) this._write(t);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }
  _write(t) {
    _q.setFromUnitVectors(UP, t.tilt);
    const e = 0.12 + 0.88 * t.e;
    this.mesh.setMatrixAt(t.i, _m.compose(_a.set(t.x, t.y, t.z), _q, _s.set(t.s, t.s * e, t.s)));
  }
  update(dt, ctx) {
    let dirty = false;
    for (const cl of this.clusters) {
      const d = Math.hypot(cl.x - ctx.player.pos.x, cl.z - ctx.player.pos.z);
      if (d > 40) continue;
      const scared = d < 3.2 + ctx.player.noise * 1.6;
      if (scared && cl.retreat < 0.5) ctx.observe?.('tubes', cl);
      cl.retreat = scared ? 3 : Math.max(0, cl.retreat - dt);
      for (const t of cl.tubes) {
        const target = cl.retreat > 0 ? 0 : 1;
        if (target === 0) { if (t.e > 0) { t.e = Math.max(0, t.e - dt * 6); this._write(t); dirty = true; } t.wait = t.delay; }
        else if (t.e < 1) { t.wait = (t.wait ?? 0) - dt; if (t.wait <= 0) { t.e = Math.min(1, t.e + dt * 0.8); this._write(t); dirty = true; } }
      }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ================================================================== Manager
export class Life {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group(); this.group.name = 'life';
    const rng = makeRng(world.seed, 'life');
    const hf = world.hf, veg = world.vegetation;
    // drifters: homes over water, in the grove and around the arches
    this.drifters = [];
    const homes = [];
    const L = hf.lake;
    for (let i = 0; i < 5; i++) { const a = rng.angle(), d = rng.float(0, 0.7); homes.push(V(L.x + Math.cos(a) * L.rx * d, 0, L.z + Math.sin(a) * L.rz * d)); }
    for (let i = 0; i < 5; i++) { const a = rng.angle(), d = rng.float(0, 50); homes.push(V(world.groveCenter.x + Math.cos(a) * d, 0, world.groveCenter.z + Math.sin(a) * d)); }
    for (const p of world.pois) homes.push(V(p.x, 0, p.z));
    if (world.sites.ring) homes.push(V(world.sites.ring.x, 0, world.sites.ring.z));
    homes.forEach((h, i) => { const d = new Drifter(rng.fork('dr' + i), h, hf, world); this.drifters.push(d); this.group.add(d.group); });
    // skitterers: herds at feeding grounds
    this.skitter = new SkitterSystem(rng.fork('sk'), world, veg.feedSpots, 20);
    this.group.add(this.skitter.group);
    // striders: lowland valleys and lake shallows
    const sm = {
      mat: makeBioMaterial({ wind: true, glow: 1.5, roughness: 0.55, translucent: true, skin: { scale: 0.9 } }),
      legMat: new THREE.MeshStandardMaterial({ color: 0x18282e, roughness: 0.5, metalness: 0.1 }),
      body: buildStriderBody(rng.fork('sb')), head: buildStriderHead(),
      neck: new GeoBuilder().ellipsoid(V(0, 0, 0), V(0.22, 0.22, 0.22), 10, 6, col(0x1c333b), 0).toGeometry(),
      leg: (() => { const g = new THREE.CylinderGeometry(0.09, 0.055, 1, 7); g.translate(0, 0.5, 0); return g; })(),
    };
    this.striders = [];
    const sHomes = [];
    for (let tries = 0; tries < 400 && sHomes.length < 4; tries++) {
      const a = rng.angle(), d = rng.float(20, 200);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = hf.heightAt(x, z);
      if (h < hf.water - 1 || h > 18 || hf.slopeAt(x, z) > 0.25 || world.isExcluded(x, z)) continue;
      if (sHomes.some((s) => s.distanceTo(V(x, 0, z)) < 60)) continue;
      if (world.sites.spawn && Math.hypot(x - world.sites.spawn.x, z - world.sites.spawn.z) < 45) continue;
      sHomes.push(V(x, 0, z));
    }
    sHomes.forEach((h, i) => { const s = new Strider(rng.fork('st' + i), h, world, sm); this.striders.push(s); this.group.add(s.group); });
    // glowmoths & shy tubes
    this.moths = new Moths(rng.fork('mo'), world, veg.flowers, 128);
    this.group.add(this.moths.mesh);
    this.tubes = new ShyTubes(rng.fork('tu'), world, world.water.shorePoints);
    this.group.add(this.tubes.mesh);
    // sky, water and open-ground fauna (fauna2.js)
    this.skyrays = new Skyrays(rng.fork('ray'), world, 21);
    this.group.add(this.skyrays.mesh);
    this.eels = new GlowEels(rng.fork('eel'), world, 16);
    this.group.add(this.eels.mesh);
    this.grazers = new Grazers(rng.fork('gz'), world, this._grazerHomes(rng.fork('gzh')));
    this.group.add(this.grazers.group);
    this.prowlers = new Prowlers(rng.fork('pr'), world, this._prowlerHomes(rng.fork('prh')));
    this.group.add(this.prowlers.group);
    this.ctx = {
      t: 0, player: null, cam: null, audio: null, observe: null, pulseFresh: false, pulseOrigin: V(),
      pulseNear: () => 0,
      striderNear: (pos, r) => this.striders.some((s) => Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < r),
      // a prowler that is hunting close by (chasing within r, or stalking within r/2)
      prowlerNear: (pos, r) => {
        for (const pr of this.prowlers.items) {
          const st = pr.brain.state;
          if (st !== 'CHASE' && st !== 'STALK') continue;
          const d = Math.hypot(pr.pos.x - pos.x, pr.pos.z - pos.z);
          if (d < (st === 'CHASE' ? r : r * 0.5)) return pr;
        }
        return null;
      },
    };
  }

  _walkable(x, z, maxSlope) {
    const hf = this.world.hf;
    return Math.hypot(x, z) < this.world.playRadius - 25 && hf.heightAt(x, z) > hf.water + 0.6 && hf.slopeAt(x, z) < maxSlope;
  }
  /** Open, gentle ground with room for a herd. The first herd grazes within sight of the landing site. */
  _grazerHomes(rng) {
    const hf = this.world.hf, w = this.world, sp = w.sites.spawn || { x: 0, z: 0 };
    const homes = [];
    for (let tries = 0; tries < 900 && homes.length < 3; tries++) {
      const first = homes.length === 0 && tries < 400;
      const a = rng.angle(), d = first ? rng.float(50, 120) : rng.float(30, w.playRadius - 40);
      const x = first ? sp.x + Math.cos(a) * d : Math.cos(a) * d, z = first ? sp.z + Math.sin(a) * d : Math.sin(a) * d;
      if (!this._walkable(x, z, 0.2) || hf.heightAt(x, z) > 45 || w.isExcluded(x, z)) continue;
      if (Math.hypot(x - sp.x, z - sp.z) < 40) continue;
      let room = true;
      for (let k = 0; k < 8 && room; k++) { const b = (k / 8) * Math.PI * 2; room = this._walkable(x + Math.cos(b) * 14, z + Math.sin(b) * 14, 0.35); }
      if (!room || homes.some((h) => Math.hypot(h.x - x, h.z - z) < 90)) continue;
      homes.push(V(x, 0, z));
    }
    if (!homes.length) homes.push(V(sp.x + 40, 0, sp.z + 40));
    return homes;
  }
  /** Prowlers den near the skitterer herds' grazing grounds, away from the landing site. */
  _prowlerHomes(rng) {
    const w = this.world, sp = w.sites.spawn || { x: 0, z: 0 };
    const spots = [];
    for (const k of this.skitter.items) if (!spots.some((s) => s.x === k.home.x && s.z === k.home.z)) spots.push({ x: k.home.x, z: k.home.z });
    const homes = [];
    for (let tries = 0; tries < 400 && homes.length < 2; tries++) {
      const s = spots.length ? spots[Math.floor(rng.next() * spots.length)] : { x: rng.float(-150, 150), z: rng.float(-150, 150) };
      const a = rng.angle(), d = rng.float(14, 30);
      const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
      if (!this._walkable(x, z, 0.35) || Math.hypot(x - sp.x, z - sp.z) < (tries < 200 ? 70 : 35)) continue;
      if (homes.some((h) => Math.hypot(h.x - x, h.z - z) < (tries < 200 ? 120 : 60))) continue;
      homes.push(V(x, 0, z));
    }
    if (!homes.length) homes.push(V(sp.x - 90, 0, sp.z - 90));
    return homes;
  }

  /** Update every creature. `player` = {pos (feet), eye, noise}. */
  update(dt, t, player, cam, extras) {
    const c = this.ctx;
    c.t = t; c.player = player; c.cam = cam;
    Object.assign(c, extras);
    for (const d of this.drifters) d.update(dt, c);
    this.skitter.update(dt, c);
    for (const s of this.striders) s.update(dt, c);
    this.moths.update(dt, c);
    this.tubes.update(dt, c);
    this.skyrays.update(dt, c);
    this.eels.update(dt, c);
    this.prowlers.update(dt, c, this.skitter.items);
    this.grazers.update(dt, c, this.prowlers.items);
    c.pulseFresh = false;
  }

  /** Keep the visitor out of the large animals' bodies (call before the player update). */
  pushPlayer(pos) {
    const a = this.grazers.pushOut(pos, 0.38);
    const b = this.prowlers.pushOut(pos, 0.38);
    return a || b;
  }

  /** Dynamic interactables (creature observation). Persistent objects: no per-frame allocation. */
  observables() {
    if (!this._obs) {
      this._obs = [];
      for (const d of this.drifters) this._obs.push({ kind: 'drifter', pos: d.pos, radius: 12 });
      for (const s of this.striders) this._obs.push({ kind: 'strider', pos: s.head.position, radius: 16 });
      for (const k of this.skitter.items) this._obs.push({ kind: 'skitter', pos: k.pos, radius: 7, ref: k });
      for (const g of this.grazers.items) this._obs.push({ kind: 'grazer', pos: g.headPos, radius: 24, ref: g });
      for (const g of this.prowlers.items) this._obs.push({ kind: 'prowler', pos: g.headPos, radius: 28, ref: g });
      for (const r of this.skyrays.items) this._obs.push({ kind: 'skyray', pos: r.pos, radius: 60 });
      for (const e of this.eels.items) this._obs.push({ kind: 'eel', pos: e.pos, radius: 14 });
    }
    for (const o of this._obs) if (o.ref) o.hidden = !o.ref.visible;
    return this._obs;
  }
}
