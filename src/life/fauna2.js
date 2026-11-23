// Second wave of fauna, filling the sky, the water and the open ground:
//  - Skyrays: manta-like gliders in flocks (boids), flapping when climbing, gliding when
//    descending, banking into turns, sometimes skimming the lake.
//  - Glow-eels: schools under the lake surface, undulating, darting away from swimmers,
//    occasionally leaping.
//  - Quadrupeds on a shared procedural rig (phase-based gait: walk / trot / gallop, 2-bone
//    leg IK on terrain, neck + head look-at, lagging tail):
//      Mossbacks — grazing herds that watch, then bolt from threats;
//      Shade Prowlers — predators that patrol, stalk skitterers, chase, feed and rest, and
//      keep their distance from the visitor.
import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { GeoBuilder, curvePoints, col } from '../world/geo.js';
import { makeBioMaterial } from '../world/materials.js';

const S = { IDLE: 'IDLE', WANDER: 'WANDER', DETECT: 'DETECT', REACT: 'REACT', RETURN: 'RETURN', STALK: 'STALK', CHASE: 'CHASE', FEED: 'FEED', REST: 'REST' };
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _f = V();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _s = V();
const _eu = new THREE.Euler();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

class Brain {
  constructor() { this.state = S.IDLE; this.t = 0; this.dur = 2; }
  set(s, dur = 2) { this.state = s; this.t = 0; this.dur = dur; }
  get calm() { return this.state === S.IDLE || this.state === S.WANDER || this.state === S.RETURN; }
}
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function solveKnee(hip, foot, l1, l2, pole, out) {
  _a.subVectors(foot, hip);
  let d = _a.length();
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) { _a.multiplyScalar(maxD / d); d = maxD; foot.copy(hip).add(_a); }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  _a.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a)).normalize();
  return out.copy(hip).addScaledVector(_a, a).addScaledVector(_b, h);
}
function segmentMatrix(A, B, r, out) {
  _c.subVectors(B, A);
  const len = _c.length();
  _q.setFromUnitVectors(UP, _c.divideScalar(Math.max(len, 1e-5)));
  return out.compose(A, _q, _s.set(r, len, r));
}

