// World orchestration: deterministic site selection for landmarks, terrain stamps,
// collision, exclusion zones, named regions, and the staged generation pipeline.
import * as THREE from 'three';
import { makeRng, hash01 } from '../core/rng.js';

const hash01x = (x, z) => hash01(Math.round(x * 10), Math.round(z * 10), 911);
import { WORLD } from '../config.js';
import { U } from '../core/uniforms.js';
import { Heightfield } from './heightfield.js';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { Vegetation } from './vegetation.js';
import { Grass } from './grass.js';
import { Geology } from './rocks.js';
import { Ruins } from './ruins.js';

import { yieldUI as nextFrame } from '../core/yield.js';

/** Circle colliders in a spatial hash; the player and creatures are pushed out of them. */
export class Colliders {
  constructor(cell = 8) { this.cell = cell; this.map = new Map(); this.count = 0; }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(x, z, r, h = 3) {
    const c = { x, z, r, h };
    const i0 = Math.floor((x - r) / this.cell), i1 = Math.floor((x + r) / this.cell);
    const j0 = Math.floor((z - r) / this.cell), j1 = Math.floor((z + r) / this.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = this.key(i, j);
      let a = this.map.get(k); if (!a) { a = []; this.map.set(k, a); }
      a.push(c);
    }
    this.count++;
  }
  /** Push a point out of every overlapping circle. Returns true if moved. */
  resolve(pos, radius, feetY = -Infinity) {
    const a = this.map.get(this.key(Math.floor(pos.x / this.cell), Math.floor(pos.z / this.cell)));
    if (!a) return false;
    let moved = false;
    for (const c of a) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = c.x + (dx / d) * rr; pos.z = c.z + (dz / d) * rr;
        moved = true;
      }
    }
    return moved;
  }
  nearest(x, z, maxD) {
    const a = this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    let best = null, bd = maxD;
    if (a) for (const c of a) { const d = Math.hypot(x - c.x, z - c.z) - c.r; if (d < bd) { bd = d; best = c; } }
    return best;
  }
}

export class World {
  constructor(seed, seedName, quality, scene) {
    this.seed = seed;
    this.seedName = seedName;
    this.quality = quality;
    this.scene = scene;
    this.playRadius = WORLD.playRadius;
    this.colliders = new Colliders(8);
    this.exclusions = [];
    this.exGrid = new Map();
    this.glowSpots = [];
    this.pois = [];
    this.extraCrystals = [];
    this.sites = { echoes: [] };
  }

