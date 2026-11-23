// Geology: displaced boulders, faceted cliff slabs, pebble fields, basalt column
// formations, resonant crystal deposits and natural stone arches.
// Every object is grounded by sampling the terrain under its footprint and sunk in.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, hash01 } from '../core/rng.js';
import { createNoise3D, fbm3, smoothstep, clamp } from '../core/noise.js';
import { GeoBuilder, col } from './geo.js';
import { ScatterLayer } from './scatter.js';
import { makeBioMaterial } from './materials.js';

const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

const ROCK = { a: col(0x2a3a3b), b: col(0x1a2627), c: col(0x3a403c), warm: col(0x3d3630), moss: col(0x1d4a3a), moss2: col(0x2b5c45), lichen: col(0x7dffe0) };

function finishRock(b) {
  let g = b.toGeometry();
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

export function buildRock(rng, noise3, kind = 'boulder', detail = 1) {
  const b = new GeoBuilder();
  const o = rng.float(0, 100);
  const facet = kind === 'slab' ? 0.55 : kind === 'boulder' ? 0.25 : 0.1;
  const radii = kind === 'slab' ? new THREE.Vector3(1, rng.float(0.35, 0.55), rng.float(0.5, 0.75))
    : kind === 'pebble' ? new THREE.Vector3(1, rng.float(0.5, 0.8), rng.float(0.7, 1))
      : new THREE.Vector3(1, rng.float(0.6, 0.85), rng.float(0.75, 1));
  const segW = kind === 'pebble' ? 8 : Math.round(20 * detail), segH = kind === 'pebble' ? 6 : Math.round(13 * detail);
  const tone = rng.float(0, 1);
  const baseC = ROCK.b.clone().lerp(ROCK.a, tone).lerp(ROCK.warm, rng.chance(0.25) ? 0.35 : 0);
  const disp = (nx, ny, nz) => {
    let n = fbm3(noise3, nx * 1.4 + o, ny * 1.4, nz * 1.4 - o, 4) * 0.38;
    const q = Math.round(n * 5) / 5;
    n = n * (1 - facet) + q * facet;
    n += fbm3(noise3, nx * 5 + o, ny * 5, nz * 5, 2) * 0.06;
    let d = 1 + n;
    if (ny < -0.15) d *= 1 - smoothstep(-0.15, -0.9, ny) * 0.45; // flattened base
    return d - 1;
  };
  b.ellipsoid(new THREE.Vector3(0, 0, 0), radii, segW, segH,
    (nx, ny, nz) => {
      const m = smoothstep(0.35, 0.75, ny + fbm3(noise3, nx * 3 + o, ny * 3, nz * 3, 2) * 0.5);
      const c = baseC.clone().multiplyScalar(0.8 + 0.4 * (fbm3(noise3, nx * 6, ny * 6 + o, nz * 6, 2) * 0.5 + 0.5));
      c.lerp(ROCK.moss.clone().lerp(ROCK.moss2, 0.5 + 0.5 * Math.sin(nx * 9 + o)), m * 0.85);
      if (ny < -0.2) c.multiplyScalar(0.6);
      const lich = noise3(nx * 18 + o, ny * 18, nz * 18) > 0.74 && ny > 0.1 ? 1 : 0;
      return lich ? c.clone().lerp(ROCK.lichen, 0.5) : c;
    },
    (nx, ny, nz) => (noise3(nx * 18 + o, ny * 18, nz * 18) > 0.74 && ny > 0.1 ? 0.25 : 0),
    { displace: disp });
  return finishRock(b);
}

/** Cluster of hexagonal basalt columns with stepped tops (a mineral formation). */
function buildBasalt(rng) {
  const b = new GeoBuilder();
  const n = rng.int(14, 26);
  const R = rng.float(2.2, 3.8);
  const cA = col(0x1c2628), cB = col(0x2c3634);
  for (let i = 0; i < n; i++) {
    const a = rng.angle(), d = Math.sqrt(rng.next()) * R;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = (1 - d / R) * rng.float(3, 7) + rng.float(0.6, 1.8);
    const r = rng.float(0.32, 0.5);
    const c = cA.clone().lerp(cB, rng.next());
    const tilt = new THREE.Vector3(rng.float(-0.06, 0.06), 1, rng.float(-0.06, 0.06)).normalize();
    b.prism(new THREE.Vector3(x, -1.5, z), tilt, h + 1.5, r, 6, c, 0, rng.chance(0.15) ? 0.35 : 0, { twist: rng.float(0, 1) });
  }
  return { geometry: b.toGeometry(), radius: R + 0.4 };
}

/** Crystal deposit: prisms radiating from a buried root, glow strongest toward the tips. */
export function buildCrystalCluster(rng, color) {
  const b = new GeoBuilder();
  const n = rng.int(6, 13);
  const base = col(0x10302e);
  const tipCol = color.clone();
  for (let i = 0; i < n; i++) {
    const a = rng.angle();
    const tilt = i === 0 ? 0.08 : rng.float(0.25, 0.85);
    const dir = new THREE.Vector3(Math.cos(a) * tilt, 1, Math.sin(a) * tilt).normalize();
    const len = (i === 0 ? rng.float(2.2, 3.4) : rng.float(0.7, 2.2));
    const r = len * rng.float(0.11, 0.17);
    const off = new THREE.Vector3(Math.cos(a) * rng.float(0, 0.4), -0.35, Math.sin(a) * rng.float(0, 0.4));
    b.prism(off, dir, len, r, 6, base.clone().lerp(tipCol, 0.65), 0.15, 1.0, { tip: r * 2.2, taper: 0.92, twist: rng.float(0, 1) });
  }
  return b.toGeometry();
}

function buildArch(rng, span, height, thick, noise3) {
  const b = new GeoBuilder();
  const pts = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = Math.PI * (1 - t);
    pts.push(new THREE.Vector3(Math.cos(a) * span * 0.5, Math.sin(a) * height - 1.2 + Math.sin(t * 9) * 0.2, Math.sin(t * 5) * 0.6));
  }
  const o = rng.float(0, 50);
  const baseC = ROCK.b.clone().lerp(ROCK.a, 0.6);
  b.tube(pts, (t) => thick * (1.25 - Math.sin(Math.PI * t) * 0.45), 12, (t) => baseC.clone().multiplyScalar(0.85 + 0.3 * Math.sin(t * 17)), () => 0,
    { jitter: (t, a) => fbm3(noise3, Math.cos(a) * 1.3 + o, t * 6, Math.sin(a) * 1.3, 3) * 0.45 });
  return finishRock(b);
}