// ================================================================= Skyrays
function buildSkyray() {
  const b = new GeoBuilder();
  const top = col(0x1a2731), belly = col(0x5d6c70), glowC = col(0x7dffe6), vio = col(0xb08cff);
  b.swayFn = (p) => THREE.MathUtils.clamp(p.x / 1.7, -1, 1);
  b.ellipsoid(V(0, 0, 0.05), V(0.42, 0.15, 0.85), 16, 10, (nx, ny) => (ny > 0 ? top.clone().lerp(col(0x24384a), Math.abs(nx)) : belly), 0);
  // wing membranes (two-sided), swept back, thinning toward the tips
  for (const sd of [-1, 1]) {
    const rows = 7, cols = 4, front = [], back = [];
    for (let i = 0; i <= rows; i++) {
      const u = i / rows, x = sd * (0.3 + u * 1.45);
      const zl = 0.62 - u * 0.75, zt = -0.55 + u * 0.2;
      for (let j = 0; j <= cols; j++) {
        const v = j / cols, z = THREE.MathUtils.lerp(zl, zt, v);
        const y = Math.sin(Math.PI * v) * 0.04 * (1 - u) - u * u * 0.08;
        const edge = v > 0.75 && u > 0.2 && (i % 2 === 0);
        const c = edge ? (sd > 0 ? glowC : vio) : top.clone().lerp(col(0x2c4252), u * 0.6);
        const g = edge ? 0.9 : 0;
        front.push(b.vertex(V(x, y, z), V(0, 1, 0), c, g));
        back.push(b.vertex(V(x, y - 0.01, z), V(0, -1, 0), belly.clone().multiplyScalar(0.8), g * 0.5));
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, c2 = a + cols + 1;
      // winding: the upper sheet faces +Y, the lower sheet faces -Y (mirrored for the left wing)
      if (sd > 0) { b.quad(front[a], front[c2], front[c2 + 1], front[a + 1]); b.quad(back[a], back[a + 1], back[c2 + 1], back[c2]); }
      else { b.quad(front[a], front[a + 1], front[c2 + 1], front[c2]); b.quad(back[a], back[c2], back[c2 + 1], back[a + 1]); }
    }
  }
  // tail, cephalic lobes, eyes
  b.tube(curvePoints([V(0, 0.02, -0.75), V(0, 0.05, -1.4), V(0, 0.1, -2.2)], 6), (t) => 0.05 * (1 - t) + 0.008, 4, (t) => top.clone().lerp(glowC, t * t), (t) => (t > 0.9 ? 1 : 0));
  for (const sd of [-1, 1]) {
    b.ribbon([V(sd * 0.2, 0, 0.75), V(sd * 0.26, -0.05, 0.98), V(sd * 0.22, -0.1, 1.12)], (t) => 0.08 * (1 - t) + 0.02, V(1, 0, 0), () => top, () => 0);
    b.ellipsoid(V(sd * 0.3, 0.04, 0.6), V(0.04, 0.04, 0.04), 6, 4, glowC, 1);
  }
  return b.toGeometry();
}

export class Skyrays {
  constructor(rng, world, count = 21) {
    this.world = world; this.hf = world.hf; this.rng = rng;
    this.mat = makeBioMaterial({ wind: false, flap: true, instanceGlow: true, glow: 1.6, roughness: 0.5, translucent: true, skin: { scale: 1.6 } });
    this.mesh = new THREE.InstancedMesh(buildSkyray(), this.mat, count);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.name = 'skyrays';
    this.flocks = [];
    const nf = 3;
    for (let f = 0; f < nf; f++) {
      const p = this._goal(V());
      this.flocks.push({ target: p.clone(), goal: this._goal(V()), speed: rng.float(6, 9), skim: false, nextCall: rng.float(10, 40) });
    }
    this.items = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const fl = this.flocks[i % nf];
      const it = { f: i % nf, pos: fl.target.clone().add(V(rng.float(-8, 8), rng.float(-3, 3), rng.float(-8, 8))), vel: V(rng.float(-1, 1), 0, rng.float(-1, 1)).multiplyScalar(6), bank: 0, off: V(rng.float(-7, 7), rng.float(-2.5, 2.5), rng.float(-7, 7)), scale: rng.float(0.8, 1.3), effort: 0.3, flash: 0, q: new THREE.Quaternion() };
      this.items.push(it);
      this.mesh.setColorAt(i, c.setRGB(1, 0, 0.3));
    }
  }
  _goal(out) {
    const r = this.rng, R = this.world.playRadius - 30;
    const a = r.angle(), d = Math.sqrt(r.next()) * R;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    return out.set(x, Math.max(this.hf.heightAt(x, z), 0) + r.float(22, 48), z);
  }
  update(dt, ctx) {
    const hf = this.hf, W = hf.water, L = hf.lake;
    for (const fl of this.flocks) {
      _a.subVectors(fl.goal, fl.target);
      const d = _a.length();
      if (d < 6) {
        fl.skim = this.rng.chance(0.25);
        if (fl.skim) { const a = this.rng.angle(), rr = this.rng.float(0, 0.6); fl.goal.set(L.x + Math.cos(a) * L.rx * rr, W + 2.2, L.z + Math.sin(a) * L.rz * rr); }
        else this._goal(fl.goal);
        fl.speed = this.rng.float(6, 10);
      } else fl.target.addScaledVector(_a.divideScalar(d), Math.min(d, fl.speed * dt));
      fl.nextCall -= dt;
      if (fl.nextCall <= 0) { fl.nextCall = this.rng.float(18, 45); ctx.audio?.creatureCall('skyray', fl.target); }
    }
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i], fl = this.flocks[it.f];
      // cohesion to the flock target + personal slot, separation, terrain clearance
      _b.copy(fl.target).add(it.off).sub(it.pos).multiplyScalar(0.35);
      for (let j = 0; j < this.items.length; j++) {
        if (j === i) continue; const o = this.items[j]; if (o.f !== it.f) continue;
        _c.subVectors(it.pos, o.pos); const dd = _c.lengthSq();
        if (dd < 16 && dd > 1e-4) _b.addScaledVector(_c, (16 - dd) * 0.08 / Math.sqrt(dd));
      }
      const ground = Math.max(hf.heightAt(it.pos.x, it.pos.z), W);
      const minAlt = fl.skim ? 1.4 : 9;
      if (it.pos.y < ground + minAlt) _b.y += (ground + minAlt - it.pos.y) * 2.5;
      // shy of the visitor at close range
      _c.subVectors(it.pos, ctx.player.eye); const pd = _c.length();
      if (pd < 9) { _b.addScaledVector(_c.normalize(), (9 - pd) * 3); it.flash = Math.max(it.flash, 0.6); ctx.observe?.('skyray', it); }
      const prevY = it.vel.y;
      _d.copy(it.vel);
      it.vel.addScaledVector(_b, dt);
      const sp = it.vel.length();
      const maxS = fl.speed * 1.35, minS = 4.5;
      if (sp > maxS) it.vel.multiplyScalar(maxS / sp); else if (sp < minS) it.vel.multiplyScalar(minS / Math.max(sp, 1e-3));
      it.pos.addScaledVector(it.vel, dt);
      // hard floor: steering keeps them high, but a fast dive toward a ridge must not clip into it
      const floorY = Math.max(hf.heightAt(it.pos.x, it.pos.z), W) + 1.0;
      if (it.pos.y < floorY) { it.pos.y = floorY; if (it.vel.y < 0) it.vel.y *= -0.3; }
      // bank into turns, flap harder when climbing
      const turn = (_d.x * it.vel.z - _d.z * it.vel.x) / Math.max(_d.length() * it.vel.length(), 1e-3);
      it.bank += (THREE.MathUtils.clamp(-turn * 18, -0.9, 0.9) - it.bank) * Math.min(1, dt * 2.5);
      const climb = it.vel.y / Math.max(it.vel.length(), 1e-3);
      it.effort += (THREE.MathUtils.clamp(0.25 + climb * 2.2, 0.06, 1) - it.effort) * Math.min(1, dt * 1.5);
      _e.copy(it.vel).normalize();
      _m.lookAt(_f.set(0, 0, 0), _e.clone().negate(), UP);
      _q.setFromRotationMatrix(_m);
      _q2.setFromAxisAngle(_a.set(0, 0, 1), it.bank);
      _q.multiply(_q2);
      it.q.slerp(_q, Math.min(1, dt * 4));
      this.mesh.setMatrixAt(i, _m.compose(it.pos, it.q, _s.setScalar(it.scale)));
      it.flash = Math.max(0, it.flash - dt * 0.5);
      this.mesh.instanceColor.setXYZ(i, 1, it.flash + ctx.pulseNear(it.pos) * 0.6, it.effort);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// =============================================================== Glow-eels
function buildEel() {
  const b = new GeoBuilder();
  const skin = col(0x1d2b36), belly = col(0x4e5f66), glowC = col(0x7dffe6);
  b.swayFn = (p) => THREE.MathUtils.clamp((0.8 - p.z) / 1.6, 0, 1);
  const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(V(0, 0, 0.8 - t * 1.6)); }
  b.tube(pts, (t) => (t < 0.15 ? 0.05 + t * 0.25 : 0.09 * Math.pow(1 - (t - 0.15) / 0.85, 0.8)) + 0.006, 8,
    (t) => skin.clone().lerp(belly, 0.2), () => 0, { jitter: (t, a) => (Math.sin(a) < 0 ? 0.05 : 0) });
  // dorsal and ventral fin ribbons
  const fin = []; for (let i = 0; i <= 10; i++) { const t = 0.25 + i / 10 * 0.75; fin.push(V(0, 0.07 * (1 - t) + 0.035, 0.8 - t * 1.6)); }
  b.ribbon(fin, (t) => 0.035 + t * 0.025, V(0, 1, 0), () => skin.clone().multiplyScalar(0.8), (t) => (t > 0.85 ? 0.25 : 0));
  // lateral glowing spots and eyes
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 9; k++) { const t = 0.12 + k * 0.09; const r = (t < 0.15 ? 0.05 + t * 0.25 : 0.09 * Math.pow(1 - (t - 0.15) / 0.85, 0.8)); b.ellipsoid(V(sd * r * 0.95, 0.0, 0.8 - t * 1.6), V(0.02, 0.02, 0.028), 5, 3, glowC, 1.6); }
    b.ellipsoid(V(sd * 0.045, 0.025, 0.72), V(0.012, 0.012, 0.012), 5, 3, col(0xffd38a), 1);
  }
  return b.toGeometry();
}

