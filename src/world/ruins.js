// Environmental storytelling: the Listening Ring, the Sunken Gate, the Orrery, the
// Signal Field pylons, the Leviathan remains, echo stones, and the Hollow (a cave
// bored into a hillside) where the Glowing Seed rests.
import * as THREE from 'three';
import { makeRng, hash01 } from '../core/rng.js';
import { createNoise3D } from '../core/noise.js';
import { GeoBuilder, curvePoints, col } from './geo.js';
import { makeBioMaterial } from './materials.js';
import { buildCrystalCluster } from './rocks.js';
import { buildMushroomCluster } from './plants.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const STONE = { a: col(0x56645e), b: col(0x3a4744), dark: col(0x252e2d), moss: col(0x24543f), moss2: col(0x31684c) };
const GLYPH = { cyan: col(0x7dffe6), amber: col(0xffbe6e), violet: col(0xb995ff) };
const BONE = { a: col(0xb8bfae), b: col(0x8f9a8c), dark: col(0x4f5a52) };
const METAL = { a: col(0x2f2a26), b: col(0x463b30), band: col(0x1a1816) };

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const h3 = (x, y, z, s) => hash01(Math.round(x * 997), Math.round(y * 991), Math.round(z * 983) + s);

/** Weathered, subdivided box with moss on upward faces. Matrix of builder positions it. */
function addBox(b, size, color, opts = {}) {
  const weather = opts.weather ?? 0.06, moss = opts.moss ?? 0.8, glow = opts.glow ?? 0, salt = opts.salt ?? 1;
  const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
  const faces = [
    { n: V(1, 0, 0), u: V(0, 0, -1), v: V(0, 1, 0), c: V(hx, 0, 0), su: size.z, sv: size.y },
    { n: V(-1, 0, 0), u: V(0, 0, 1), v: V(0, 1, 0), c: V(-hx, 0, 0), su: size.z, sv: size.y },
    { n: V(0, 1, 0), u: V(1, 0, 0), v: V(0, 0, -1), c: V(0, hy, 0), su: size.x, sv: size.z },
    { n: V(0, -1, 0), u: V(1, 0, 0), v: V(0, 0, 1), c: V(0, -hy, 0), su: size.x, sv: size.z },
    { n: V(0, 0, 1), u: V(1, 0, 0), v: V(0, 1, 0), c: V(0, 0, hz), su: size.x, sv: size.y },
    { n: V(0, 0, -1), u: V(-1, 0, 0), v: V(0, 1, 0), c: V(0, 0, -hz), su: size.x, sv: size.y },
  ];
  for (const f of faces) {
    const nu = Math.max(1, Math.round(f.su / 1.1)), nv = Math.max(1, Math.round(f.sv / 1.1));
    const start = b.count;
    const wn = f.n.clone().applyMatrix3(b.normalMatrix).normalize();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const p = f.c.clone().addScaledVector(f.u, (i / nu - 0.5) * f.su).addScaledVector(f.v, (j / nv - 0.5) * f.sv);
      const jx = (h3(p.x, p.y, p.z, salt) - 0.5) * weather, jy = (h3(p.x, p.y, p.z, salt + 7) - 0.5) * weather, jz = (h3(p.x, p.y, p.z, salt + 13) - 0.5) * weather;
      p.x += jx; p.y += jy; p.z += jz;
      _w.copy(p).applyMatrix4(b.matrix);
      let c = color.clone().multiplyScalar(0.82 + 0.3 * h3(p.x * 0.3, p.y * 0.3, p.z * 0.3, salt + 3));
      const mossAmt = Math.max(0, wn.y - 0.35) * 1.6 + (h3(p.x * 0.5, p.y * 0.5, p.z * 0.5, salt + 5) > 0.82 ? 0.5 : 0);
      if (moss > 0) c.lerp(STONE.moss.clone().lerp(STONE.moss2, h3(p.x, p.z, p.y, 9)), Math.min(1, mossAmt) * moss);
      if (opts.groundY !== undefined && _w.y < opts.groundY + 0.8) c.multiplyScalar(0.6 + 0.4 * Math.max(0, (_w.y - opts.groundY) / 0.8));
      b.vertex(p, f.n, c, glow);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = start + j * (nu + 1) + i, bb = a + 1, c = a + nu + 1, d = c + 1;
      b.quad(a, bb, d, c);
    }
  }
}