export class Geology {
  constructor(world) {
    this.world = world;
    this.hf = world.hf;
    this.q = world.quality;
    this.group = new THREE.Group();
    this.group.name = 'geology';
    this.layers = [];
    this.crystals = []; // interactive crystal clusters
    this.rocks = [];    // large boulder positions (creatures avoid, tube worms cling to)
  }

  matrix(x, z, yaw, sx, sy, sz, tilt, sinkFrac, footR) {
    const hf = this.hf;
    const base = hf.minHeightDisc(x, z, footR);
    _p.set(x, base + sy * (0.5 - sinkFrac) * 1.0, z);
    hf.normalAt(x, z, _n); _n.lerp(UP, 1 - tilt).normalize();
    _q1.setFromAxisAngle(UP, yaw); _q2.setFromUnitVectors(UP, _n); _q.copy(_q2).multiply(_q1);
    _s.set(sx, sy, sz);
    return _m.compose(_p, _q, _s);
  }

  build() {
    const { hf, world } = this;
    const seed = world.seed;
    const r = makeRng(seed, 'geology');
    const noise3 = createNoise3D(makeRng(seed, 'rock3d'));
    const mat = makeBioMaterial({ roughness: 0.92, metalness: 0.02, glow: 0.9, wind: false, envMapIntensity: 0.3, triplanar: { scale: 0.32, strength: 1 } });
    this.material = mat;
    const W = hf.water;

    // ---------------- boulders (two LODs) and cliff slabs
    const boulderLayers = [0, 1, 2, 3].map((i) => {
      const rr = r.fork('boulder' + i);
      return new ScatterLayer({
        name: 'boulder' + i, material: mat, cellSize: 96, castShadow: true,
        lods: [{ geometry: buildRock(rr.fork('g'), noise3, 'boulder', 1), maxDist: 150 }, { geometry: buildRock(rr.fork('g'), noise3, 'boulder', 0.45), maxDist: 420 }],
      });
    });
    const slabLayers = [0, 1, 2].map((i) => {
      const rr = r.fork('slab' + i);
      return new ScatterLayer({
        name: 'slab' + i, material: mat, cellSize: 128, castShadow: true,
        lods: [{ geometry: buildRock(rr.fork('g'), noise3, 'slab', 1), maxDist: 200 }, { geometry: buildRock(rr.fork('g'), noise3, 'slab', 0.45), maxDist: 600 }],
      });
    });
    const pebbleLayers = [0, 1].map((i) => new ScatterLayer({ name: 'pebble' + i, material: mat, cellSize: 48, castShadow: false, lods: [{ geometry: buildRock(r.fork('pebble' + i), noise3, 'pebble'), maxDist: 60 }] }));

    const placeBoulder = (x, z, scale, rng) => {
      if (world.isExcluded(x, z, 0.3)) return;
      const h = hf.heightAt(x, z);
      if (h < W - 2.5) return;
      const sx = scale * rng.float(0.85, 1.25), sy = scale * rng.float(0.7, 1.1), sz = scale * rng.float(0.8, 1.2);
      const v = rng.int(0, 3);
      boulderLayers[v].add(this.matrix(x, z, rng.angle(), sx, sy, sz, 0.6, 0.32, Math.min(sx, sz) * 0.6));
      if (scale > 0.9) {
        world.colliders.add(x, z, Math.max(sx, sz) * 0.78, sy * 0.9);
        this.rocks.push({ x, z, r: Math.max(sx, sz), h: sy });
      }
    };
    // clusters around steep ground (talus at cliff feet) and in the ravine
    const clusters = [];
    for (let i = 0; i < 2600 && clusters.length < 85; i++) {
      const a = r.angle(), d = Math.sqrt(r.next()) * world.playRadius;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const s = hf.slopeAt(x, z);
      const steepNear = Math.max(hf.slopeAt(x + 6, z), hf.slopeAt(x - 6, z), hf.slopeAt(x, z + 6), hf.slopeAt(x, z - 6));
      const rv = hf.distToRavine(x, z).d < hf.ravine.width * 1.4;
      if (s > 0.55 || (steepNear < 0.45 && !rv && r.next() > 0.12)) continue;
      clusters.push({ x, z });
      placeBoulder(x, z, r.float(1.6, 4.2), r);
      const m = r.int(3, 8);
      for (let k = 0; k < m; k++) { const aa = r.angle(), dd = r.float(1.5, 6); placeBoulder(x + Math.cos(aa) * dd, z + Math.sin(aa) * dd, r.float(0.35, 1.4), r); }
    }
    // lone boulders in the open
    for (let i = 0; i < 260; i++) {
      const a = r.angle(), d = Math.sqrt(r.next()) * world.playRadius;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (hf.slopeAt(x, z) > 0.5) continue;
      placeBoulder(x, z, r.float(0.4, 2.2), r);
    }
    // cliff slabs embedded in steep faces (geometry silhouettes for cliffs)
    let slabs = 0;
    for (let i = 0; i < 9000 && slabs < 260; i++) {
      const x = r.float(-300, 300), z = r.float(-300, 300);
      const s = hf.slopeAt(x, z);
      if (s < 0.5 || world.isExcluded(x, z, 0.2)) continue;
      const sc = r.float(2.5, 7);
      const v = r.int(0, 2);
      slabLayers[v].add(this.matrix(x, z, r.angle(), sc * r.float(0.9, 1.5), sc * r.float(0.6, 1.0), sc, 0.85, 0.42, sc * 0.3));
      if (Math.hypot(x, z) < world.playRadius) world.colliders.add(x, z, sc * 0.6, sc * 0.6);
      slabs++;
    }
    // pebbles & broken fragments
    const pr = makeRng(seed, 'pebbles');
    const keepFrac = clamp(this.q.vegDensity / 1.25, 0, 1);
    for (let z = -world.playRadius; z < world.playRadius; z += 2.6) for (let x = -world.playRadius; x < world.playRadius; x += 2.6) {
      const px = x + pr.next() * 2.6, pz = z + pr.next() * 2.6;
      const rr = pr.next();
      const s = hf.slopeAt(px, pz);
      const dens = smoothstep(0.12, 0.45, s) * 0.35 + (hf.heightAt(px, pz) < W + 0.6 ? 0.25 : 0) + 0.02;
      if (rr > dens || hash01(px * 7, pz * 7, 5) > keepFrac || world.isExcluded(px, pz, 0.5)) continue;
      const sc = pr.float(0.08, 0.38);
      pebbleLayers[pr.int(0, 1)].add(this.matrix(px, pz, pr.angle(), sc * pr.float(0.8, 1.3), sc, sc, 0.9, 0.35, sc * 0.5));
    }
    this.layers.push(...boulderLayers, ...slabLayers, ...pebbleLayers);

    // ---------------- basalt column formations
    const br = makeRng(seed, 'basalt');
    let basalts = 0;
    for (let i = 0; i < 4000 && basalts < 7; i++) {
      const a = br.angle(), d = br.float(30, world.playRadius - 20);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = hf.heightAt(x, z);
      const ld = hf.lakeDist(x, z);
      const shore = ld > 0.95 && ld < 1.5;
      const ravEdge = Math.abs(hf.distToRavine(x, z).d - hf.ravine.width * 1.1) < 5;
      if (!(shore || ravEdge) || h < W - 0.5 || hf.slopeAt(x, z) > 0.45 || world.isExcluded(x, z, 1)) continue;
      const bg = buildBasalt(br.fork('b' + i));
      const m = new THREE.Mesh(bg.geometry, mat);
      m.position.set(x, hf.minHeightDisc(x, z, bg.radius * 0.6), z);
      m.rotation.y = br.angle();
      m.castShadow = true; m.receiveShadow = true;
      m.updateMatrix(); m.matrixAutoUpdate = false;
      this.group.add(m);
      world.colliders.add(x, z, bg.radius * 0.85, 6);
      world.addExclusion(x, z, bg.radius + 1);
      basalts++;
    }

    // ---------------- crystal deposits (interactive, instanced per colour)
    const cr = makeRng(seed, 'crystals');
    const crystalMat = makeBioMaterial({ roughness: 0.16, metalness: 0.15, glow: 1.25, wind: false, instanceGlow: true, envMapIntensity: 1.1 });
    this.crystalMat = crystalMat;
    const palettes = [{ name: 'cyan', c: col(0x6ffff0), light: 0x55ffe6 }, { name: 'violet', c: col(0xb48cff), light: 0x9a70ff }, { name: 'amber', c: col(0xffb35a), light: 0xffa646 }];
    const spots = [];
    const ridgeC = world.shardRidge;
    for (let i = 0; i < 12000 && spots.length < 42; i++) {
      let x, z;
      if (ridgeC && cr.next() < 0.5) { const a = cr.angle(), d = Math.sqrt(cr.next()) * 55; x = ridgeC.x + Math.cos(a) * d; z = ridgeC.z + Math.sin(a) * d; }
      else { const a = cr.angle(), d = Math.sqrt(cr.next()) * (world.playRadius - 10); x = Math.cos(a) * d; z = Math.sin(a) * d; }
      const h = hf.heightAt(x, z);
      const s = hf.slopeAt(x, z);
      if (h < W + 0.5 || s > 0.62 || world.isExcluded(x, z, 0.5)) continue;
      const rocky = s > 0.18 || h > 25;
      if (!rocky && cr.next() > 0.15) continue;
      if (spots.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 16 * 16)) continue;
      spots.push({ x, z, pal: cr.next() < 0.12 ? 2 : cr.next() < 0.3 ? 1 : 0 });
    }
    // cave crystals are added by the world after the cave is placed
    for (const extra of world.extraCrystals) spots.push(extra);
    for (let pi = 0; pi < palettes.length; pi++) {
      const list = spots.filter((s) => s.pal === pi);
      if (!list.length) continue;
      const geo = buildCrystalCluster(cr.fork('cg' + pi), palettes[pi].c);
      const im = new THREE.InstancedMesh(geo, crystalMat, list.length);
      const c = new THREE.Color(1, 0, 0);
      list.forEach((s, i) => {
        const sc = s.scale || cr.float(0.7, 1.5);
        const yaw = cr.angle();
        if (s.y !== undefined) im.setMatrixAt(i, _m.compose(_p.set(s.x, s.y - 0.05, s.z), _q.setFromAxisAngle(UP, yaw), _s.set(sc, sc, sc)));
        else im.setMatrixAt(i, this.matrix(s.x, s.z, yaw, sc, sc, sc, 0.5, 0.5, 0.5 * sc));
        im.setColorAt(i, c);
        const y = s.y !== undefined ? s.y : hf.heightAt(s.x, s.z);
        const cry = { mesh: im, index: i, x: s.x, y, z: s.z, scale: sc, palette: palettes[pi].name, light: palettes[pi].light, flare: 0, top: y + 2.4 * sc };
        this.crystals.push(cry);
        world.colliders.add(s.x, s.z, 0.7 * sc, 2 * sc);
        world.addExclusion(s.x, s.z, 1.6 * sc);
      });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true; im.receiveShadow = true; im.name = 'crystals-' + palettes[pi].name;
      this.group.add(im);
    }