export class GlowEels {
  constructor(rng, world, count = 16) {
    this.world = world; this.hf = world.hf; this.rng = rng;
    this.mat = makeBioMaterial({ wind: false, swim: true, instanceGlow: true, glow: 2.6, roughness: 0.22, skin: { scale: 6 } });
    this.mesh = new THREE.InstancedMesh(buildEel(), this.mat, count);
    this.mesh.frustumCulled = false; this.mesh.name = 'glowEels';
    this.items = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const p = this._spot(V());
      this.items.push({ pos: p, vel: V(rng.float(-1, 1), 0, rng.float(-1, 1)), target: this._spot(V()), depth: rng.float(0.45, 1.3), speed: rng.float(1.0, 1.8), flee: 0, leap: false, vy: 0, nextLeap: rng.float(25, 90), q: new THREE.Quaternion(), scale: rng.float(0.8, 1.4) });
      this.mesh.setColorAt(i, c.setRGB(1, 0, 0.3));
    }
  }
  _spot(out) {
    const hf = this.hf, L = hf.lake;
    for (let k = 0; k < 40; k++) {
      const a = this.rng.angle(), r = Math.sqrt(this.rng.next()) * 0.85;
      const x = L.x + Math.cos(a) * L.rx * r, z = L.z + Math.sin(a) * L.rz * r;
      if (hf.water - hf.heightAt(x, z) > 1.8) return out.set(x, hf.water - 1, z);
    }
    return out.set(L.x, hf.water - 1, L.z);
  }
  update(dt, ctx) {
    const hf = this.hf, W = hf.water, p = ctx.player;
    const playerWet = p.pos.y < W + 1.5;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.leap) {
        it.vy -= 9.8 * dt;
        it.pos.addScaledVector(it.vel, dt); it.pos.y += it.vy * dt;
        if (it.pos.y < W - 0.3 && it.vy < 0) {
          it.leap = false;
          if (it.pos.distanceTo(p.eye) < 45) ctx.observe?.('eel', it);
        }
      } else {
        _a.subVectors(it.target, it.pos); _a.y = 0;
        if (_a.length() < 2) this._spot(it.target);
        let want = it.speed;
        const pd = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
        if (playerWet && pd < 7) { it.flee = 2.2; }
        if (it.flee > 0) {
          it.flee -= dt; want = 5;
          _a.set(it.pos.x - p.pos.x, 0, it.pos.z - p.pos.z);
        }
        _a.normalize();
        _a.x += Math.sin(ctx.t * 0.7 + i) * 0.3; _a.z += Math.cos(ctx.t * 0.6 + i * 1.3) * 0.3;
        it.vel.lerp(_a.normalize().multiplyScalar(want), Math.min(1, dt * (it.flee > 0 ? 4 : 1.2)));
        const nx = it.pos.x + it.vel.x * dt, nz = it.pos.z + it.vel.z * dt;
        const floor = hf.heightAt(nx, nz);
        if (W - floor < 1.0) { it.vel.multiplyScalar(-0.5); this._spot(it.target); }
        else { it.pos.x = nx; it.pos.z = nz; }
        const ty = Math.max(floor + 0.35, W - it.depth - Math.sin(ctx.t * 0.4 + i) * 0.2);
        it.pos.y += (ty - it.pos.y) * Math.min(1, dt * 1.5);
        it.nextLeap -= dt;
        if (it.nextLeap <= 0 && it.flee <= 0 && W - floor > 2) {
          it.nextLeap = this.rng.float(30, 100);
          // only leap where it will land in deep water again (about 3 m ahead), never onto the shore
          const sp = it.vel.length() || 1, lx = it.pos.x + it.vel.x / sp * 3.2, lz = it.pos.z + it.vel.z / sp * 3.2;
          if (W - hf.heightAt(lx, lz) > 1.5) { it.leap = true; it.vy = 4.6; it.pos.y = W - 0.2; it.vel.setLength(3.2); }
        }
      }
      // orient along velocity (pitch included while leaping)
      _e.set(it.vel.x, it.leap ? it.vy * 0.6 : (it.pos.y - (it._py ?? it.pos.y)) / Math.max(dt, 1e-3) * 0.3, it.vel.z);
      it._py = it.pos.y;
      if (_e.lengthSq() > 1e-6) { _m.lookAt(_f.set(0, 0, 0), _e.normalize().negate(), UP); _q.setFromRotationMatrix(_m); it.q.slerp(_q, Math.min(1, dt * 5)); }
      this.mesh.setMatrixAt(i, _m.compose(it.pos, it.q, _s.setScalar(it.scale)));
      this.mesh.instanceColor.setXYZ(i, 1, (it.flee > 0 ? 0.5 : 0) + ctx.pulseNear(it.pos), THREE.MathUtils.clamp(it.vel.length() / 5, 0.15, 1));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ========================================================= Quadruped rig
const SPECIES = {
  grazer: {
    bodyLen: 2.25, chest: 0.52, belly: 0.46, hips: 0.42, thigh: 0.62, shin: 0.68, neckLen: 1.0, headLen: 0.58,
    tailSegs: 4, tailLen: 0.95, walk: 1.25, trot: 3.2, run: 7.2, strideWalk: 1.05, strideRun: 2.1, neckRest: 0.55, grazePitch: -0.95,
    colTop: 0x3b4a3a, colMoss: 0x4a6b3a, colBelly: 0x6b7262, colGlow: 0x7dffe6, legCol: 0x2a332b, skinScale: 1.4, legR: 2.1,
  },
  prowler: {
    bodyLen: 2.0, chest: 0.36, belly: 0.3, hips: 0.32, thigh: 0.5, shin: 0.56, neckLen: 0.5, headLen: 0.55,
    tailSegs: 7, tailLen: 1.7, walk: 1.4, trot: 3.6, run: 8.5, strideWalk: 1.0, strideRun: 2.6, neckRest: 0.12, grazePitch: -0.5,
    colTop: 0x10161e, colMoss: 0x1a2030, colBelly: 0x252b38, colGlow: 0xa77cff, legCol: 0x0d1117, skinScale: 2.2, legR: 1.5,
  },
};

