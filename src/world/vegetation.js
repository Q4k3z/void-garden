// Ecological placement of all flora. Density is driven by terrain data (moisture from
// the erosion flow map, slope, altitude, baked occlusion, distance to water) multiplied
// by per-species clumping noise, so plants form patches, understories and shorelines
// instead of a uniform sprinkle.
import * as THREE from 'three';
import { makeRng, hash01 } from '../core/rng.js';
import { createNoise2D, fbm, smoothstep, clamp } from '../core/noise.js';
import { ScatterLayer } from './scatter.js';
import { makeBioMaterial } from './materials.js';
import { planLanternTree, buildLanternTree, buildLumenStalk, buildBloomFlower, buildMushroomCluster, buildFern, buildBush, buildReeds } from './plants.js';
import { buildCoralTree, buildParasolFungus, buildSpireHorns, buildThornbrush, buildLilyPads, buildKelp } from './plants2.js';

const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class Vegetation {
  constructor(world) {
    this.world = world;
    this.hf = world.hf;
    this.q = world.quality;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.layers = [];
    this.trees = [];       // {x,z,r,scale,h}
    this.flowers = [];     // interactive bloom flowers
    this.feedSpots = [];   // skitterer grazing spots (mushrooms / ferns)
    this.glowSpots = [];   // bio-light hotspots
    this.floraSpots = { coral: [], parasol: [], spire: [], thorn: [], lily: [] }; // for journal discovery
    this.biomeArea = {};
    this._B = { wet: 0, amber: 0, fungal: 0, coral: 0, grove: 0 };
  }

  /**
   * Biome weights at a point (0..1 each; reused object, copy if you keep it).
   * Large-scale noise fields biased by terrain: dry, high ground turns amber; damp hollows host
   * the fungal wood; the coral thicket takes over open mid-ground; water margins are wetland.
   */
  biome(x, z) {
    const hf = this.hf, B = this._B;
    const h = hf.heightAt(x, z), m = hf.moistAt(x, z);
    const n1 = fbm(this._biomeN, x * 0.0055 + 11.3, z * 0.0055 - 7.1, 3);
    const n2 = fbm(this._biomeN, x * 0.0068 - 31.7, z * 0.0068 + 19.2, 3);
    B.grove = this._groveW(x, z);
    B.wet = 1 - smoothstep(0.6, 3.5, h - hf.water);
    const free = (1 - B.grove) * (1 - B.wet);
    B.amber = smoothstep(0.32, 0.62, n1 * 0.9 + (h - 9) / 20 + (0.66 - m) * 1.4) * free;
    B.fungal = smoothstep(0.2, 0.45, -n1 * 0.8 + n2 * 0.45 + (m - 0.62) * 1.2 - (h - 9) / 45) * free * (1 - B.amber);
    B.coral = smoothstep(0.18, 0.42, -n2 * 0.9 + n1 * 0.2) * free * (1 - B.amber) * (1 - B.fungal);
    return B;
  }

  matrixAt(x, z, yaw, scale, tilt, sink, sy = scale) {
    const hf = this.hf;
    _p.set(x, hf.heightAt(x, z) - sink, z);
    hf.normalAt(x, z, _n);
    _n.lerp(UP, 1 - tilt).normalize();
    _q1.setFromAxisAngle(UP, yaw);
    _q2.setFromUnitVectors(UP, _n);
    _q.copy(_q2).multiply(_q1);
    _s.set(scale, sy, scale);
    return _m.compose(_p, _q, _s);
  }

  /** Jittered-grid candidate sampling with a density function. */
  sample(rng, spacing, density, extent = this.world.playRadius) {
    const out = [];
    for (let z = -extent; z < extent; z += spacing) for (let x = -extent; x < extent; x += spacing) {
      const px = x + rng.next() * spacing, pz = z + rng.next() * spacing;
      const r1 = rng.next();
      if (px * px + pz * pz > extent * extent) continue;
      if (this.world.isExcluded(px, pz)) continue;
      const d = density(px, pz);
      if (d > 0 && r1 < d) out.push({ x: px, z: pz, k: out.length });
    }
    return out;
  }

  build() {
    const { hf, world } = this;
    const seed = world.seed;
    const rng = makeRng(seed, 'vegetation');
    const keepFrac = clamp(this.q.vegDensity / 1.25, 0, 1);
    const keep = (i, salt) => hash01(i, salt, 77) < keepFrac;
    const clumpN = createNoise2D(makeRng(seed, 'clump'));
    const clump = (x, z, f, o = 0) => smoothstep(-0.25, 0.45, fbm(clumpN, x * f + o, z * f - o, 3));
    const W = hf.water;
    const grove = world.groveCenter;
    const groveW = (x, z) => Math.exp(-(((x - grove.x) ** 2 + (z - grove.z) ** 2) / (75 * 75)));
    this._groveW = groveW;
    this._biomeN = createNoise2D(makeRng(seed, 'biome'));
    const B = (x, z) => this.biome(x, z);
    world.biomeAt = B;
    {
      // biome coverage of the play area (journal entries exist only for biomes that are really there)
      const acc = { wet: 0, amber: 0, fungal: 0, coral: 0, grove: 0 }; let n = 0;
      const R = world.playRadius;
      for (let z = -R; z < R; z += 8) for (let x = -R; x < R; x += 8) { if (x * x + z * z > R * R) continue; const b = B(x, z); for (const k in acc) acc[k] += b[k] > 0.55 ? 1 : 0; n++; }
      for (const k in acc) this.biomeArea[k] = acc[k] / n;
    }

    const matTree = makeBioMaterial({ roughness: 0.78, glow: 1.35, wind: true, translucent: true, triplanar: { scale: 0.75, strength: 0.6 } });
    const a2c = (this.q.msaa || 0) > 0 && this.q.post;
    const matPlant = makeBioMaterial({ roughness: 0.62, glow: 1.6, wind: true, push: true, translucent: true, foliage: true, alphaToCoverage: a2c });
    const matFlower = makeBioMaterial({ roughness: 0.5, glow: 1.4, wind: true, push: true, instanceGlow: true, translucent: true, foliage: true, alphaToCoverage: a2c });
    this.materials = [matTree, matPlant, matFlower];

    // ---------------------------------------------------------------- trees
    const plans = [0, 1, 2, 3].map((i) => planLanternTree(rng.fork('tree' + i)));
    // body (casts shadows, two LODs) and hanging tendrils (near only, no shadow pass)
    const treeLayers = plans.map((p, i) => new ScatterLayer({
      name: 'lanternTree' + i, material: matTree, cellSize: 112, castShadow: true,
      lods: [{ geometry: buildLanternTree(p, true, 'body'), maxDist: 105 * this.q.terrainLod }, { geometry: buildLanternTree(p, false, 'body'), maxDist: 560 }],
    }));
    const tendrilLayers = plans.map((p, i) => new ScatterLayer({
      name: 'tendrils' + i, material: matTree, cellSize: 112, castShadow: false,
      lods: [{ geometry: buildLanternTree(p, true, 'tendrils'), maxDist: 85 * this.q.terrainLod }],
    }));
    const treeR = makeRng(seed, 'trees');
    const cand = this.sample(treeR, 7.5, (x, z) => {
      const h = hf.heightAt(x, z);
      if (h < W + 0.7 || h > 48) return 0;
      const s = hf.slopeAt(x, z);
      if (s > 0.3) return 0;
      const m = hf.moistAt(x, z);
      const b = B(x, z), other = Math.max(0, 1 - b.fungal - b.coral * 0.8 - b.amber * 0.9);
      return clamp(groveW(x, z) * 0.75 + smoothstep(0.35, 0.8, m) * 0.18 * clump(x, z, 0.01, 3) * other, 0, 0.85);
    });
    const grid = new Map();
    const gkey = (x, z) => Math.floor(x / 12) + ',' + Math.floor(z / 12);
    for (const c of cand) {
      const g = groveW(c.x, c.z);
      const scale = treeR.float(0.72, 1.0) + g * treeR.float(0.1, 0.4);
      const minD = 6.5 * scale;
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) {
        const arr = grid.get((Math.floor(c.x / 12) + dx) + ',' + (Math.floor(c.z / 12) + dz));
        if (arr) for (const t of arr) if ((t.x - c.x) ** 2 + (t.z - c.z) ** 2 < (minD + t.minD) ** 2 * 0.5) { ok = false; break; }
      }
      if (!ok) continue;
      const v = treeR.int(0, 3);
      const yaw = treeR.angle();
      const tm = this.matrixAt(c.x, c.z, yaw, scale, 0.05, 0.4);
      treeLayers[v].add(tm); tendrilLayers[v].add(tm);
      const t = { x: c.x, z: c.z, minD, scale, r: 0.95 * scale, h: plans[v].H * scale, plan: plans[v], yaw };
      this.trees.push(t);
      const k = gkey(c.x, c.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t);
      world.colliders.add(c.x, c.z, t.r, t.h);
    }
    this.layers.push(...treeLayers, ...tendrilLayers);
    const nearTree = (x, z, r) => {
      const arr = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const a = grid.get((Math.floor(x / 12) + dx) + ',' + (Math.floor(z / 12) + dz)); if (a) arr.push(...a); }
      let best = 1e9; for (const t of arr) best = Math.min(best, Math.hypot(t.x - x, t.z - z)); return best < r ? 1 - best / r : 0;
    };
    // glow hotspots under some tree caps (for the bio-light pool)
    for (const t of this.trees) if (hash01(t.x * 10, t.z * 10, 3) < 0.35) this.glowSpots.push({ x: t.x, y: hf.heightAt(t.x, t.z) + t.h * 0.7, z: t.z, color: t.plan.hue === 'violet' ? 0x9a6cff : t.plan.hue === 'amber' ? 0xffa850 : 0x4fffd8, intensity: 8, range: 16, kind: 'tree' });

    // ----------------------------------------------------------- understory
    const addSimple = (name, geos, opts, density, spacing, place) => {
      const layers = geos.map((g, i) => new ScatterLayer({ name: name + i, material: opts.material || matPlant, cellSize: opts.cell || 64, castShadow: !!opts.shadow, lods: Array.isArray(g) ? g : [{ geometry: g, maxDist: opts.maxDist }] }));
      const r = makeRng(seed, name);
      const pts = this.sample(r, spacing, density);
      let n = 0;
      for (const p of pts) {
        if (!keep(p.k, name.length * 13 + spacing * 7)) continue;
        const v = r.int(0, layers.length - 1);
        const s = place(p, r);
        if (s.flat) { _q.setFromAxisAngle(UP, r.angle()); layers[v].add(_m.compose(_p.set(p.x, s.y, p.z), _q, _s.setScalar(s.scale))); }
        else layers[v].add(this.matrixAt(p.x, p.z, r.angle(), s.scale, s.tilt ?? 0.5, s.sink ?? 0.05, s.sy));
        n++;
        if (opts.onPlace) opts.onPlace(p, s);
      }
      this.layers.push(...layers);
      return n;
    };

    const vr = makeRng(seed, 'variants');
    // lumen stalks: moist ground, gathered around trees and shorelines
    addSimple('stalk', [0, 1, 2].map(() => buildLumenStalk(vr)), { maxDist: 82 * this.q.terrainLod, cell: 72 }, (x, z) => {
      const h = hf.heightAt(x, z); if (h < W + 0.25 || h > 55) return 0;
      if (hf.slopeAt(x, z) > 0.45) return 0;
      const m = hf.moistAt(x, z);
      return clamp(smoothstep(0.3, 0.8, m) * 0.3 * clump(x, z, 0.03) + nearTree(x, z, 11) * 0.3 + groveW(x, z) * 0.12, 0, 0.7) * (1 - B(x, z).amber * 0.8);
    }, 4.4, (p, r) => ({ scale: r.float(0.7, 1.3), tilt: 0.3 }));

    // ferns: understory, shade, moist gullies
    const fernGeos = [0, 1, 2].map(() => { const s = vr.fork('fern' + vr.int(0, 1e6)); return [{ geometry: buildFern(s.fork('a'), true), maxDist: 44 * this.q.terrainLod }, { geometry: buildFern(s.fork('a'), false), maxDist: 90 * this.q.terrainLod }]; });
    addSimple('fern', fernGeos, { cell: 64 }, (x, z) => {
      const h = hf.heightAt(x, z); if (h < W + 0.3 || h > 60) return 0;
      const s = hf.slopeAt(x, z); if (s > 0.55) return 0;
      const m = hf.moistAt(x, z), ao = hf.aoAt(x, z);
      return clamp((smoothstep(0.2, 0.75, m) * 0.5 + (1 - ao) * 0.6 + nearTree(x, z, 14) * 0.45) * clump(x, z, 0.022, 9), 0, 0.85) * (1 - B(x, z).amber * 0.85);
    }, 2.7, (p, r) => {
      if (r.chance(0.08)) this.feedSpots.push({ x: p.x, z: p.z });
      return { scale: r.float(0.7, 1.35), tilt: 0.6 };
    });

    // mushrooms: shaded, damp, around roots, gullies and the ravine
    addSimple('shroom', ['lantern', 'puff', 'needle'].map((k) => buildMushroomCluster(vr.fork('m' + k), k)), { maxDist: 74 * this.q.terrainLod, cell: 72 }, (x, z) => {
      const h = hf.heightAt(x, z); if (h < W + 0.2) return 0;
      const s = hf.slopeAt(x, z); if (s > 0.5) return 0;
      const m = hf.moistAt(x, z), ao = hf.aoAt(x, z);
      return clamp((smoothstep(0.45, 0.9, m) * 0.35 + (1 - ao) * 0.5 + nearTree(x, z, 7) * 0.55 + B(x, z).fungal * 0.5) * clump(x, z, 0.04, 21), 0, 0.85);
    }, 4.2, (p, r) => {
      if (r.chance(0.3)) this.feedSpots.push({ x: p.x, z: p.z });
      if (r.chance(0.035)) this.glowSpots.push({ x: p.x, y: hf.heightAt(p.x, p.z) + 0.8, z: p.z, color: 0x52ffd6, intensity: 3, range: 7, kind: 'shroom' });
      return { scale: r.float(0.7, 1.5), tilt: 0.7 };
    });

    // bushes: drier slopes and mid elevations
    const bushGeos = [0, 1, 2].map(() => { const s = vr.fork('bush' + vr.int(0, 1e6)); return [{ geometry: buildBush(s.fork('a'), true), maxDist: 65 * this.q.terrainLod }, { geometry: buildBush(s.fork('a'), false), maxDist: 140 * this.q.terrainLod }]; });
    addSimple('bush', bushGeos, { cell: 80, shadow: false }, (x, z) => {
      const h = hf.heightAt(x, z); if (h < W + 0.6 || h > 70) return 0;
      const s = hf.slopeAt(x, z); if (s > 0.5) return 0;
      const m = hf.moistAt(x, z);
      return clamp((smoothstep(0.08, 0.3, s) * 0.4 + (1 - m) * 0.15) * clump(x, z, 0.018, 33), 0, 0.6) * (1 - B(x, z).amber * 0.7);
    }, 4.0, (p, r) => ({ scale: r.float(0.7, 1.4), tilt: 0.5, sink: 0.12 }));

    // ------------------------------------------------------- biome flora
    const matSoft = makeBioMaterial({ roughness: 0.55, glow: 1.6, wind: true, translucent: true });
    const matWater = makeBioMaterial({ roughness: 0.35, glow: 1.6, wind: true, translucent: true, foliage: true, alphaToCoverage: a2c });
    const matCoral = makeBioMaterial({ roughness: 0.6, glow: 1.5, wind: true }); // plain: many small branches, keep the fragment cost low
    this.materials.push(matSoft, matWater, matCoral);
    const L = this.q.terrainLod;
    const big = (fn, n, near, far, salt) => [...Array(n)].map((_, i) => { const s = vr.fork(salt + i); return [{ geometry: fn(s.fork('g'), true, i).geometry, maxDist: near * L }, { geometry: fn(s.fork('g'), false, i).geometry, maxDist: far }]; });

    // coral trees: the Coral Thicket
    addSimple('coral', big(buildCoralTree, 3, 65, 360, 'coral'), { material: matCoral, cell: 64, shadow: true }, (x, z) => {
      const h = hf.heightAt(x, z); if (h < W + 0.5) return 0;
      if (hf.slopeAt(x, z) > 0.4) return 0;
      return clamp(B(x, z).coral * 0.55 * (0.4 + clump(x, z, 0.02, 51)), 0, 0.6);
    }, 6.5, (p, r) => {
      const s = r.float(0.75, 1.35);
      world.colliders.add(p.x, p.z, 0.32 * s, 4 * s);
      if (r.chance(0.07)) this.glowSpots.push({ x: p.x, y: hf.heightAt(p.x, p.z) + 3.5 * s, z: p.z, color: 0xff7fc8, intensity: 5, range: 12, kind: 'tree' });
      this.floraSpots.coral.push({ x: p.x, z: p.z });
      return { scale: s, tilt: 0.15, sink: 0.1 };
    });

    // parasol fungi: the Violet Wood
    addSimple('parasol', [...Array(3)].map((_, i) => { const s = vr.fork('parasol' + i); return [{ geometry: buildParasolFungus(s.fork('g'), true).geometry, maxDist: 90 * L }, { geometry: buildParasolFungus(s.fork('g'), false).geometry, maxDist: 340 }]; }),
      { material: matSoft, cell: 96, shadow: true }, (x, z) => {
        const h = hf.heightAt(x, z); if (h < W + 0.6) return 0;
        if (hf.slopeAt(x, z) > 0.35) return 0;
        return clamp(B(x, z).fungal * 0.42 * (0.5 + clump(x, z, 0.015, 61)), 0, 0.5);
      }, 9, (p, r) => {
        const s = r.float(0.75, 1.3);
        world.colliders.add(p.x, p.z, 0.7 * s, 6 * s); // the stem flares to about 0.7 m at the foot
        if (r.chance(0.12)) this.glowSpots.push({ x: p.x, y: hf.heightAt(p.x, p.z) + 5 * s, z: p.z, color: 0x9a6cff, intensity: 7, range: 15, kind: 'tree' });
        this.floraSpots.parasol.push({ x: p.x, z: p.z });
        return { scale: s, tilt: 0.06, sink: 0.15 };
      });

    // spire horns and thornbrush: Amber Heights
    addSimple('spire', big(buildSpireHorns, 3, 80, 300, 'spire'), { material: matCoral, cell: 80, shadow: true }, (x, z) => {
      const h = hf.heightAt(x, z); if (h < W + 1) return 0;
      const s = hf.slopeAt(x, z); if (s > 0.6) return 0;
      return clamp(B(x, z).amber * (0.16 + smoothstep(0.15, 0.45, s) * 0.25) * (0.5 + clump(x, z, 0.03, 71)), 0, 0.45);
    }, 7, (p, r) => {
      const s = r.float(0.7, 1.4);
      world.colliders.add(p.x, p.z, 0.85 * s, 3 * s); // the horns of a cluster spread up to about 1 m
      if (r.chance(0.05)) this.glowSpots.push({ x: p.x, y: hf.heightAt(p.x, p.z) + 2.5 * s, z: p.z, color: 0xffa850, intensity: 4, range: 9, kind: 'shroom' });
      this.floraSpots.spire.push({ x: p.x, z: p.z });
      return { scale: s, tilt: 0.3, sink: 0.05 };
    });
    addSimple('thorn', big(buildThornbrush, 2, 60, 140, 'thorn'), { material: matSoft, cell: 72 }, (x, z) => {
      const h = hf.heightAt(x, z); if (h < W + 0.8) return 0;
      if (hf.slopeAt(x, z) > 0.55) return 0;
      return clamp(B(x, z).amber * 0.5 * clump(x, z, 0.035, 81), 0, 0.55);
    }, 3.6, (p, r) => {
      if (r.chance(0.2)) this.floraSpots.thorn.push({ x: p.x, z: p.z });
      return { scale: r.float(0.7, 1.3), tilt: 0.5, sink: 0.08 };
    });

    // lily pads on the shallows, kelp below the surface
    addSimple('lily', [0, 1, 2].map((i) => buildLilyPads(vr.fork('lily' + i)).geometry), { material: matWater, cell: 48, maxDist: 130 }, (x, z) => {
      const d = W - hf.heightAt(x, z);
      if (d < 0.15 || d > 1.6) return 0;
      // a pad cluster spans about 2.5 m: keep all of it over water, not draped onto the bank
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; if (W - hf.heightAt(x + Math.cos(a) * 2.6, z + Math.sin(a) * 2.6) < 0.05) return 0; }
      return 0.55 * clump(x, z, 0.06, 91) + 0.08;
    }, 3.2, (p, r) => {
      if (r.chance(0.3)) this.floraSpots.lily.push({ x: p.x, z: p.z });
      return { scale: r.float(0.8, 1.3), y: W, flat: true };
    });
    const kelp = [0, 1].map((i) => buildKelp(vr.fork('kelp' + i)));
    const kelpH = Math.max(...kelp.map((k) => k.height)) + 0.2;
    addSimple('kelp', kelp.map((k) => k.geometry), { material: matWater, cell: 48, maxDist: 75 }, (x, z) => {
      const d = W - hf.heightAt(x, z);
      if (d < 1.1 || d > 4.5) return 0;
      return 0.5 * clump(x, z, 0.05, 97);
    }, 2.6, (p, r) => {
      // blades stay at least 0.3 m under the surface instead of poking out of shallow water
      const s = r.float(0.7, 1.3), d = W - hf.heightAt(p.x, p.z);
      return { scale: s, sy: Math.min(s, Math.max(0.25, (d - 0.3) / kelpH)), tilt: 0.1, sink: 0.05 };
    });

    // reeds: the shoreline transition
    addSimple('reed', [0, 1].map(() => buildReeds(vr)), { maxDist: 90, cell: 48 }, (x, z) => {
      const h = hf.heightAt(x, z);
      if (h < W - 0.7 || h > W + 0.9) return 0;
      if (hf.slopeAt(x, z) > 0.35) return 0;
      return 0.75 * clump(x, z, 0.05, 41) + 0.1;
    }, 1.7, (p, r) => ({ scale: r.float(0.7, 1.3), tilt: 0.2 }));

    // ------------------------------------------------------ bloom flowers
    const fr = makeRng(seed, 'flowers');
    const fGeo = buildBloomFlower(fr.fork('geo'), true);
    const fpts = this.sample(fr, 9, (x, z) => {
      const h = hf.heightAt(x, z); if (h < W + 0.6 || h > 40) return 0;
      if (hf.slopeAt(x, z) > 0.28) return 0;
      const m = hf.moistAt(x, z);
      const shore = 1 - smoothstep(1, 10, h - W);
      return clamp(shore * 0.25 + groveW(x, z) * 0.18 + smoothstep(0.5, 0.9, m) * 0.06, 0, 0.5);
    });
    const placedF = [];
    for (const p of fpts) {
      if (placedF.some((f) => (f.x - p.x) ** 2 + (f.z - p.z) ** 2 < 10 * 10)) continue;
      placedF.push(p);
      if (placedF.length >= 56) break;
    }
    const fm = new THREE.InstancedMesh(fGeo.geometry, matFlower, placedF.length);
    const c = new THREE.Color();
    placedF.forEach((p, i) => {
      const s = fr.float(0.85, 1.25);
      fm.setMatrixAt(i, this.matrixAt(p.x, p.z, fr.angle(), s, 0.15, 0.08));
      fm.setColorAt(i, c.setRGB(1, 0, 0));
      const y = hf.heightAt(p.x, p.z);
      this.flowers.push({ index: i, x: p.x, z: p.z, y, top: y + fGeo.height * s, scale: s, flare: 0, awakened: false });
      this.glowSpots.push({ x: p.x, y: y + fGeo.height * s, z: p.z, color: 0x6fffe0, intensity: 4, range: 8, kind: 'flower', ref: this.flowers[this.flowers.length - 1] });
    });
    fm.instanceMatrix.needsUpdate = true; if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    fm.computeBoundingSphere();
    fm.castShadow = false; fm.receiveShadow = true;
    fm.name = 'bloomFlowers';
    this.flowerMesh = fm;
    this.group.add(fm);

    for (const L of this.layers) this.group.add(L.build());
    return this.group;
  }

  /** Light up one bloom flower (instance colour .g drives an emissive flare). */
  setFlowerFlare(i, flare, base = 1) {
    const fm = this.flowerMesh;
    fm.instanceColor.setXYZ(i, base, flare, 0);
    fm.instanceColor.needsUpdate = true;
  }

  update(dt, camPos) {
    for (const L of this.layers) L.update(camPos);
    let dirty = false;
    for (const f of this.flowers) {
      const floor = f.awakened ? 0.18 : 0;
      if (f.flare > floor + 0.0005 || f.shown !== f.awakened) {
        f.flare = Math.max(floor, f.flare - dt * 0.35);
        f.shown = f.awakened;
        this.flowerMesh.instanceColor.setXYZ(f.index, 1 + (f.awakened ? 0.6 : 0), f.flare, 0);
        dirty = true;
      }
    }
    if (dirty) this.flowerMesh.instanceColor.needsUpdate = true;
  }
}