/** Column of glyphs (tiny glowing bars) on a face. Local frame: x right, y up, face toward +z. */
function addGlyphs(b, rng, count, cell, color, depth = 0.04) {
  const saved = b.matrix.clone();
  for (let g = 0; g < count; g++) {
    const gy = -g * cell * 1.25;
    const bars = rng.int(2, 4);
    for (let k = 0; k < bars; k++) {
      const horiz = rng.chance(0.55);
      const w = horiz ? cell * rng.float(0.5, 0.95) : cell * 0.12;
      const h = horiz ? cell * 0.12 : cell * rng.float(0.4, 0.9);
      const x = rng.float(-0.4, 0.4) * cell * (horiz ? 0.3 : 1), y = gy + rng.float(-0.35, 0.35) * cell;
      const m = saved.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, depth * 0.5));
      b.setMatrix(m);
      addBox(b, V(w, h, depth), color, { weather: 0, moss: 0, glow: 1.0 });
    }
    if (rng.chance(0.3)) {
      const m = saved.clone().multiply(new THREE.Matrix4().makeTranslation(rng.float(-0.3, 0.3) * cell, gy + cell * 0.3, depth * 0.5));
      b.setMatrix(m);
      addBox(b, V(cell * 0.14, cell * 0.14, depth), color, { weather: 0, moss: 0, glow: 1.0 });
    }
  }
  b.setMatrix(saved);
}

function addVine(b, rng, start, height, radius, turns) {
  const pts = [];
  const a0 = rng.angle();
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, a = a0 + t * Math.PI * 2 * turns;
    pts.push(V(start.x + Math.cos(a) * radius.x, start.y + t * height, start.z + Math.sin(a) * radius.z));
  }
  b.tube(pts, (t) => 0.07 * (1 - t * 0.6), 4, () => col(0x1a4a3c), (t) => (Math.sin(t * 40) > 0.85 ? 0.6 : 0));
}

const mat4 = (pos, quat, s = V(1, 1, 1)) => new THREE.Matrix4().compose(pos, quat, s);
const qYaw = (y) => new THREE.Quaternion().setFromAxisAngle(UP, y);
const qEuler = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));

export class Ruins {
  constructor(world) {
    this.world = world;
    this.hf = world.hf;
    this.group = new THREE.Group();
    this.group.name = 'ruins';
    this.animated = [];
    this.stoneMat = makeBioMaterial({ roughness: 0.9, glow: 1.1, wind: false, envMapIntensity: 0.3, triplanar: { scale: 0.45, strength: 0.85 } });
    this.ringGlyphMat = makeBioMaterial({ roughness: 0.6, glow: 0.35, wind: false });
    this.metalMat = makeBioMaterial({ roughness: 0.48, metalness: 0.55, glow: 1.6, wind: false, envMapIntensity: 0.8, triplanar: { scale: 0.9, strength: 0.35 } });
    this.boneMat = makeBioMaterial({ roughness: 0.75, glow: 1.2, wind: false, envMapIntensity: 0.4, triplanar: { scale: 0.7, strength: 0.4 } });
    this.caveMat = makeBioMaterial({ roughness: 0.95, glow: 1.0, wind: false, side: THREE.DoubleSide, envMapIntensity: 0.25, triplanar: { scale: 0.38, strength: 0.95 } });
    this.plantMat = makeBioMaterial({ roughness: 0.6, glow: 1.6, wind: true, push: true, translucent: true });
  }

  addMesh(geo, mat, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    this.group.add(m);
    return m;
  }

  build() {
    const s = this.world.sites;
    const rng = makeRng(this.world.seed, 'ruins');
    if (s.ring) this.buildRing(s.ring, rng.fork('ring'));
    if (s.gate) this.buildGate(s.gate, rng.fork('gate'));
    if (s.orrery) this.buildOrrery(s.orrery, rng.fork('orrery'));
    if (s.pylons) this.buildPylons(s.pylons, rng.fork('pylons'));
    if (s.leviathan) this.buildLeviathan(s.leviathan, rng.fork('lev'));
    if (s.cave) this.buildCave(s.cave, rng.fork('cave'));
    s.echoes.forEach((e, i) => this.buildEcho(e, i, rng.fork('echo' + i)));
    return this.group;
  }