function buildQuadBody(sp, kind) {
  const b = new GeoBuilder();
  const top = col(sp.colTop), moss = col(sp.colMoss), belly = col(sp.colBelly), glow = col(sp.colGlow);
  const L = sp.bodyLen;
  const pts = []; const N = 22;
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(V(0, Math.sin(Math.PI * t) * 0.06 + (t > 0.8 ? (t - 0.8) * 0.4 : 0), -L / 2 + t * L)); }
  // rounded rump, belly, deep chest, rounded front (the neck covers the front cap)
  const lerp = THREE.MathUtils.lerp;
  const prof = (t) => {
    if (t < 0.2) { const u = t / 0.2; return sp.hips * (0.01 + 0.99 * Math.sqrt(1 - (1 - u) * (1 - u))); }
    if (t < 0.55) return lerp(sp.hips, sp.belly, (t - 0.2) / 0.35);
    if (t < 0.84) return lerp(sp.belly, sp.chest, (t - 0.55) / 0.29);
    const u = (t - 0.84) / 0.16; return sp.chest * (0.4 + 0.6 * Math.sqrt(Math.max(0, 1 - u * u)));
  };
  b.tube(pts, prof, 18, (t) => top.clone(), () => 0, {
    capEnd: true,
    jitter: (t, a) => (Math.sin(a) > 0 ? 0.12 * Math.sin(a) : -0.08 * Math.abs(Math.sin(a))) + 0.03 * Math.sin(a * 7 + t * 20),
  });
  const g = b;
  // back ridge: moss tufts (grazer) or glowing stripe plates (prowler)
  for (let i = 0; i < 9; i++) {
    const t = 0.12 + i * 0.09, z = -L / 2 + t * L, r = prof(t);
    if (kind === 'grazer') {
      g.ellipsoid(V(0, r * 0.95 + 0.04, z), V(r * 0.55, 0.09, 0.16), 8, 5, moss.clone().multiplyScalar(0.9 + (i % 3) * 0.08), 0, { displace: (nx, ny, nz) => Math.sin(nx * 9 + i) * 0.15 });
      if (i % 2 === 0) g.tube([V(0, r + 0.1, z), V(0, r + 0.26, z - 0.04), V(0, r + 0.34, z - 0.1)], (tt) => 0.012 * (1 - tt) + 0.004, 3, (tt) => moss.clone().lerp(glow, tt), (tt) => tt * 0.9);
    } else {
      for (const sd of [-1, 1]) g.ribbon([V(sd * r * 0.55, r * 0.7, z), V(sd * r * 0.9, r * 0.2, z + 0.03), V(sd * r * 0.95, -r * 0.2, z + 0.05)], () => 0.035, V(0, 0, 1), () => glow, () => 0.8);
    }
  }
  // belly plate (paler)
  g.ellipsoid(V(0, -sp.belly * 0.55, 0.05), V(sp.belly * 0.75, sp.belly * 0.42, L * 0.36), 12, 6, belly, 0);
  // flank spots
  for (const sd of [-1, 1]) for (let k = 0; k < (kind === 'grazer' ? 5 : 3); k++) {
    const t = 0.3 + k * 0.1, r = prof(t);
    g.ellipsoid(V(sd * r * 1.02, 0.05 - (k % 2) * 0.08, -L / 2 + t * L), V(0.025, 0.025, 0.04), 5, 3, glow, kind === 'grazer' ? 0.7 : 1);
  }
  return g.toGeometry();
}
function buildQuadNeck(sp, kind) {
  const b = new GeoBuilder();
  const top = col(sp.colTop), glow = col(sp.colGlow), moss = col(sp.colMoss);
  const pts = curvePoints([V(0, 0, 0), V(0, 0.04, sp.neckLen * 0.5), V(0, 0, sp.neckLen)], 8);
  b.tube(pts, (t) => THREE.MathUtils.lerp(sp.chest * 0.6, sp.chest * 0.32, t), 10, () => top, () => 0, { jitter: (t, a) => (Math.sin(a) > 0 ? 0.08 : -0.05) * Math.abs(Math.sin(a)) });
  if (kind === 'grazer') for (let i = 0; i < 7; i++) { const t = 0.1 + i * 0.12; const z = t * sp.neckLen, r = THREE.MathUtils.lerp(sp.chest * 0.6, sp.chest * 0.32, t); b.tube([V(0, r, z), V(0, r + 0.16, z - 0.05), V(0, r + 0.24, z - 0.12)], (tt) => 0.012 * (1 - tt) + 0.003, 3, (tt) => moss.clone().lerp(glow, tt), (tt) => tt); }
  return b.toGeometry();
}
function buildQuadHead(sp, kind) {
  const b = new GeoBuilder();
  const top = col(sp.colTop), glow = col(sp.colGlow), belly = col(sp.colBelly);
  const hl = sp.headLen;
  b.ellipsoid(V(0, 0.02, hl * 0.45), V(kind === 'grazer' ? 0.16 : 0.18, kind === 'grazer' ? 0.17 : 0.11, hl * 0.55), 14, 9, (nx, ny) => (ny < -0.3 ? belly : top), 0,
    { displace: (nx, ny, nz) => (nz > 0.5 ? -0.12 * (nz - 0.5) : 0) });
  for (const sd of [-1, 1]) {
    b.ellipsoid(V(sd * (kind === 'grazer' ? 0.12 : 0.13), 0.06, hl * 0.62), V(0.035, 0.03, 0.035), 6, 4, kind === 'grazer' ? col(0xffd38a) : glow, 1);
    if (kind === 'grazer') { // ear-fronds and short horns
      b.ribbon([V(sd * 0.1, 0.13, hl * 0.25), V(sd * 0.24, 0.24, hl * 0.05), V(sd * 0.3, 0.26, -hl * 0.1)], (t) => 0.07 * (1 - t) + 0.01, V(0, 1, 0), (t) => top.clone().lerp(glow, t * 0.5), (t) => t * 0.4);
      b.tube([V(sd * 0.06, 0.16, hl * 0.45), V(sd * 0.09, 0.3, hl * 0.4), V(sd * 0.07, 0.4, hl * 0.32)], (t) => 0.025 * (1 - t) + 0.005, 4, () => col(0x8a8170), () => 0);
    } else {
      b.prism(V(sd * 0.07, -0.06, hl * 0.95), V(0, -1, 0.3), 0.08, 0.012, 4, col(0xd8d4c8), 0, 0, { tip: 0.04 });
    }
  }
  return b.toGeometry();
}