  // -------------------------------------------------------------- exclusion
  addExclusion(x, z, r) {
    const e = { x, z, r };
    this.exclusions.push(e);
    const c = 16;
    for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      const k = i + ',' + j; if (!this.exGrid.has(k)) this.exGrid.set(k, []); this.exGrid.get(k).push(e);
    }
  }
  isExcluded(x, z, scale = 1) {
    const a = this.exGrid.get(Math.floor(x / 16) + ',' + Math.floor(z / 16));
    if (!a) return false;
    for (const e of a) if ((x - e.x) ** 2 + (z - e.z) ** 2 < (e.r * scale) ** 2) return true;
    return false;
  }
  registerPOI(p) { this.pois.push(p); }

  // ---------------------------------------------------------- site selection
  chooseSites() {
    const hf = this.hf, W = hf.water, R = this.playRadius;
    const rng = makeRng(this.seed, 'sites');
    const S = this.sites;
    const L = hf.lake;
    const far = (x, z, list, d) => list.every((p) => !p || Math.hypot(p.x - x, p.z - z) > d);
    const flatness = (x, z, r) => {
      let mn = 1e9, mx = -1e9;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const h = hf.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r); mn = Math.min(mn, h); mx = Math.max(mx, h); }
      const h0 = hf.heightAt(x, z); mn = Math.min(mn, h0); mx = Math.max(mx, h0);
      return mx - mn;
    };

    // Landing site: a gentle lake shore facing the water
    let best = null;
    const a0 = rng.angle();
    for (let k = 0; k < 96; k++) {
      const a = a0 + (k / 96) * Math.PI * 2;
      for (let d = 30; d < 160; d += 2) {
        const x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d;
        const h = hf.heightAt(x, z);
        if (h < W + 1.2) continue;
        if (h > W + 5 || Math.hypot(x, z) > R - 40) break;
        const fl = flatness(x, z, 4);
        const rav = hf.distToRavine(x, z).d;
        const score = -fl * 2 - Math.abs(h - 2.2) * 0.4 + Math.min(rav, 60) * 0.03 + rng.next() * 0.2;
        if (fl < 1.4 && rav > 22 && (!best || score > best.score)) best = { x, z, h, score };
        break;
      }
    }
    if (!best) best = { x: L.x + L.rx + 14, z: L.z, h: hf.heightAt(L.x + L.rx + 14, L.z) };
    const toLake = new THREE.Vector2(L.x - best.x, L.z - best.z).normalize();
    S.spawn = { x: best.x, z: best.z, yaw: Math.atan2(-toLake.x, -toLake.y) };
    this.addExclusion(best.x, best.z, 3.5);

    // Lantern Grove across the lake from the landing site (the opening vista)
    let gx = L.x + toLake.x * (L.rx + 48), gz = L.z + toLake.y * (L.rx + 48);
    for (let tries = 0; tries < 30 && hf.heightAt(gx, gz) < W + 2; tries++) { gx += toLake.x * 6; gz += toLake.y * 6; }
    this.groveCenter = { x: gx, z: gz };

    const grid = (step, fn) => { const out = []; for (let z = -R + 20; z < R - 20; z += step) for (let x = -R + 20; x < R - 20; x += step) { const px = x + rng.float(-step / 3, step / 3), pz = z + rng.float(-step / 3, step / 3); if (px * px + pz * pz > (R - 25) ** 2) continue; const s = fn(px, pz); if (s !== null) out.push({ x: px, z: pz, s }); } out.sort((a, b) => b.s - a.s); return out[0] || null; };

    // The Listening Ring: broad, high, flat ground
    S.ring = grid(11, (x, z) => {
      const h = hf.heightAt(x, z);
      if (h < 7 || h > 48 || hf.lakeDist(x, z) < 1.5 || hf.distToRavine(x, z).d < 36) return null;
      if (!far(x, z, [S.spawn, this.groveCenter], 85)) return null;
      const fl = flatness(x, z, 16);
      if (fl > 6) return null;
      return -fl + h * 0.06 + rng.next() * 0.5;
    });
    // The Orrery: a summit with a view
    S.orrery = grid(9, (x, z) => {
      const h = hf.heightAt(x, z);
      if (h < 14 || h > 75 || Math.hypot(x, z) > R - 45) return null;
      if (!far(x, z, [S.spawn, S.ring], 75)) return null;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (hf.heightAt(x + Math.cos(a) * 18, z + Math.sin(a) * 18) > h - 1) return null; }
      return h * 0.1 - flatness(x, z, 4) + rng.next();
    });
    // Signal Field: flat lowland
    S.pylons = grid(12, (x, z) => {
      const h = hf.heightAt(x, z);
      if (h < W + 2 || h > 20 || hf.lakeDist(x, z) < 1.35 || hf.distToRavine(x, z).d < 30) return null;
      if (!far(x, z, [S.spawn, S.ring, S.orrery, this.groveCenter], 70)) return null;
      const fl = flatness(x, z, 20); if (fl > 5) return null;
      return -fl + rng.next();
    });
    // Leviathan: a long flat stretch
    S.leviathan = grid(12, (x, z) => {
      const h = hf.heightAt(x, z);
      if (h < W + 1.5 || h > 16 || hf.lakeDist(x, z) < 1.3 || hf.distToRavine(x, z).d < 30) return null;
      if (!far(x, z, [S.spawn, S.ring, S.orrery, S.pylons], 65)) return null;
      const fl = flatness(x, z, 22); if (fl > 5) return null;
      return -fl + rng.next();
    });
    if (S.leviathan) {
      // orient along the contour (least slope direction)
      let by = 0, bv = 1e9;
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI; const dh = Math.abs(hf.heightAt(S.leviathan.x + Math.cos(a) * 20, S.leviathan.z + Math.sin(a) * 20) - hf.heightAt(S.leviathan.x - Math.cos(a) * 20, S.leviathan.z - Math.sin(a) * 20)); if (dh < bv) { bv = dh; by = a; } }
      S.leviathan.yaw = by;
    }
    // Sunken Gate: half drowned at the lake edge, away from the landing site
    let gate = null;
    for (let k = 0; k < 120; k++) {
      const a = rng.angle();
      for (let d = 20; d < 140; d += 1.5) {
        const x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d;
        const h = hf.heightAt(x, z);
        if (h < W - 1.2) continue;
        if (h <= W + 0.4 && hf.slopeAt(x, z) < 0.35 && far(x, z, [S.spawn], 45) && far(x, z, [S.leviathan, S.pylons], 30) && hf.distToRavine(x, z).d > 25) gate = { x, z };
        break;
      }
      if (gate) break;
    }
    if (gate) { gate.y = W; gate.yaw = Math.atan2(L.x - gate.x, L.z - gate.z); S.gate = gate; }

    // The Hollow: a cave bored into a steep hillside
    // Deterministic grid search, scored by how much rock covers the tunnel.
    S.cave = null;
    const caveLen = 19, caveW = 5.6, caveH = 4.4;
    let bestCave = null;
    const n = new THREE.Vector3();
    const coverOf = (x, z, dx, dz, floorY) => {
      let cover = 1e9;
      for (let t = 4; t <= caveLen; t += 2.5) {
        const sx = x + dx * t, sz = z + dz * t;
        const roof = floorY + t * 0.03 + caveH;
        cover = Math.min(cover, hf.heightAt(sx, sz) - roof - 1.0, hf.heightAt(sx + dz * 2.6, sz - dx * 2.6) - roof, hf.heightAt(sx - dz * 2.6, sz + dx * 2.6) - roof);
        if (cover < 0.4) break;
      }
      return cover;
    };
    // 1) preferred: the foot of a mesa cliff, tunnelling toward the plateau's heart
    for (const m of hf.mesas) {
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        const dx = -Math.cos(a), dz = -Math.sin(a);
        for (let rr = m.r * 0.85; rr < m.r * 1.5; rr += 0.75) {
          const x = m.x + Math.cos(a) * rr, z = m.z + Math.sin(a) * rr;
          if (hf.slopeAt(x, z) > 0.42) continue;
          if (hf.slopeAt(x + dx * 2, z + dz * 2) < 0.35) break; // no cliff behind this point
          const h = hf.heightAt(x, z);
          if (h < W + 1.5 || x * x + z * z > (R - 30) ** 2 || !far(x, z, [S.spawn, S.ring, S.orrery, S.pylons, S.leviathan, S.gate], 40)) break;
          const floorY = h - 0.3;
          const hf6 = hf.heightAt(x - dx * 6, z - dz * 6);
          if (hf6 > floorY + 1.0 || hf6 < floorY - 2.0) break;
          const cover = coverOf(x, z, dx, dz, floorY);
          if (cover >= 0.4) { const score = 10 + Math.min(cover, 8) + hash01x(x, z); if (!bestCave || score > bestCave.score) bestCave = { score, x, z, dirX: dx, dirZ: dz, floorY }; }
          break;
        }
      }
    }
    // 2) fallback: any steep hillside with a level approach
    if (!bestCave) for (let z = -R + 40; z < R - 40; z += 3) for (let x = -R + 40; x < R - 40; x += 3) {
      if (x * x + z * z > (R - 40) ** 2) continue;
      const h = hf.heightAt(x, z);
      if (h < W + 1.5 || h > 45) continue;
      const s = hf.slopeAt(x, z);
      if (s < 0.3 || s > 0.97) continue;
      if (!far(x, z, [S.spawn, S.ring, S.orrery, S.pylons, S.leviathan, S.gate], 45)) continue;
      hf.normalAt(x, z, n);
      const gl = Math.hypot(n.x, n.z); if (gl < 1e-3) continue;
      const dx = -n.x / gl, dz = -n.z / gl; // into the hill (uphill)
      const floorY = h - 0.6;
      // open, roughly level approach in front of the mouth
      const hf6 = hf.heightAt(x - dx * 6, z - dz * 6);
      if (hf6 > floorY + 1.0 || hf6 < floorY - 2.0) continue;
      const cover = coverOf(x, z, dx, dz, floorY);
      if (cover < 0.4) continue;
      const score = Math.min(cover, 8) + hash01x(x, z) * 0.5;
      if (!bestCave || score > bestCave.score) bestCave = { score, x, z, dirX: dx, dirZ: dz, floorY };
    }
    if (bestCave) S.cave = { x: bestCave.x, z: bestCave.z, dirX: bestCave.dirX, dirZ: bestCave.dirZ, length: caveLen, width: caveW, height: caveH, floorY: bestCave.floorY, slope: 0.03, notch: 3.5 };

    // Shard Ridge: high, broken ground for crystal deposits
    S.ridge = grid(14, (x, z) => {
      const h = hf.heightAt(x, z);
      if (h < 24 || h > 80) return null;
      const s = hf.slopeAt(x, z); if (s < 0.12 || s > 0.55) return null;
      if (!far(x, z, [S.spawn, S.ring, S.orrery, S.pylons, S.leviathan, S.cave], 55)) return null;
      return h * 0.05 + rng.next();
    });
    this.shardRidge = S.ridge;
  }

  applyStamps() {
    const hf = this.hf, S = this.sites;
    const median = (x, z, r) => { const a = []; for (let k = 0; k < 12; k++) { const t = (k / 12) * Math.PI * 2; a.push(hf.heightAt(x + Math.cos(t) * r, z + Math.sin(t) * r)); } a.push(hf.heightAt(x, z)); a.sort((p, q) => p - q); return a[6]; };
    if (S.ring) { S.ring.y = median(S.ring.x, S.ring.z, 12); S.ring.rot = makeRng(this.seed, 'ringrot').angle(); hf.flattenPad(S.ring.x, S.ring.z, 17, S.ring.y, 12); this.addExclusion(S.ring.x, S.ring.z, 19); }
    if (S.orrery) { S.orrery.y = median(S.orrery.x, S.orrery.z, 3); hf.flattenPad(S.orrery.x, S.orrery.z, 4.5, S.orrery.y, 5); this.addExclusion(S.orrery.x, S.orrery.z, 6); }
    if (S.pylons) { const y = median(S.pylons.x, S.pylons.z, 14); hf.flattenPad(S.pylons.x, S.pylons.z, 18, y, 14); S.pylons.y = y; this.addExclusion(S.pylons.x, S.pylons.z, 25); }
    if (S.leviathan) {
      const lv = S.leviathan; const dx = Math.cos(lv.yaw), dz = Math.sin(lv.yaw);
      for (let t = -26; t <= 26; t += 6) this.addExclusion(lv.x + dx * t, lv.z + dz * t, 9);
    }
    if (S.gate) this.addExclusion(S.gate.x, S.gate.z, 10);
    if (S.cave) {
      hf.carveCave(S.cave);
      const c = S.cave;
      for (let t = -6; t <= 4; t += 2.5) this.addExclusion(c.x + c.dirX * t, c.z + c.dirZ * t, c.width * 0.9);
    }
    hf.computeNormals();

    // echo stones (placed after stamps so heights are final)
    const echoes = [];
    const at = (x, z) => ({ x, z, y: hf.heightAt(x, z) });
    if (S.ring) { const a = S.ring.rot + 0.4; echoes.push({ ...at(S.ring.x + Math.cos(a) * 22, S.ring.z + Math.sin(a) * 22), echo: 1 }); }
    if (S.gate) { const L = hf.lake; const dx = S.gate.x - L.x, dz = S.gate.z - L.z, d = Math.hypot(dx, dz); echoes.push({ ...at(S.gate.x + dx / d * 9, S.gate.z + dz / d * 9), echo: 2 }); }
    if (S.leviathan) { const lv = S.leviathan; echoes.push({ ...at(lv.x - Math.cos(lv.yaw) * 30 + Math.sin(lv.yaw) * 5, lv.z - Math.sin(lv.yaw) * 30 - Math.cos(lv.yaw) * 5), echo: 3 }); }
    if (S.cave) { const c = S.cave; const s = c.length - 9.5; echoes.push({ x: c.x + c.dirX * s - c.dirZ * (c.width / 2 - 0.9), z: c.z + c.dirZ * s + c.dirX * (c.width / 2 - 0.9), y: c.floorY + s * c.slope, echo: 0, inCave: true }); }
    if (hf.mesas[0]) { const m = hf.mesas[0]; echoes.push({ ...at(m.x + m.r * 0.3, m.z - m.r * 0.2), echo: 4 }); }
    { const p = hf.ravine.pts[Math.floor(hf.ravine.pts.length * 0.42)]; echoes.push({ ...at(p.x, p.z), echo: 5 }); }
    S.echoes = echoes.filter((e) => e.y > hf.water + 0.3 || e.inCave);
    for (const e of S.echoes) this.addExclusion(e.x, e.z, 2.2);

    // cave crystals for the geology pass
    if (S.cave) {
      const c = S.cave;
      for (const [s, sd, pal] of [[7, 1, 0], [11, -1, 1], [14.5, 1, 0], [c.length - 3, -0.4, 2]]) {
        const o = sd * (c.width / 2 - 0.7);
        this.extraCrystals.push({ x: c.x + c.dirX * s - c.dirZ * o, z: c.z + c.dirZ * s + c.dirX * o, y: c.floorY + s * c.slope, pal, scale: 0.55 });
      }
    }
  }

  // ------------------------------------------------------------------ regions
  buildRegions() {
    const hf = this.hf, S = this.sites;
    const d = (p, x, z) => (p ? Math.hypot(p.x - x, p.z - z) : 1e9);
    const R = [];
    if (S.cave) R.push({ id: 'cave', name: 'THE HOLLOW', biome: 'SUBTERRANEAN', test: (x, z, y) => this.inCave(x, z, y) });
    if (S.orrery) R.push({ id: 'orrery', name: 'THE ORRERY', biome: 'SUMMIT', test: (x, z) => d(S.orrery, x, z) < 20 });
    if (S.ring) R.push({ id: 'ring', name: 'THE LISTENING RING', biome: 'ANCIENT SITE', test: (x, z) => d(S.ring, x, z) < 30 });
    if (S.gate) R.push({ id: 'gate', name: 'SUNKEN GATE', biome: 'DROWNED RUIN', test: (x, z) => d(S.gate, x, z) < 22 });
    if (S.pylons) R.push({ id: 'pylons', name: 'SIGNAL FIELD', biome: 'RUINED INSTALLATION', test: (x, z) => d(S.pylons, x, z) < 34 });
    if (S.leviathan) R.push({ id: 'leviathan', name: 'OSSUARY FLATS', biome: 'BONE FIELD', test: (x, z) => d(S.leviathan, x, z) < 36 });
    for (const m of hf.mesas) R.push({ id: 'mesa', name: 'THE HIGH TABLE', biome: 'PLATEAU', test: (x, z, y) => d(m, x, z) < m.r * 0.95 && y > m.top - 5 });
    if (S.ridge) R.push({ id: 'ridge', name: 'SHARD RIDGE', biome: 'CRYSTAL SCREE', test: (x, z) => d(S.ridge, x, z) < 58 });
    R.push({ id: 'basin', name: 'HOLLOW BASIN', biome: 'STILLWATER SHORE', test: (x, z) => hf.lakeDist(x, z) < 1.3 });
    R.push({ id: 'ravine', name: 'WEEPING RAVINE', biome: 'CANYON FLOOR', test: (x, z, y) => { const r = hf.distToRavine(x, z); return r.d < hf.ravine.width * 1.5 && r.t < 0.95; } });
    R.push({ id: 'grove', name: 'LANTERN GROVE', biome: 'LANTERN CANOPY', test: (x, z) => d(this.groveCenter, x, z) < 72 });
    R.push({ id: 'wall', name: 'THE OUTER WALL', biome: 'HIGH RIDGES', test: (x, z) => Math.hypot(x, z) > 226 });
    if (this.biomeAt) {
      const B = this.biomeAt;
      R.push({ id: 'violetwood', name: 'THE VIOLET WOOD', biome: 'FUNGAL FOREST', test: (x, z) => B(x, z).fungal > 0.55 });
      R.push({ id: 'coralthicket', name: 'CORAL THICKET', biome: 'CORAL THICKET', test: (x, z) => B(x, z).coral > 0.55 });
      R.push({ id: 'amberheights', name: 'AMBER HEIGHTS', biome: 'DRY HIGHLAND', test: (x, z) => B(x, z).amber > 0.55 });
    }
    for (const p of this.pois) R.unshift({ id: p.entry, name: p.name, biome: 'NATURAL ARCH', test: (x, z) => d(p, x, z) < p.radius });
    this.regions = R;
  }
  regionAt(x, z, y) {
    for (const r of this.regions) if (r.test(x, z, y)) return r;
    return { id: null, name: 'LUMEN THICKET', biome: 'LUMEN THICKET' };
  }

  /** The moon hangs ahead of the landing site over the lake; the ringed giant to the right. */
  computeSky() {
    const sp = this.sites.spawn, UPV = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw));
    const sunDir = fwd.clone().applyAxisAngle(UPV, 0.42);
    const el = THREE.MathUtils.degToRad(22);
    sunDir.set(sunDir.x * Math.cos(el), Math.sin(el), sunDir.z * Math.cos(el)).normalize();
    const planetDir = fwd.clone().applyAxisAngle(UPV, -0.62);
    const pel = THREE.MathUtils.degToRad(15);
    planetDir.set(planetDir.x * Math.cos(pel), Math.sin(pel), planetDir.z * Math.cos(pel)).normalize();
    this.sunDir = sunDir; this.planetDir = planetDir;
    U.uSunDir.value.copy(sunDir);
  }

  // ------------------------------------------------------------ cave queries
  caveLocal(x, z) {
    const c = this.sites.cave; if (!c) return null;
    const dx = x - c.x, dz = z - c.z;
    return { c, along: dx * c.dirX + dz * c.dirZ, side: -dx * c.dirZ + dz * c.dirX };
  }
  inCave(x, z, y) {
    const l = this.caveLocal(x, z); if (!l) return false;
    const { c, along, side } = l;
    if (along < 0.2 || along > c.length || Math.abs(side) > c.width / 2 + 0.3) return false;
    return y < c.floorY + along * c.slope + c.height + 0.8;
  }
  /**
   * Ground under a point, honouring the cave tunnel. Returns {ground, ceiling, cave, limitSide, limitAlong}.
   */
  groundAt(x, z, y, out) {
    out.cave = false; out.ceiling = Infinity;
    const l = this.caveLocal(x, z);
    if (l) {
      const { c, along, side } = l;
      if (along > -0.4 && along < c.length + 0.5 && Math.abs(side) < c.width / 2 + 0.6) {
        const floor = c.floorY + Math.max(0, along) * c.slope;
        if (y < floor + c.height + 0.9 && along > 0.0) {
          const taper = along > c.length - 4.5 ? Math.sqrt(Math.max(0.02, (c.length - along) / 4.5)) : 1;
          out.ground = Math.max(floor, along < c.notch ? Math.min(this.hf.heightAt(x, z), floor + 0.2) : floor);
          out.ceiling = floor + c.height * taper * 0.92;
          out.cave = true; out.local = l;
          out.halfW = Math.max(0.3, (c.width / 2) * taper - 0.55);
          out.maxAlong = c.length - 2.2;
          return out;
        }
      }
    }
    out.ground = this.hf.heightAt(x, z);
    return out;
  }

  // ------------------------------------------------------------- generation
  async generate(progress, renderer) {
    const hf = this.hf = new Heightfield(this.seed);
    await hf.generate(progress);
    progress('Choosing landmarks', 0.82); await nextFrame();
    this.chooseSites();
    this.applyStamps();
    this.computeSky();
    if (this.sites.cave) {
      const c = this.sites.cave;
      U.uCaveA.value.set(c.x, c.z, c.dirX, c.dirZ);
      U.uCaveB.value.set(c.length, c.width / 2, c.floorY, c.height);
    }
    progress('Casting moon shadows', 0.835); await nextFrame();
    U.uSunShadow.value = hf.bakeSunShadow(this.sunDir);
    U.uSunShadowInfo.value.set(hf.half, hf.size);
    progress('Raising terrain', 0.84); await nextFrame();
    this.terrain = new Terrain(hf, this.quality);
    this.scene.add(this.terrain.build());
    this.terrain.makeHeightTexture();
    const hu = this.terrain.heightUniforms();
    this.heightUniforms = hu;
    this.water = new Water(hf, hu, this.quality);
    this.scene.add(this.water.mesh);
    progress('Restoring ruins', 0.87); await nextFrame();
    this.ruins = new Ruins(this);
    this.scene.add(this.ruins.build());
    progress('Placing stone', 0.89); await nextFrame();
    this.geology = new Geology(this);
    this.scene.add(this.geology.build());
    progress('Seeding flora', 0.92); await nextFrame();
    this.vegetation = new Vegetation(this);
    this.scene.add(this.vegetation.build());
    this.glowSpots.push(...this.vegetation.glowSpots);
    this.grass = new Grass(this, hu);
    if (this.grass.enabled) this.scene.add(this.grass.mesh);
    this.buildRegions();
  }

  update(dt, t, camPos) {
    this.vegetation.update(dt, camPos);
    this.geology.update(dt, camPos);
    this.ruins.update(t, dt);
    this.water.windU.value = U.uWind.value.z;
    if (this.grass.enabled) this.grass.update(camPos);
  }
}