  // ------------------------------------------------------------ Listening Ring
  buildRing(site, rng) {
    const hf = this.hf, W = this.world;
    const b = new GeoBuilder(), gb = new GeoBuilder();
    const n = 11, R = 13;
    const gy = site.y;
    const ringGlyphs = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + site.rot;
      const x = site.x + Math.cos(a) * R, z = site.z + Math.sin(a) * R;
      const fallen = i === 3 || i === 8;
      const broken = i === 6;
      const h = rng.float(7.5, 10) * (broken ? 0.45 : 1);
      const yaw = -a + Math.PI / 2; // inner face (+z local) toward centre
      const q = fallen ? qEuler(-Math.PI / 2 + 0.06, yaw + Math.PI, rng.float(-0.1, 0.1)) : qEuler(rng.float(-0.12, 0.08), yaw + Math.PI, rng.float(-0.1, 0.1));
      const groundY = hf.heightAt(x, z);
      if (fallen) {
        const out = V(Math.cos(a), 0, Math.sin(a));
        const cx = x + out.x * h * 0.45, cz = z + out.z * h * 0.45;
        const qq = new THREE.Quaternion().setFromAxisAngle(V(-out.z, 0, out.x), Math.PI / 2 - 0.05).multiply(qYaw(yaw + Math.PI));
        b.setMatrix(mat4(V(cx, hf.heightAt(cx, cz) + 0.35, cz), qq));
        addBox(b, V(2.4, h, 1.1), STONE.a.clone().lerp(STONE.b, rng.next()), { weather: 0.12, salt: i, moss: 1 });
        W.colliders.add(cx, cz, 1.6, 1.2); W.colliders.add(cx + out.x * h * 0.3, cz + out.z * h * 0.3, 1.6, 1.2); W.colliders.add(cx - out.x * h * 0.3, cz - out.z * h * 0.3, 1.6, 1.2);
        continue;
      }
      const pos = V(x, groundY + h / 2 - 1.4, z);
      const m = mat4(pos, q);
      b.setMatrix(m);
      addBox(b, V(2.4, h, 1.1), STONE.a.clone().lerp(STONE.b, rng.next()), { weather: broken ? 0.3 : 0.1, salt: i * 3, groundY });
      // glyphs on the inner face
      const gm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, h / 2 - 1.2, 0.55));
      gb.setMatrix(gm);
      addGlyphs(gb, rng, Math.floor(h / 1.2) - 1, 0.7, GLYPH.cyan);
      if (rng.chance(0.45)) addVine(b.setMatrix(new THREE.Matrix4()), rng, V(x, groundY - 0.3, z), h * rng.float(0.5, 0.9), V(1.5, 0, 0.9), rng.float(1.2, 2.2));
      W.colliders.add(x, z, 1.5, h);
      ringGlyphs.push({ x, z, y: groundY + h * 0.6 });
    }
    // altar
    b.setMatrix(mat4(V(site.x, gy - 0.1, site.z), qYaw(site.rot)));
    addBox(b, V(4.4, 0.9, 4.4), STONE.b, { weather: 0.05, salt: 91, moss: 0.4 });
    b.setMatrix(mat4(V(site.x, gy + 0.55, site.z), qYaw(site.rot + 0.785)));
    addBox(b, V(2.6, 0.4, 2.6), STONE.a, { weather: 0.04, salt: 93, moss: 0.2 });
    // spiral of glyph dots on the altar top
    gb.resetMatrix();
    for (let k = 0; k < 26; k++) {
      const t = k / 26, a = t * Math.PI * 5 + site.rot, rr = 0.2 + t * 1.0;
      gb.setMatrix(mat4(V(site.x + Math.cos(a) * rr, gy + 0.77, site.z + Math.sin(a) * rr), qEuler(-Math.PI / 2, a, 0)));
      addBox(gb, V(0.12, 0.12, 0.03), GLYPH.cyan, { weather: 0, moss: 0, glow: 1 });
    }
    this.addMesh(b.toGeometry(), this.stoneMat);
    const glyphMesh = this.addMesh(gb.toGeometry(), this.ringGlyphMat, false);
    // floating shard above the altar
    const sb = new GeoBuilder();
    sb.prism(V(0, -0.5, 0), UP, 1.0, 0.18, 6, GLYPH.cyan, 0.6, 1.0, { tip: 0.35 });
    sb.prism(V(0, -0.5, 0), V(0, -1, 0), 0.35, 0.18, 6, GLYPH.cyan, 0.6, 1.0, { tip: 0.3 });
    const shard = new THREE.Mesh(sb.toGeometry(), this.ringGlyphMat);
    shard.position.set(site.x, gy + 2.2, site.z);
    this.group.add(shard);
    W.colliders.add(site.x, site.z, 2.6, 1.2);
    this.ring = { site, glyphMesh, shard, active: 0, glyphs: ringGlyphs };
    this.animated.push((t, dt) => {
      shard.rotation.y += dt * (0.4 + this.ring.active * 3);
      shard.position.y = gy + 2.2 + Math.sin(t * 0.9) * 0.15 + this.ring.active * 0.6;
      this.ring.active = Math.max(0, this.ring.active - dt * 0.03);
      this.ringGlyphMat.userData.glow.value = 0.35 + this.ring.active * 3.2 + Math.sin(t * 0.5) * 0.08;
    });
    W.glowSpots.push({ x: site.x, y: gy + 2.2, z: site.z, color: 0x5fffe0, intensity: 9, range: 16, kind: 'ring', priority: 2 });
  }

  // --------------------------------------------------------------- Sunken Gate
  buildGate(site, rng) {
    const W = this.world, hf = this.hf;
    const b = new GeoBuilder(), gb = new GeoBuilder();
    const yaw = site.yaw;
    const tilt = qEuler(0.05, yaw, 0.17);
    const base = V(site.x, site.y - 3.2, site.z);
    const frame = mat4(base, tilt);
    const span = 9, H = 13;
    for (const sx of [-1, 1]) {
      b.setMatrix(frame.clone().multiply(mat4(V(sx * span / 2, H / 2, 0), new THREE.Quaternion())));
      addBox(b, V(2.4, H, 2.4), STONE.b.clone().lerp(STONE.a, 0.3), { weather: 0.14, salt: 40 + sx, groundY: site.y - 0.5 });
      const wp = V(sx * span / 2, 0, 0).applyQuaternion(tilt).add(base);
      W.colliders.add(wp.x, wp.z, 1.7, H);
    }
    b.setMatrix(frame.clone().multiply(mat4(V(0, H + 1.0, 0), new THREE.Quaternion())));
    addBox(b, V(span + 4, 2.2, 2.7), STONE.a, { weather: 0.12, salt: 47 });
    gb.setMatrix(frame.clone().multiply(mat4(V(span / 2 + 1.1, H + 1.0, 1.36), qEuler(0, 0, -Math.PI / 2))));
    addGlyphs(gb, rng, 9, 0.8, GLYPH.amber);
    addVine(b.setMatrix(new THREE.Matrix4()), rng, V(base.x, site.y - 0.5, base.z), 10, V(2, 0, 2), 1.5);
    this.addMesh(b.toGeometry(), this.stoneMat);
    this.addMesh(gb.toGeometry(), this.stoneMat, false);
    W.glowSpots.push({ x: site.x, y: site.y + 9, z: site.z, color: 0xffb060, intensity: 6, range: 14, kind: 'gate' });
  }

  // ------------------------------------------------------------------ Orrery
  buildOrrery(site, rng) {
    const W = this.world;
    const b = new GeoBuilder();
    b.setMatrix(mat4(V(site.x, site.y - 0.3, site.z), qYaw(rng.angle())));
    addBox(b, V(3.2, 0.8, 3.2), STONE.b, { salt: 61 });
    b.setMatrix(mat4(V(site.x, site.y + 0.6, site.z), qYaw(0.4)));
    addBox(b, V(1.6, 1.4, 1.6), STONE.a, { salt: 62, moss: 0.3 });
    b.setMatrix(mat4(V(site.x, site.y + 1.4, site.z), qYaw(1.2)));
    addBox(b, V(1.1, 0.35, 1.1), STONE.dark, { salt: 63, moss: 0 });
    this.addMesh(b.toGeometry(), this.stoneMat);
    const centre = V(site.x, site.y + 3.6, site.z);
    const pivot = new THREE.Group(); pivot.position.copy(centre); this.group.add(pivot);
    const core = new THREE.Mesh(new GeoBuilder().ellipsoid(V(0, 0, 0), V(0.45, 0.45, 0.45), 16, 12, GLYPH.amber, 1.0).toGeometry(), this.metalMat);
    pivot.add(core);
    const rings = [];
    [1.5, 2.15, 2.85].forEach((r, i) => {
      const rb = new GeoBuilder();
      rb.addGeometry(new THREE.TorusGeometry(r, 0.06 + i * 0.015, 8, 96), METAL.b, 0);
      const nodes = i === 0 ? 11 : 5 + i * 2;
      for (let k = 0; k < nodes; k++) {
        const a = (k / nodes) * Math.PI * 2;
        rb.ellipsoid(V(Math.cos(a) * r, Math.sin(a) * r, 0), V(0.11, 0.11, 0.11), 8, 6, i === 0 ? GLYPH.cyan : GLYPH.amber, 1.0);
      }
      const ring = new THREE.Mesh(rb.toGeometry(), this.metalMat);
      ring.castShadow = true;
      ring.userData.axis = V(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)).normalize();
      ring.userData.speed = rng.float(0.15, 0.35) * (i % 2 ? -1 : 1);
      ring.rotation.set(rng.angle(), rng.angle(), 0);
      pivot.add(ring); rings.push(ring);
    });
    // beam of light, shown when aligned
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x9ffff0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.1, 140, 16, 1, true), beamMat);
    beam.position.set(centre.x, centre.y + 70, centre.z);
    beam.visible = false;
    this.group.add(beam);
    const alignQ = new THREE.Quaternion();
    this.orrery = { site, centre, rings, core, beam, align: 0 };
    this.animated.push((t, dt) => {
      const o = this.orrery;
      o.align = Math.max(0, o.align - dt * 0.035);
      const a = Math.min(1, o.align * 1.5);
      for (const ring of rings) {
        if (a < 0.98) ring.rotateOnAxis(ring.userData.axis, ring.userData.speed * dt * (1 - a));
        ring.quaternion.slerp(alignQ.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), a * dt * 2);
      }
      core.scale.setScalar(1 + Math.sin(t * 2.2) * 0.06 + a * 0.5);
      beam.visible = a > 0.02;
      beamMat.opacity = a * 0.22 * (0.85 + 0.15 * Math.sin(t * 7));
    });
    W.colliders.add(site.x, site.z, 2.1, 3);
    W.glowSpots.push({ x: centre.x, y: centre.y, z: centre.z, color: 0xffc070, intensity: 10, range: 16, kind: 'orrery', priority: 2 });
  }

  // ------------------------------------------------------------- Signal Field
  buildPylons(site, rng) {
    const W = this.world, hf = this.hf;
    const b = new GeoBuilder();
    const tops = [];
    let main = null;
    for (let i = 0; i < 7; i++) {
      const a = rng.angle(), d = i === 0 ? 0 : rng.float(8, 22);
      const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
      if (tops.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) continue;
      const gy = hf.heightAt(x, z);
      const H = i === 0 ? 17 : rng.float(8, 15);
      const broken = i > 0 && rng.chance(0.35);
      const fallen = i > 2 && rng.chance(0.25);
      const lean = fallen ? V(Math.cos(a), 0.12, Math.sin(a)).normalize() : V(rng.float(-0.08, 0.08), 1, rng.float(-0.08, 0.08)).normalize();
      const len = broken ? H * 0.5 : H;
      const base = V(x, gy - 1.2 + (fallen ? 1.4 : 0), z);
      b.prism(base, lean, len, 0.75, 4, METAL.a.clone().lerp(METAL.b, rng.next()), 0, 0, { taper: 0.4, twist: Math.PI / 4 });
      for (let k = 1; k < 4; k++) {
        const p = base.clone().addScaledVector(lean, len * k * 0.22);
        if (k * 0.22 > 0.95) break;
        b.prism(p, lean, 0.25, 0.75 * (1 - k * 0.22 * 0.6) + 0.12, 4, METAL.band, k === 2 && !fallen ? 0.6 : 0, k === 2 && !fallen ? 0.6 : 0, { twist: Math.PI / 4 });
      }
      const top = base.clone().addScaledVector(lean, len);
      if (!fallen) tops.push({ x, z, top, gy });
      if (i === 0) main = { x, z, top, gy };
      W.colliders.add(x, z, 1.0, fallen ? 1.5 : H);
      if (fallen) { const p2 = base.clone().addScaledVector(lean, len * 0.6); W.colliders.add(p2.x, p2.z, 0.9, 1.5); }
    }
    // sagging cables between standing pylons
    for (let i = 0; i + 1 < tops.length; i++) {
      const A = tops[i].top, B = tops[i + 1].top;
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const p = A.clone().lerp(B, t);
        p.y -= Math.sin(Math.PI * t) * (A.distanceTo(B) * 0.45);
        p.y = Math.max(p.y, hf.heightAt(p.x, p.z) + 0.06);
        pts.push(p);
      }
      b.tube(pts, () => 0.06, 5, () => METAL.band, () => 0);
    }
    // console at the main pylon
    if (main) {
      const cq = qEuler(-0.5, rng.angle(), 0);
      b.setMatrix(mat4(V(main.x + 1.8, main.gy + 0.6, main.z), cq));
      addBox(b, V(1.4, 1.0, 0.7), METAL.a, { weather: 0.02, moss: 0.2 });
      b.setMatrix(mat4(V(main.x + 1.8, main.gy + 0.6, main.z), cq).multiply(mat4(V(0, 0.1, 0.36), new THREE.Quaternion())));
      addBox(b, V(1.0, 0.55, 0.02), GLYPH.amber, { weather: 0, moss: 0, glow: 0.7 });
      b.resetMatrix();
      W.colliders.add(main.x + 1.8, main.z, 0.8, 1);
    }
    this.addMesh(b.toGeometry(), this.metalMat);
    // blinking warning light on the main pylon
    const lightGeo = new GeoBuilder().ellipsoid(V(0, 0, 0), V(0.32, 0.32, 0.32), 12, 8, GLYPH.amber, 1.0).toGeometry();
    const lightMat = makeBioMaterial({ roughness: 0.3, glow: 3.0, wind: false });
    const lamp = new THREE.Mesh(lightGeo, lightMat);
    lamp.position.copy(main.top).add(V(0, 0.4, 0));
    this.group.add(lamp);
    const spot = { x: lamp.position.x, y: lamp.position.y, z: lamp.position.z, color: 0xffa040, intensity: 0, range: 22, kind: 'pylon', priority: 3 };
    W.glowSpots.push(spot);
    this.pylons = { site, main, lamp, signal: 0, console: main ? V(main.x + 1.8, main.gy + 1.0, main.z) : null };
    this.animated.push((t, dt) => {
      const blink = ((t % 2.6) < 0.18 || (this.pylons.signal > 0 && Math.sin(t * 18) > 0)) ? 1 : 0.06;
      lightMat.userData.glow.value = 0.2 + blink * 4.5;
      spot.intensity = blink * 12;
      this.pylons.signal = Math.max(0, this.pylons.signal - dt);
    });
  }

  // ----------------------------------------------------------- Leviathan bones
  buildLeviathan(site, rng) {
    const W = this.world, hf = this.hf;
    const b = new GeoBuilder();
    const noise3 = createNoise3D(rng.fork('n3'));
    const dir = V(Math.cos(site.yaw), 0, Math.sin(site.yaw));
    const side = V(-dir.z, 0, dir.x);
    const L = 42;
    const spine = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const bend = Math.sin(t * Math.PI * 1.2) * 3.5;
      const x = site.x + dir.x * (t - 0.5) * L + side.x * bend, z = site.z + dir.z * (t - 0.5) * L + side.z * bend;
      spine.push({ p: V(x, hf.heightAt(x, z), z), t });
    }
    const boneC = (k) => BONE.a.clone().lerp(BONE.b, 0.3 + 0.4 * Math.sin(k * 7.1)).multiplyScalar(0.9);
    spine.forEach((s, i) => {
      const r = 0.95 * (1 - s.t * 0.65) + 0.25;
      const c = s.p.clone(); c.y += r * 0.15 - 0.3;
      b.ellipsoid(c, V(r * 0.8, r * 0.9, r * 0.6), 10, 7, boneC(i), 0, { displace: (nx, ny, nz) => noise3(nx * 3 + i, ny * 3, nz * 3) * 0.12, rotation: qYaw(-site.yaw) });
      // dorsal process
      b.prism(c.clone().add(V(0, r * 0.5, 0)), V(dir.x * -0.3, 1, dir.z * -0.3), r * 1.4, r * 0.18, 5, boneC(i + 3), 0, 0, { taper: 0.3 });
      if (i % 3 === 0) W.colliders.add(c.x, c.z, r * 0.9, r);
    });
    // ribs
    for (let i = 3; i < 21; i += 1) {
      const s = spine[i];
      const k = Math.sin(((i - 3) / 18) * Math.PI);
      const ribH = 3.5 + k * 6.2;
      for (const sd of [-1, 1]) {
        if (hash01(i, sd + 5, 31) < 0.12) continue; // missing ribs
        const broken = hash01(i, sd, 17) < 0.25 ? hash01(i, sd, 19) * 0.5 + 0.35 : 1;
        const o = side.clone().multiplyScalar(sd);
        const base = s.p.clone().add(V(0, 0.3, 0));
        const ctrl = [base.clone().addScaledVector(o, 0.6), base.clone().addScaledVector(o, 2.8 + k * 1.2).add(V(0, ribH * 0.32, 0)), base.clone().addScaledVector(o, 3.0 + k * 1.6).add(V(0, ribH * 0.72, 0)), base.clone().addScaledVector(o, 1.4 + k * 0.6).add(V(0, ribH, 0))];
        const pts = curvePoints(ctrl, 14);
        const cut = Math.max(3, Math.floor(pts.length * broken));
        b.tube(pts.slice(0, cut), (t) => 0.32 * (1 - t * 0.55) * (0.7 + k * 0.3), 6, () => boneC(i + sd), () => 0);
        W.colliders.add(pts[1].x, pts[1].z, 0.6, 2);
        if (hash01(i, sd, 23) < 0.18) {
          const cp = pts[Math.min(cut - 1, 6)];
          const cg = buildCrystalCluster(rng.fork('cr' + i + sd), GLYPH.cyan);
          const cm = new THREE.Matrix4().compose(cp, qEuler(rng.float(-0.6, 0.6), rng.angle(), rng.float(-0.6, 0.6)), V(0.35, 0.35, 0.35));
          b.setMatrix(cm); b.addGeometry(cg, (ii) => new THREE.Color().fromBufferAttribute(cg.attributes.color, ii), 0.9); b.resetMatrix();
          W.glowSpots.push({ x: cp.x, y: cp.y, z: cp.z, color: 0x50ffe0, intensity: 4, range: 8, kind: 'bone' });
        }
      }
    }
    // skull at the head end, half buried
    const head = spine[0].p.clone().addScaledVector(dir, -3.2);
    head.y = hf.heightAt(head.x, head.z) + 0.6;
    const sq = qEuler(0.25, -site.yaw + Math.PI / 2, 0.3);
    b.ellipsoid(head, V(1.9, 1.5, 3.6), 18, 12, (nx, ny) => (ny < -0.3 ? BONE.dark : BONE.a.clone().multiplyScalar(0.85 + 0.15 * ny)), 0,
      { rotation: sq, displace: (nx, ny, nz) => noise3(nx * 2.5, ny * 2.5, nz * 2.5) * 0.18 - (nz > 0.6 ? 0.25 * (nz - 0.6) : 0) });
    for (const sd of [-1, 1]) {
      const eye = V(sd * 1.15, 0.45, 1.3).applyQuaternion(sq).add(head);
      b.ellipsoid(eye, V(0.5, 0.45, 0.5), 10, 6, col(0x050808), 0);
    }
    const jaw = V(0, -1.1, 0.8).applyQuaternion(sq).add(head);
    b.ellipsoid(jaw, V(1.5, 0.45, 3.0), 12, 6, BONE.b, 0, { rotation: sq });
    W.colliders.add(head.x, head.z, 2.6, 2.5);
    this.addMesh(b.toGeometry(), this.boneMat);
    this.leviathan = { site, skull: head };
  }

  // ----------------------------------------------------------------- The Hollow
  buildCave(cave, rng) {
    const W = this.world;
    const noise3 = createNoise3D(rng.fork('cave3'));
    const f = V(cave.dirX, 0, cave.dirZ), sd = V(-cave.dirZ, 0, cave.dirX);
    const mouth = V(cave.x, cave.floorY, cave.z);
    const segA = 22, segS = 34;
    const s0 = -1.4, s1 = cave.length;
    const pos = [], colA = [], glw = [], sw = [];
    const rockC = col(0x3e4c48), rockD = col(0x1c2524), veinC = col(0x6fffe0), mossC = col(0x2a5a45);
    for (let j = 0; j <= segS; j++) {
      const s = s0 + (s1 - s0) * (j / segS);
      const taper = s > s1 - 4.5 ? Math.sqrt(Math.max(0.02, (s1 - s) / 4.5)) : 1;
      const flare = s < 1 ? 1 + (1 - s) * 0.04 : 1;
      const floor = cave.floorY + Math.max(0, s) * cave.slope;
      for (let i = 0; i <= segA; i++) {
        const th = (i / segA) * Math.PI * 2;
        const st = Math.sin(th), ct = Math.cos(th);
        const wx = mouth.x + f.x * s, wz = mouth.z + f.z * s;
        const jit = st > 0.05 ? noise3(wx * 0.35 + ct * 2, floor * 0.3 + st * 2, wz * 0.35) * 0.55 + noise3(wx * 1.2, st * 4, wz * 1.2) * 0.18 : 0;
        const xr = ct * (cave.width / 2) * taper * flare * (1 + jit * 0.5);
        const yr = st > 0 ? st * cave.height * taper * flare * (1 + jit * 0.4) : 0;
        const p = V(wx, floor + yr, wz).addScaledVector(sd, xr);
        pos.push(p.x, p.y, p.z);
        const depthF = Math.min(1, Math.max(0, s / cave.length));
        const c = rockC.clone().lerp(rockD, depthF * 0.7).multiplyScalar(0.8 + 0.4 * (noise3(p.x * 0.8, p.y * 0.8, p.z * 0.8) * 0.5 + 0.5));
        if (s < 2.5 && st > 0.55) c.lerp(mossC, 0.6 * (1 - Math.max(0, s) / 2.5)); // moss on the overhang
        if (st <= 0.05) c.multiplyScalar(0.75); // floor
        const vein = st > 0.1 && noise3(p.x * 0.6 + 9, p.y * 0.9, p.z * 0.6) > 0.55 && s > 2 ? 1 : 0;
        if (vein) c.copy(veinC);
        colA.push(c.r, c.g, c.b); glw.push(vein ? 0.55 : 0); sw.push(0);
      }
    }
    const idx = [];
    for (let j = 0; j < segS; j++) for (let i = 0; i < segA; i++) {
      const a = j * (segA + 1) + i, b2 = a + segA + 1;
      idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glw, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sw, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.addMesh(g, this.caveMat, true);

    // the Seed: a cradle of roots at the far end
    const endS = cave.length - 5.2;
    const seedFloor = cave.floorY + endS * cave.slope;
    const seedPos = mouth.clone().addScaledVector(f, endS); seedPos.y = seedFloor;
    const rb = new GeoBuilder();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rng.float(-0.2, 0.2);
      const o = V(Math.cos(a), 0, Math.sin(a));
      const ctrl = [seedPos.clone().addScaledVector(o, 1.6).add(V(0, -0.2, 0)), seedPos.clone().addScaledVector(o, 1.1).add(V(0, 0.5, 0)), seedPos.clone().addScaledVector(o, 0.55).add(V(0, 1.1, 0)), seedPos.clone().addScaledVector(o, 0.25).add(V(0, 1.6 + rng.float(0, 0.4), 0))];
      rb.tube(curvePoints(ctrl, 10), (t) => 0.13 * (1 - t * 0.7), 6, (t) => col(0x2a2620).lerp(col(0x6b5a3a), t), (t) => t * 0.25);
    }
    this.addMesh(rb.toGeometry(), this.boneMat);
    const seedGeo = new GeoBuilder().ellipsoid(V(0, 0, 0), V(0.32, 0.46, 0.32), 20, 14, (nx, ny) => GLYPH.amber.clone().lerp(GLYPH.cyan, Math.max(0, ny) * 0.8), 1.0).toGeometry();
    const seedMat = makeBioMaterial({ roughness: 0.25, glow: 2.4, wind: false });
    const seed = new THREE.Mesh(seedGeo, seedMat);
    seed.position.copy(seedPos).add(V(0, 1.35, 0));
    this.group.add(seed);
    this.seed = { mesh: seed, mat: seedMat, pos: seed.position.clone(), awakened: false };
    this.animated.push((t) => {
      seed.position.y = this.seed.pos.y + Math.sin(t * 1.1) * 0.06;
      seed.rotation.y = t * 0.3;
      seedMat.userData.glow.value = (this.seed.awakened ? 3.2 : 2.0) + Math.sin(t * 2.0) * 0.6;
    });
    W.glowSpots.push({ x: seed.position.x, y: seed.position.y, z: seed.position.z, color: 0xffd28a, intensity: 10, range: 14, kind: 'seed', priority: 3 });
    // mushrooms lining the tunnel
    const shroom = buildMushroomCluster(rng.fork('cs'), 'lantern');
    const count = 12;
    const im = new THREE.InstancedMesh(shroom, this.plantMat, count);
    const m = new THREE.Matrix4();
    for (let k = 0; k < count; k++) {
      const s = rng.float(3, cave.length - 6);
      const side = (k % 2 ? 1 : -1) * (cave.width / 2 - 0.6);
      const p = mouth.clone().addScaledVector(f, s).addScaledVector(sd, side); p.y = cave.floorY + s * cave.slope;
      m.compose(p, qYaw(rng.angle()), V(1, 1, 1).multiplyScalar(rng.float(0.6, 1.2)));
      im.setMatrixAt(k, m);
      if (k % 4 === 0) W.glowSpots.push({ x: p.x, y: p.y + 0.8, z: p.z, color: 0x4fffd6, intensity: 4, range: 8, kind: 'cave' });
    }
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    this.group.add(im);
    // a faint glow spilling from the mouth makes the entrance readable from a distance
    W.glowSpots.push({ x: mouth.x + f.x * 3, y: cave.floorY + 2.2, z: mouth.z + f.z * 3, color: 0x3fe0c0, intensity: 9, range: 15, kind: 'caveMouth', priority: 2 });
    this.cave = cave;
  }

  // -------------------------------------------------------------- echo stones
  buildEcho(e, i, rng) {
    const b = new GeoBuilder();
    const q = qEuler(rng.float(-0.08, 0.08), rng.angle(), rng.float(-0.08, 0.08));
    const m = mat4(V(e.x, e.y + 0.55, e.z), q);
    b.setMatrix(m);
    addBox(b, V(0.8, 1.9, 0.55), STONE.b.clone().lerp(STONE.a, 0.4), { weather: 0.1, salt: 200 + i, groundY: e.y });
    b.setMatrix(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.65, 0.28)));
    addGlyphs(b, rng, 3, 0.36, GLYPH.amber, 0.03);
    const mesh = this.addMesh(b.toGeometry(), this.stoneMat);
    this.world.colliders.add(e.x, e.z, 0.6, 1.5);
    this.world.glowSpots.push({ x: e.x, y: e.y + 1.4, z: e.z, color: 0xffb060, intensity: 3.5, range: 7, kind: 'echo' });
    e.mesh = mesh;
  }

  update(t, dt) { for (const f of this.animated) f(t, dt); }
}