export class Quadrupeds {
  constructor(rng, world, kind, homes, perHome) {
    this.world = world; this.hf = world.hf; this.rng = rng; this.kind = kind;
    const sp = this.sp = SPECIES[kind];
    const n = homes.length * perHome;
    const mat = makeBioMaterial({ wind: false, instanceGlow: true, glow: kind === 'grazer' ? 1.3 : 1.8, roughness: kind === 'grazer' ? 0.8 : 0.45, skin: { scale: sp.skinScale } });
    this.mat = mat;
    const mk = (geo, count, m = mat) => { const im = new THREE.InstancedMesh(geo, m, count); im.frustumCulled = false; im.castShadow = true; return im; };
    this.body = mk(buildQuadBody(sp, kind), n);
    this.neck = mk(buildQuadNeck(sp, kind), n);
    this.head = mk(buildQuadHead(sp, kind), n);
    // tapered limb segment with a muscle bulge near its top (origin = joint above, +Y = joint below)
    const legProfile = [];
    for (let k = 0; k <= 8; k++) { const y = k / 8; legProfile.push(new THREE.Vector2(0.05 * (1 - 0.48 * y) * (1 + 0.32 * Math.sin(Math.PI * Math.min(1, y * 1.5))), y)); }
    legProfile.unshift(new THREE.Vector2(0.001, 0)); legProfile.push(new THREE.Vector2(0.001, 1));
    const legGeo = new THREE.LatheGeometry(legProfile, 8);
    const legMat = makeBioMaterial({ wind: false, roughness: 0.7, skin: { scale: sp.skinScale * 2 } });
    const lg = new GeoBuilder(); lg.addGeometry(legGeo, col(sp.legCol), 0);
    this.legs = mk(lg.toGeometry(), n * 8, legMat);
    const fg = new GeoBuilder(); fg.ellipsoid(V(0, 0.03, 0.04), V(0.07, 0.05, 0.11), 8, 5, col(sp.legCol).multiplyScalar(0.8), 0);
    this.feet = mk(fg.toGeometry(), n * 4, legMat);
    const tg = new GeoBuilder(); tg.addGeometry(legGeo, col(sp.colTop), 0);
    this.tail = mk(tg.toGeometry(), n * sp.tailSegs, legMat);
    this.group = new THREE.Group(); this.group.name = kind + 's';
    this.group.add(this.body, this.neck, this.head, this.legs, this.feet, this.tail);
    for (const im of [this.body, this.neck, this.head]) { for (let i = 0; i < n; i++) im.setColorAt(i, new THREE.Color(1, 0, 0)); }
    this.items = [];
    const L = sp.bodyLen, hipH = (sp.thigh + sp.shin) * 0.9;
    homes.forEach((home, h) => {
      for (let k = 0; k < perHome; k++) {
        const x = home.x + rng.float(-6, 6), z = home.z + rng.float(-6, 6);
        const it = {
          herd: h, home: home.clone(), brain: new Brain(), pos: V(x, this.hf.heightAt(x, z), z), yaw: rng.angle(), speed: 0, target: V(x, 0, z),
          phase: rng.next(), legs: [], tailDirs: [], hipH, scale: rng.float(0.88, 1.12) * (kind === 'grazer' && k === 0 ? 1.12 : 1),
          neckPitch: sp.neckRest, headYaw: 0, look: V(), lookW: 0, flash: 0, lastCall: -99, crouch: 0, prey: null, alive: true, threat: V(), threatD: 1e9,
          grazeT: rng.float(0, 5), bodyQ: new THREE.Quaternion(), bodyPos: V(), headPos: V(x, this.hf.heightAt(x, z) + 1.5, z), visible: true,
        };
        const offs = [[-1, -1], [1, -1], [-1, 1], [1, 1]]; // LH, RH, LF, RF
        for (const [sx, sz] of offs) {
          const front = sz > 0;
          const hip = V(sx * (front ? sp.chest : sp.hips) * 0.72, -0.08, sz * L * (front ? 0.34 : 0.33));
          const rest = V(sx * (front ? sp.chest : sp.hips) * 0.8, 0, sz * L * (front ? 0.36 : 0.32));
          it.legs.push({ hip, rest, front, side: sx, foot: V(), from: V(), swing: false });
        }
        for (const lgd of it.legs) { this._legRestWorld(it, lgd.rest, lgd.foot); }
        for (let s = 0; s < sp.tailSegs; s++) it.tailDirs.push(V(0, -0.4, -1).normalize());
        this.items.push(it);
      }
    });
    this.knee = V(); this.hipW = V();
  }

  _legRestWorld(it, rest, out) {
    out.copy(rest).multiplyScalar(it.scale).applyAxisAngle(UP, it.yaw).add(it.pos);
    out.y = this.hf.heightAt(out.x, out.z);
    return out;
  }
  canWalk(x, z) {
    const h = this.hf.heightAt(x, z);
    return h > this.hf.water + 0.1 && this.hf.slopeAt(x, z) < 0.45 && Math.hypot(x, z) < this.world.playRadius - 12;
  }
  pickTarget(it, radius) {
    for (let k = 0; k < 14; k++) {
      const a = this.rng.angle(), r = this.rng.float(radius * 0.3, radius);
      const x = it.home.x + Math.cos(a) * r, z = it.home.z + Math.sin(a) * r;
      if (this.canWalk(x, z)) { it.target.set(x, 0, z); return true; }
    }
    it.target.copy(it.home); return false;
  }