    // ---------------- natural arches
    const ar = makeRng(seed, 'arches');
    let arches = 0;
    for (let i = 0; i < 3000 && arches < 2; i++) {
      const a = ar.angle(), d = ar.float(60, world.playRadius - 30);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const span = ar.float(11, 17), height = ar.float(7, 11);
      const yaw = ar.angle();
      const ex = Math.cos(yaw) * span * 0.5, ez = Math.sin(yaw) * span * 0.5;
      const hA = hf.heightAt(x - ex, z - ez), hB = hf.heightAt(x + ex, z + ez), hC = hf.heightAt(x, z);
      if (Math.abs(hA - hB) > 3 || hC < W + 1 || hf.slopeAt(x, z) > 0.3 || world.isExcluded(x, z, 2)) continue;
      const geo = buildArch(ar.fork('a' + i), span, height, ar.float(1.3, 2.0), noise3);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, Math.min(hA, hB, hC), z);
      m.rotation.y = -yaw;
      m.castShadow = true; m.receiveShadow = true;
      m.updateMatrix(); m.matrixAutoUpdate = false;
      this.group.add(m);
      world.colliders.add(x - ex, z - ez, 2.2, height);
      world.colliders.add(x + ex, z + ez, 2.2, height);
      world.addExclusion(x, z, span * 0.6);
      world.registerPOI({ id: 'arch' + arches, name: arches === 0 ? 'THE STONE BOW' : 'THE NARROW GATE', x, z, radius: 14, entry: 'arch' });
      arches++;
    }

    for (const L of this.layers) this.group.add(L.build());
    return this.group;
  }

  setCrystalFlare(c, flare) {
    c.mesh.instanceColor.setXYZ(c.index, 1, flare, 0);
    c.mesh.instanceColor.needsUpdate = true;
  }

  update(dt, camPos) {
    for (const L of this.layers) L.update(camPos);
    for (const c of this.crystals) {
      if (c.flare > 0) {
        c.flare = Math.max(0, c.flare - dt * 0.45);
        this.setCrystalFlare(c, c.flare);
      }
    }
  }
}