  /** Locomotion + rig. `want` = desired speed; heading toward it.target. */
  locomote(it, i, dt, want, ctx) {
    const sp = this.sp, hf = this.hf;
    if (want > 0.01) {
      const ty = Math.atan2(it.target.x - it.pos.x, it.target.z - it.pos.z);
      let dy = wrapAngle(ty - it.yaw);
      // probe ahead for water / cliffs / obstacles
      const px = it.pos.x + Math.sin(it.yaw) * 2.5, pz = it.pos.z + Math.cos(it.yaw) * 2.5;
      if (!this.canWalk(px, pz)) dy += 1.4;
      const turnRate = want > sp.trot ? 2.4 : 1.6;
      it.yaw += THREE.MathUtils.clamp(dy, -dt * turnRate, dt * turnRate);
      if (Math.abs(dy) > 1.3) want *= 0.35;
    }
    it.speed += (want - it.speed) * Math.min(1, dt * (want > it.speed ? 2.2 : 3));
    const nx = it.pos.x + Math.sin(it.yaw) * it.speed * dt, nz = it.pos.z + Math.cos(it.yaw) * it.speed * dt;
    if (this.canWalk(nx, nz) || it.speed < 0.05) { it.pos.x = nx; it.pos.z = nz; } else it.speed *= 0.5;
    this.world.colliders.resolve(it.pos, 0.6 * it.scale);
    it.pos.y = hf.heightAt(it.pos.x, it.pos.z);

    // gait selection
    const sc = it.scale;
    let offs, duty, stride, lift;
    if (it.speed < sp.walk * 1.4) { offs = [0, 0.5, 0.75, 0.25]; duty = 0.66; stride = sp.strideWalk; lift = 0.12; }        // walk: LH, RH, LF, RF lateral sequence
    else if (it.speed < sp.trot * 1.3) { offs = [0, 0.5, 0.5, 0]; duty = 0.5; stride = (sp.strideWalk + sp.strideRun) * 0.5; lift = 0.18; } // trot: diagonal pairs
    else { offs = [0, 0.08, 0.55, 0.62]; duty = 0.36; stride = sp.strideRun; lift = 0.26; }                                   // gallop
    const freq = it.speed > 0.06 ? it.speed / (stride * sc) : 0;
    it.phase = (it.phase + freq * dt) % 1;
    let footY = 0;
    for (let k = 0; k < 4; k++) {
      const lg = it.legs[k];
      this._legRestWorld(it, lg.rest, _d);
      if (freq > 0) {
        const lp = (it.phase + offs[k]) % 1;
        if (lp < duty) { if (lg.swing) { lg.swing = false; lg.foot.y = hf.heightAt(lg.foot.x, lg.foot.z); } } // touch-down: plant on the ground
        else {
          const s = (lp - duty) / (1 - duty);
          if (!lg.swing) { lg.swing = true; lg.from.copy(lg.foot); }
          // land so that the stance is centred under the hip
          _d.x += Math.sin(it.yaw) * it.speed * (duty / Math.max(freq, 1e-3)) * 0.5;
          _d.z += Math.cos(it.yaw) * it.speed * (duty / Math.max(freq, 1e-3)) * 0.5;
          _d.y = hf.heightAt(_d.x, _d.z);
          const e = s * s * (3 - 2 * s);
          lg.foot.lerpVectors(lg.from, _d, e);
          lg.foot.y += Math.sin(Math.PI * s) * lift * sc;
        }
      } else {
        // standing: settle any foot that is far from its rest spot, keeping it on the ground
        // (also lands a foot that was mid-swing when the animal stopped)
        if (lg.foot.distanceTo(_d) > 0.28 * sc) lg.foot.lerp(_d, Math.min(1, dt * 6));
        lg.foot.y = hf.heightAt(lg.foot.x, lg.foot.z);
        lg.swing = false;
      }
      footY += lg.foot.y;
    }
    footY /= 4;
    // body pose: height from the feet, pitch from the terrain under front & rear legs
    const L = sp.bodyLen * sc;
    const hF = hf.heightAt(it.pos.x + Math.sin(it.yaw) * L * 0.4, it.pos.z + Math.cos(it.yaw) * L * 0.4);
    const hB = hf.heightAt(it.pos.x - Math.sin(it.yaw) * L * 0.4, it.pos.z - Math.cos(it.yaw) * L * 0.4);
    const pitch = -Math.atan2(hF - hB, L * 0.8);
    const gallop = it.speed > sp.trot * 1.3;
    const bob = freq > 0 ? Math.sin(it.phase * Math.PI * (gallop ? 2 : 4)) * (gallop ? 0.09 : 0.03) * sc : Math.sin(ctx.t * 1.3 + i) * 0.008;
    const breathe = 1 + Math.sin(ctx.t * (it.brain.state === S.REACT ? 4.5 : 1.4) + i) * 0.015;
    const bodyY = Math.max(footY, it.pos.y) + it.hipH * sc * (1 - it.crouch * 0.35) + bob;
    it.bodyPos.set(it.pos.x, it.bodyPos.y ? it.bodyPos.y + (bodyY - it.bodyPos.y) * Math.min(1, dt * 8) : bodyY, it.pos.z);
    _eu.set(pitch + (gallop ? Math.sin(it.phase * Math.PI * 2) * 0.06 : 0), it.yaw, Math.sin(it.phase * Math.PI * 2) * 0.025 * (freq > 0 ? 1 : 0), 'YXZ');
    it.bodyQ.setFromEuler(_eu);
    this.body.setMatrixAt(i, _m.compose(it.bodyPos, it.bodyQ, _s.set(sc * breathe, sc * breathe, sc)));
    // legs
    for (let k = 0; k < 4; k++) {
      const lg = it.legs[k];
      this.hipW.copy(lg.hip).multiplyScalar(sc).applyQuaternion(it.bodyQ).add(it.bodyPos);
      _e.set(Math.sin(it.yaw), 0, Math.cos(it.yaw)).multiplyScalar(lg.front ? -1 : 1).add(_f.set(0, 0.15, 0));
      _d.copy(lg.foot); _d.y += 0.02;
      solveKnee(this.hipW, _d, sp.thigh * sc, sp.shin * sc, _e, this.knee);
      this.legs.setMatrixAt(i * 8 + k * 2, segmentMatrix(this.hipW, this.knee, (lg.front ? 1.25 : 1.6) * sp.legR * sc, _m));
      this.legs.setMatrixAt(i * 8 + k * 2 + 1, segmentMatrix(this.knee, _d, 0.95 * sp.legR * sc, _m));
      _q.setFromAxisAngle(UP, it.yaw);
      this.feet.setMatrixAt(i * 4 + k, _m.compose(_d, _q, _s.setScalar(sc)));
    }
    // neck & head (look-at with limits)
    const neckBase = _a.set(0, sp.chest * 0.45, L * 0.47 / sc).multiplyScalar(sc).applyQuaternion(it.bodyQ).add(it.bodyPos);
    let wantYaw = 0, wantPitch = sp.neckRest;
    if (it.lookW > 0.01) {
      const dx = it.look.x - neckBase.x, dz = it.look.z - neckBase.z;
      wantYaw = THREE.MathUtils.clamp(wrapAngle(Math.atan2(dx, dz) - it.yaw), -1.0, 1.0) * it.lookW;
      wantPitch = THREE.MathUtils.lerp(sp.neckRest, sp.neckRest + 0.25, it.lookW);
    } else if (it.brain.state === S.IDLE && this.kind === 'grazer') {
      // graze: head down most of the time, look up now and then
      const g = (ctx.t * 0.25 + it.grazeT) % 1;
      wantPitch = g < 0.72 ? sp.grazePitch + Math.sin(ctx.t * 6 + i) * 0.05 : sp.neckRest + 0.1;
      wantYaw = Math.sin(ctx.t * 0.3 + i) * 0.3;
    } else if (it.brain.state === S.FEED) { wantPitch = sp.grazePitch; }
    else if (gallop) wantPitch = sp.neckRest * 0.4;
    it.neckPitch += (wantPitch - it.neckPitch) * Math.min(1, dt * 2.5);
    it.headYaw += (wantYaw - it.headYaw) * Math.min(1, dt * 3);
    _eu.set(-it.neckPitch, it.headYaw, 0, 'YXZ'); _q2.setFromEuler(_eu);
    _q.copy(it.bodyQ).multiply(_q2);
    this.neck.setMatrixAt(i, _m.compose(neckBase, _q, _s.setScalar(sc)));
    const headPos = _b.set(0, 0, sp.neckLen * sc).applyQuaternion(_q).add(neckBase);
    _eu.set(it.neckPitch * 0.75 - (it.neckPitch < 0 ? 0.35 : 0), 0, 0, 'YXZ'); _q3.setFromEuler(_eu);
    _q.multiply(_q3);
    this.head.setMatrixAt(i, _m.compose(headPos, _q, _s.setScalar(sc)));
    it.headPos.copy(headPos);
    it.visible = true;
    // tail: lagging chain with sag and swish
    let tp = _c.set(0, sp.hips * 0.4, -L * 0.5 / sc).multiplyScalar(sc).applyQuaternion(it.bodyQ).add(it.bodyPos);
    const back = _f.set(-Math.sin(it.yaw), 0, -Math.cos(it.yaw));
    const segL = sp.tailLen * sc / sp.tailSegs;
    for (let s = 0; s < sp.tailSegs; s++) {
      const dir = it.tailDirs[s];
      _e.copy(back).add(_d.set(0, this.kind === 'prowler' ? 0.15 - s * 0.12 : -0.9, 0)).addScaledVector(_d.set(Math.cos(it.yaw), 0, -Math.sin(it.yaw)), Math.sin(ctx.t * (2 + it.speed) - s * 0.7 + i) * 0.35).normalize();
      dir.lerp(_e, Math.min(1, dt * (6 - s * 0.6))).normalize();
      const next = _b.copy(tp).addScaledVector(dir, segL);
      this.tail.setMatrixAt(i * sp.tailSegs + s, segmentMatrix(tp, next, (1.4 - s / sp.tailSegs) * 0.9 * sc, _m));
      tp = _c.copy(next);
    }
    // glow flare
    const fl = it.flash + ctx.pulseNear(it.bodyPos) * 0.6;
    this.body.instanceColor.setXYZ(i, 1, fl, 0); this.neck.instanceColor.setXYZ(i, 1, fl, 0); this.head.instanceColor.setXYZ(i, 1, fl, 0);
  }

  /** Herd-mates keep a body length apart instead of walking through each other. */
  separate(dt) {
    const k = Math.min(1, dt * 4);
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      for (let j = i + 1; j < this.items.length; j++) {
        const b = this.items[j];
        if (a.herd !== b.herd) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        const minD = this.sp.bodyLen * 0.75 * (a.scale + b.scale) * 0.5;
        if (d >= minD || d < 1e-4) continue;
        const push = (minD - d) * 0.5 * k / d;
        a.pos.x -= dx * push; a.pos.z -= dz * push; b.pos.x += dx * push; b.pos.z += dz * push;
      }
    }
  }

  /** Push a point (the visitor's feet) out of the bodies of nearby visible animals. Returns true if moved. */
  pushOut(p, r) {
    let moved = false;
    for (const it of this.items) {
      if (!it.visible || Math.abs(p.y - it.pos.y) > 2.5) continue;
      if (Math.abs(p.x - it.pos.x) > 4 || Math.abs(p.z - it.pos.z) > 4) continue;
      const fx = Math.sin(it.yaw), fz = Math.cos(it.yaw), L = this.sp.bodyLen * 0.28 * it.scale;
      const R = this.sp.belly * 1.25 * it.scale + r;
      for (let s = -1; s <= 1; s += 2) { // the torso as two circles, rump and chest
        const cx = it.pos.x + fx * L * s, cz = it.pos.z + fz * L * s;
        const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d < R && d > 1e-4) { p.x = cx + dx / d * R; p.z = cz + dz / d * R; moved = true; }
      }
    }
    return moved;
  }

  /** Off-screen (beyond 220 m): keep walking toward the target without posing the rig. */
  _coarseMove(it, dt, want) {
    if (want > 0.01) {
      const ty = Math.atan2(it.target.x - it.pos.x, it.target.z - it.pos.z);
      it.yaw += THREE.MathUtils.clamp(wrapAngle(ty - it.yaw), -dt * 2, dt * 2);
    }
    it.speed += (want - it.speed) * Math.min(1, dt * 2.5);
    const nx = it.pos.x + Math.sin(it.yaw) * it.speed * dt, nz = it.pos.z + Math.cos(it.yaw) * it.speed * dt;
    if (this.canWalk(nx, nz)) { it.pos.x = nx; it.pos.z = nz; } else { it.yaw += 1.2; it.speed *= 0.5; }
    it.pos.y = this.hf.heightAt(it.pos.x, it.pos.z);
    it.bodyPos.set(it.pos.x, it.pos.y + it.hipH * it.scale, it.pos.z);
    it.headPos.set(it.pos.x + Math.sin(it.yaw) * this.sp.bodyLen * 0.8, it.bodyPos.y + 0.5, it.pos.z + Math.cos(it.yaw) * this.sp.bodyLen * 0.8);
    for (const lg of it.legs) this._legRestWorld(it, lg.rest, lg.foot);
  }

  hide(it, i) {
    it.visible = false;
    this.body.setMatrixAt(i, ZERO_M); this.neck.setMatrixAt(i, ZERO_M); this.head.setMatrixAt(i, ZERO_M);
    for (let k = 0; k < 8; k++) this.legs.setMatrixAt(i * 8 + k, ZERO_M);
    for (let k = 0; k < 4; k++) this.feet.setMatrixAt(i * 4 + k, ZERO_M);
    for (let k = 0; k < this.sp.tailSegs; k++) this.tail.setMatrixAt(i * this.sp.tailSegs + k, ZERO_M);
  }

  flush() {
    for (const im of [this.body, this.neck, this.head, this.legs, this.feet, this.tail]) im.instanceMatrix.needsUpdate = true;
    for (const im of [this.body, this.neck, this.head]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}

/** Mossbacks: grazing herds. Threats are the visitor (scaled by noise) and prowlers. */
export class Grazers extends Quadrupeds {
  constructor(rng, world, homes) { super(rng, world, 'grazer', homes, 5); }
  update(dt, ctx, prowlers) {
    const sp = this.sp, p = ctx.player;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i], b = it.brain; b.t += dt;
      const camD = Math.hypot(it.pos.x - ctx.cam.x, it.pos.z - ctx.cam.z);
      // nearest threat
      let td = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z) / Math.max(0.35, Math.pow(p.noise, 0.6));
      it.threat.copy(p.pos);
      for (const pr of prowlers) { const d = Math.hypot(it.pos.x - pr.pos.x, it.pos.z - pr.pos.z) * (pr.crouch > 0.5 ? 1.6 : 0.8); if (d < td) { td = d; it.threat.copy(pr.pos); } }
      if (b.calm && td < 24) { b.set(S.DETECT, 1.3); it.flash = 0.3; if (ctx.t - it.lastCall > 9) { ctx.audio?.creatureCall('grazer', it.headPos || it.pos); it.lastCall = ctx.t; } }
      let want = 0;
      it.lookW = 0;
      switch (b.state) {
        case S.IDLE: if (b.t > b.dur) { this.pickTarget(it, 30); b.set(S.WANDER, 40); } break;
        case S.WANDER: want = sp.walk; if (Math.hypot(it.target.x - it.pos.x, it.target.z - it.pos.z) < 2 || b.t > b.dur) b.set(S.IDLE, this.rng.float(6, 15)); break;
        case S.DETECT:
          it.look.copy(it.threat); it.look.y += 1; it.lookW = 1;
          if (b.t > b.dur) {
            if (td < 15) {
              for (const o of this.items) if (o.herd === it.herd && o.brain.state !== S.REACT && o.pos.distanceTo(it.pos) < 25) { o.brain.set(S.REACT, this.rng.float(5, 8)); o.flash = 1; o.threat.copy(it.threat); }
              ctx.observe?.('grazer', it);
            } else if (td > 26) b.set(S.IDLE, 3); else b.t = 0;
          }
          break;
        case S.REACT: {
          want = sp.run;
          const ax = it.pos.x - it.threat.x, az = it.pos.z - it.threat.z, al = Math.hypot(ax, az) || 1;
          it.target.set(it.pos.x + ax / al * 20, 0, it.pos.z + az / al * 20);
          if (b.t > b.dur && td > 40) { b.set(S.RETURN, 50); }
          break;
        }
        case S.RETURN: want = sp.walk * 1.6; it.target.copy(it.home); if (Math.hypot(it.home.x - it.pos.x, it.home.z - it.pos.z) < 12 || b.t > b.dur) b.set(S.IDLE, 5); break;
      }
      it.flash = Math.max(0, it.flash - dt * 0.4);
      if (camD > 220) { this.hide(it, i); this._coarseMove(it, dt, want); continue; }
      this.locomote(it, i, dt, want, ctx);
    }
    this.separate(dt);
    this.flush();
  }
}

/** Shade Prowlers: patrol, stalk skitterers, chase, feed, rest; avoid the visitor. */
export class Prowlers extends Quadrupeds {
  constructor(rng, world, homes) { super(rng, world, 'prowler', homes, 1); }
  update(dt, ctx, prey) {
    const sp = this.sp, p = ctx.player;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i], b = it.brain; b.t += dt;
      const pd = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
      const camD = Math.hypot(it.pos.x - ctx.cam.x, it.pos.z - ctx.cam.z);
      const wary = 16 * Math.pow(p.noise, 0.5);
      let want = 0; it.lookW = 0;
      if (pd < wary && b.state !== S.REACT && b.state !== S.DETECT) { b.set(S.DETECT, 2.2); it.prey = null; if (ctx.t - it.lastCall > 8) { ctx.audio?.creatureCall('prowler', it.headPos || it.pos); it.lastCall = ctx.t; } }
      it.crouch += ((b.state === S.STALK || b.state === S.FEED || b.state === S.REST ? 1 : 0) - it.crouch) * Math.min(1, dt * 2);
      switch (b.state) {
        case S.IDLE:
          if (b.t > b.dur) { this.pickTarget(it, 70); b.set(S.WANDER, 60); }
          break;
        case S.WANDER: {
          want = sp.walk;
          // look for prey while patrolling
          let best = null, bd = 42;
          if (ctx.t > (it.fedUntil || 0)) for (const q of prey) { if (!q.alive) continue; const d = Math.hypot(q.pos.x - it.pos.x, q.pos.z - it.pos.z); if (d < bd) { bd = d; best = q; } }
          if (best && b.t > 4) { it.prey = best; b.set(S.STALK, 30); break; }
          if (Math.hypot(it.target.x - it.pos.x, it.target.z - it.pos.z) < 3 || b.t > b.dur) b.set(S.IDLE, this.rng.float(4, 10));
          break;
        }
        case S.STALK: {
          const q = it.prey;
          if (!q || !q.alive) { b.set(S.IDLE, 3); break; }
          it.target.set(q.pos.x, 0, q.pos.z); want = 1.0;
          it.look.copy(q.pos); it.lookW = 0.8;
          const d = Math.hypot(q.pos.x - it.pos.x, q.pos.z - it.pos.z);
          if (d < 9) { b.set(S.CHASE, 4.5); if (camD < 90) ctx.audio?.creatureCall('prowler', it.headPos); }
          else if (b.t > b.dur) b.set(S.IDLE, 5);
          break;
        }
        case S.CHASE: {
          const q = it.prey;
          if (!q || !q.alive) { b.set(S.REST, 6); break; }
          it.target.set(q.pos.x, 0, q.pos.z); want = sp.run;
          q.chasedBy = it;
          if (Math.hypot(q.pos.x - it.pos.x, q.pos.z - it.pos.z) < 1.3) {
            q.alive = false; q.respawnAt = ctx.t + 90; q.chasedBy = null; it.prey = null;
            it.fedUntil = ctx.t + this.rng.float(100, 170); it.kills = (it.kills || 0) + 1;
            b.set(S.FEED, 12);
            if (pd < 60) ctx.observe?.('prowler', it);
          } else if (b.t > b.dur) {
            // out of breath: give up, rest, and leave this herd alone for a while
            q.chasedBy = null; it.prey = null; it.fedUntil = ctx.t + this.rng.float(25, 45); it.misses = (it.misses || 0) + 1;
            b.set(S.REST, 8);
          }
          break;
        }
        case S.FEED: if (b.t > b.dur) b.set(S.REST, this.rng.float(18, 30)); break;
        case S.REST: if (b.t > b.dur) b.set(S.IDLE, 4); break;
        case S.DETECT:
          it.look.copy(p.eye); it.lookW = 1;
          if (b.t > b.dur) {
            const ax = it.pos.x - p.pos.x, az = it.pos.z - p.pos.z, al = Math.hypot(ax, az) || 1;
            it.target.set(it.pos.x + ax / al * 40, 0, it.pos.z + az / al * 40);
            if (!this.canWalk(it.target.x, it.target.z)) this.pickTarget(it, 60);
            b.set(S.REACT, 9); ctx.observe?.('prowler', it);
          }
          break;
        case S.REACT: want = sp.trot; if (b.t > b.dur || pd > 45) b.set(S.IDLE, 4); break;
      }
      if (camD > 220) { this.hide(it, i); this._coarseMove(it, dt, want); continue; }
      this.locomote(it, i, dt, want, ctx);
    }
    this.flush();
  }
}
