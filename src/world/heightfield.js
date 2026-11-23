// Procedural landscape: macro layout + analytic height function + hydraulic erosion
// + derived fields (normals, ambient occlusion, moisture) + fast gameplay queries.
//
// The analytic function `baseHeight` is evaluated everywhere (also for the far backdrop
// mountains). The 1 m heightfield inside the 640 m sector is then eroded by simulated
// rain droplets, which carves gullies, sediment fans and drainage lines. Erosion is
// faded out toward the sector edge so the heightfield meets the analytic backdrop.

import * as THREE from 'three';
import { createNoise2D, fbm, ridged, smoothstep, clamp, lerp } from '../core/noise.js';
import { makeRng } from '../core/rng.js';
import { WORLD } from '../config.js';

import { yieldUI as nextFrame } from '../core/yield.js';

export class Heightfield {
  constructor(seed) {
    this.seed = seed;
    this.size = WORLD.size;
    this.res = WORLD.res;
    this.half = this.size / 2;
    this.cell = this.size / (this.res - 1);
    this.water = WORLD.waterLevel;
    const n = this.res * this.res;
    this.h = new Float32Array(n);
    this.ao = new Float32Array(n);
    this.moist = new Float32Array(n);
    this.flow = new Float32Array(n);
    this.nx = new Float32Array(n);
    this.ny = new Float32Array(n);
    this.nz = new Float32Array(n);
    this.stamps = []; // cave / pad modifications, reapplied to queries
    this._buildLayout();
  }

  // ------------------------------------------------------------------ layout
  _buildLayout() {
    const r = makeRng(this.seed, 'layout');
    const N = (label) => createNoise2D(makeRng(this.seed, 'noise:' + label));
    this.n = {
      wa: N('wa'), wb: N('wb'), broad: N('broad'), mask: N('mask'), ridge: N('ridge'), mid: N('mid'), fine: N('fine'),
      mesa: N('mesa'), mesaTop: N('mesaTop'), bound: N('bound'), boundR: N('boundR'), basin: N('basin'), rav: N('rav'),
      terr: N('terr'), far: N('far'), shelf: N('shelf'),
    };
    // Lake basin near (but not at) the sector centre
    const la = r.angle(), ld = r.float(10, 45);
    this.lake = { x: Math.cos(la) * ld, z: Math.sin(la) * ld, rx: r.float(58, 72), rz: r.float(46, 58), depth: r.float(11, 15), rot: r.angle() };

    // Ravine: meandering canyon from the boundary mountains down into the lake
    const startA = r.angle();
    const pts = [];
    const sx = Math.cos(startA) * 268, sz = Math.sin(startA) * 268;
    const ex = this.lake.x, ez = this.lake.z;
    const steps = 22;
    let perpX = -(ez - sz), perpZ = ex - sx; const pl = Math.hypot(perpX, perpZ); perpX /= pl; perpZ /= pl;
    const mA = r.float(25, 45) * r.sign(), mB = r.float(10, 22) * r.sign(), ph = r.angle();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const meander = Math.sin(t * Math.PI * 2.2 + ph) * mA * Math.sin(t * Math.PI) + Math.sin(t * Math.PI * 5.3 + ph * 2) * mB * Math.sin(t * Math.PI);
      pts.push({ x: lerp(sx, ex, t) + perpX * meander, z: lerp(sz, ez, t) + perpZ * meander, t });
    }
    this.ravine = { pts, width: r.float(13, 17), depth: 18 };

    // Mesas: elevated plateaus with cliff rims (kept clear of the lake and ravine)
    this.mesas = [];
    let guard = 0;
    while (this.mesas.length < 2 && guard++ < 200) {
      const a = r.angle(), d = r.float(95, 190);
      const m = { x: Math.cos(a) * d, z: Math.sin(a) * d, r: r.float(28, 44), top: r.float(24, 34) };
      if (Math.hypot(m.x - this.lake.x, m.z - this.lake.z) < this.lake.rx + m.r + 30) continue;
      if (this.distToRavine(m.x, m.z).d < m.r + 22) continue;
      if (this.mesas.some((o) => Math.hypot(o.x - m.x, o.z - m.z) < o.r + m.r + 40)) continue;
      this.mesas.push(m);
    }
  }

  distToRavine(x, z) {
    const p = this.ravine.pts;
    let best = 1e9, bt = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const vx = b.x - a.x, vz = b.z - a.z;
      const wx = x - a.x, wz = z - a.z;
      const L = vx * vx + vz * vz;
      let u = (wx * vx + wz * vz) / L; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = wx - vx * u, dz = wz - vz * u;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bt = a.t + (b.t - a.t) * u; }
    }
    return { d: Math.sqrt(best), t: bt };
  }

  lakeDist(x, z) {
    const L = this.lake, c = Math.cos(L.rot), s = Math.sin(L.rot);
    const dx = x - L.x, dz = z - L.z;
    const u = (dx * c - dz * s) / L.rx, v = (dx * s + dz * c) / L.rz;
    return Math.sqrt(u * u + v * v);
  }

  // ------------------------------------------------------------- base height
  /** Analytic height (metres) before erosion. `far` adds the distant ranges. */
  baseHeight(x, z) {
    const n = this.n;
    // Domain warp: bends every later layer so nothing aligns to a grid
    const wx = fbm(n.wa, x * 0.0026, z * 0.0026, 3) * 75;
    const wz = fbm(n.wb, x * 0.0026 + 5.2, z * 0.0026 - 1.3, 3) * 75;
    const px = x + wx, pz = z + wz;

    let h = fbm(n.broad, px * 0.0042, pz * 0.0042, 4) * 15 + 7.5;
    // Ridged mountain chains, masked so they occur in bands rather than everywhere
    const mask = smoothstep(-0.12, 0.42, fbm(n.mask, x * 0.0021 + 3.7, z * 0.0021 - 8.1, 3));
    const rid = ridged(n.ridge, px * 0.0062, pz * 0.0062, 6);
    h += Math.pow(rid, 1.65) * 46 * mask;
    // Mid-frequency hills & fine roughness (more roughness on high ground)
    h += fbm(n.mid, px * 0.017, pz * 0.017, 4) * 3.4;
    h += fbm(n.fine, px * 0.055, pz * 0.055, 3) * (0.5 + mask * 0.8);

    // Hillside shelves: partial terracing produces ledges and short cliff bands
    const shelfMask = smoothstep(0.1, 0.5, fbm(n.shelf, x * 0.004 - 2.2, z * 0.004 + 9.4, 2));
    if (shelfMask > 0) {
      // irregular ledge spacing so the shelves never read as regular contour lines
      const step = 6.0 + fbm(n.shelf, x * 0.011 + 4.0, z * 0.011, 2) * 3.5;
      const t = (h + fbm(n.mid, x * 0.02, z * 0.02, 2) * 2.5) / step, fl = Math.floor(t), f = t - fl;
      const terr = (fl + smoothstep(0.22, 0.78, f)) * step;
      h = lerp(h, terr, shelfMask * 0.5);
    }

    // Mesas: plateau tops with steep, irregular cliff rims and a lower talus step
    for (const m of this.mesas) {
      const dx = x - m.x, dz = z - m.z;
      const d = Math.sqrt(dx * dx + dz * dz) / m.r + fbm(n.mesa, x * 0.02, z * 0.02, 3) * 0.24;
      if (d < 1.6) {
        const top = m.top + fbm(n.mesaTop, x * 0.03, z * 0.03, 2) * 1.6;
        const cliff = 1 - smoothstep(0.9, 1.0, d);
        const talus = (1 - smoothstep(1.0, 1.55, d)) * 0.38;
        const target = Math.max(cliff, talus);
        if (top > h) h = lerp(h, top, target);
      }
    }

    // Boundary wall: the sector is enclosed by a high, ragged mountain ring
    const rr = Math.sqrt(x * x + z * z) + fbm(n.bound, x * 0.006, z * 0.006, 3) * 34;
    const b = smoothstep(228, 335, rr);
    if (b > 0) h += b * b * 92 + b * ridged(n.boundR, x * 0.009, z * 0.009, 4) * 46;
    // Far ranges for the backdrop silhouette
    if (rr > 380) {
      const f = smoothstep(380, 1300, rr);
      h += f * (ridged(n.far, x * 0.0016, z * 0.0016, 5) * 300 + 40) - smoothstep(1600, 2300, rr) * 160;
    }

    // Lake basin: a bowl that drops well below the water line
    const ld = this.lakeDist(x, z) + fbm(n.basin, x * 0.012, z * 0.012, 3) * 0.16;
    if (ld < 1.8) {
      const bowl = ld < 1 ? -this.lake.depth * (1 - ld * ld) : (ld - 1) * 16;
      const w = 1 - smoothstep(1.05, 1.8, ld);
      if (bowl < h) h = lerp(h, bowl, w);
    }

    // Ravine: U-shaped canyon with steep walls, floor descending into the lake
    const rv = this.distToRavine(x, z);
    const W = this.ravine.width * (0.8 + 0.4 * (0.5 + 0.5 * n.rav(rv.t * 6, 0.5)));
    const dd = rv.d + n.rav(x * 0.05, z * 0.05) * 3.2;
    if (dd < W * 3.2) {
      const floor = lerp(12, -3.2, Math.pow(rv.t, 0.8));
      const u = dd / W;
      const wall = u < 0.45 ? u * 0.6 : 0.27 + Math.pow(u - 0.45, 1.6) * 26;
      const carved = floor + wall;
      if (carved < h) h = lerp(h, carved, 1 - smoothstep(2.4, 3.2, u));
    }
    return h;
  }

  // ---------------------------------------------------------------- generate
  async generate(progress) {
    const { res, half, cell } = this;
    const h = this.h;
    // 1. analytic heights
    for (let j = 0; j < res; j++) {
      const z = -half + j * cell;
      for (let i = 0; i < res; i++) h[j * res + i] = this.baseHeight(-half + i * cell, z);
      if ((j & 63) === 0) { progress?.('Folding bedrock', (j / res) * 0.25); await nextFrame(); }
    }
    this.base = h.slice();
    // 2. hydraulic erosion (batched so the loading bar stays alive)
    await this._erode(progress);
    // 3. blend back to analytic at the edge (seam-free with the backdrop)
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x = -half + i * cell, z = -half + j * cell;
      const e = smoothstep(292, 318, Math.max(Math.abs(x), Math.abs(z)));
      if (e > 0) { const k = j * res + i; h[k] = lerp(h[k], this.base[k], e); }
    }
    progress?.('Mapping watersheds', 0.72); await nextFrame();
    this.computeNormals();
    this._computeMoisture();
    progress?.('Tracing occlusion', 0.8); await nextFrame();
    this._computeAO();
  }

  async _erode(progress) {
    const { res } = this;
    const H = this.h, flow = this.flow;
    const rng = makeRng(this.seed, 'erosion');
    // Heights are normalised internally so classic droplet parameters behave.
    const S = 1 / 120;
    for (let k = 0; k < H.length; k++) H[k] *= S;
    const radius = 3;
    const offs = [], wts = [];
    let wsum = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= radius) { offs.push(dx, dy); const w = 1 - d / radius; wts.push(w); wsum += w; }
    }
    for (let i = 0; i < wts.length; i++) wts[i] /= wsum;
    const inertia = 0.06, capF = 4.2, minCap = 0.012, depositS = 0.3, erodeS = 0.32, evap = 0.016, grav = 4, maxLife = 42;
    const droplets = 190000, batch = 19000;
    const lim = res - 2;
    for (let n = 0; n < droplets; n++) {
      let px = 2 + rng.next() * (res - 5), py = 2 + rng.next() * (res - 5);
      // skip droplets far out in the boundary mountains (erosion is faded there anyway)
      const cx = px - res / 2, cy = py - res / 2;
      if (cx * cx + cy * cy > 318 * 318) continue;
      let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
      for (let life = 0; life < maxLife; life++) {
        const xi = px | 0, yi = py | 0;
        const fx = px - xi, fy = py - yi;
        const k = yi * res + xi;
        const h00 = H[k], h10 = H[k + 1], h01 = H[k + res], h11 = H[k + res + 1];
        const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
        const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
        const hOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
        dx = dx * inertia - gx * (1 - inertia);
        dy = dy * inertia - gy * (1 - inertia);
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) break;
        dx /= len; dy /= len;
        px += dx; py += dy;
        if (px < 1 || py < 1 || px >= lim || py >= lim) break;
        flow[k] += water;
        const xj = px | 0, yj = py | 0, gxf = px - xj, gyf = py - yj, kj = yj * res + xj;
        const hNew = H[kj] * (1 - gxf) * (1 - gyf) + H[kj + 1] * gxf * (1 - gyf) + H[kj + res] * (1 - gxf) * gyf + H[kj + res + 1] * gxf * gyf;
        const dh = hNew - hOld;
        const cap = Math.max(-dh * speed * water * capF, minCap);
        if (sed > cap || dh > 0) {
          const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositS;
          sed -= dep;
          H[k] += dep * (1 - fx) * (1 - fy); H[k + 1] += dep * fx * (1 - fy);
          H[k + res] += dep * (1 - fx) * fy; H[k + res + 1] += dep * fx * fy;
        } else {
          const er = Math.min((cap - sed) * erodeS, -dh);
          for (let b = 0, o = 0; b < wts.length; b++, o += 2) {
            const bx = xi + offs[o], by = yi + offs[o + 1];
            if (bx < 0 || by < 0 || bx >= res || by >= res) continue;
            const bk = by * res + bx;
            const amt = Math.min(er * wts[b], H[bk] + 1);
            H[bk] -= amt; sed += amt;
          }
        }
        speed = Math.sqrt(Math.max(0.0001, speed * speed - dh * grav));
        water *= 1 - evap;
      }
      if (n % batch === 0) { progress?.('Weathering ridges', 0.25 + (n / droplets) * 0.45); await nextFrame(); }
    }
    for (let k = 0; k < H.length; k++) H[k] /= S;
    // light smoothing removes single-cell pits left by the droplet brush
    const tmp = H.slice();
    for (let j = 1; j < res - 1; j++) for (let i = 1; i < res - 1; i++) {
      const k = j * res + i;
      const avg = (tmp[k - 1] + tmp[k + 1] + tmp[k - res] + tmp[k + res]) * 0.25;
      H[k] = tmp[k] * 0.6 + avg * 0.4;
    }
  }

  computeNormals() {
    const { res, cell } = this; const H = this.h;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const hl = H[j * res + Math.max(0, i - 1)], hr = H[j * res + Math.min(res - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * res + i], hu = H[Math.min(res - 1, j + 1) * res + i];
      const x = (hl - hr) / (2 * cell), z = (hd - hu) / (2 * cell);
      const inv = 1 / Math.sqrt(x * x + 1 + z * z);
      this.nx[k] = x * inv; this.ny[k] = inv; this.nz[k] = z * inv;
    }
  }

  _computeMoisture() {
    const { res } = this; const F = this.flow, M = this.moist, H = this.h;
    // blur flow a little, then log-normalise
    const t = new Float32Array(F.length);
    for (let j = 1; j < res - 1; j++) for (let i = 1; i < res - 1; i++) {
      const k = j * res + i;
      t[k] = F[k] * 0.4 + (F[k - 1] + F[k + 1] + F[k - res] + F[k + res]) * 0.15;
    }
    for (let k = 0; k < M.length; k++) {
      const f = Math.log(1 + t[k]) / Math.log(1 + 60);
      const nearWater = 1 - smoothstep(0.2, 7, H[k] - this.water);
      M[k] = clamp(Math.max(f, nearWater * 0.85), 0, 1);
    }
  }

  _computeAO() {
    const { res, cell } = this; const H = this.h, A = this.ao;
    const dirs = 8, dists = [1.5, 4, 9, 18, 30];
    const dxs = [], dzs = [];
    for (let d = 0; d < dirs; d++) { const a = (d / dirs) * Math.PI * 2; dxs.push(Math.cos(a)); dzs.push(Math.sin(a)); }
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const k = j * res + i, h0 = H[k];
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        let maxS = 0;
        for (let s = 0; s < dists.length; s++) {
          const dist = dists[s];
          const si = Math.round(i + dxs[d] * dist / cell), sj = Math.round(j + dzs[d] * dist / cell);
          if (si < 0 || sj < 0 || si >= res || sj >= res) break;
          const slope = (H[sj * res + si] - h0) / dist;
          if (slope > maxS) maxS = slope;
        }
        occ += maxS / Math.sqrt(1 + maxS * maxS); // sin of horizon angle
      }
      A[k] = clamp(1 - (occ / dirs) * 1.15, 0.12, 1);
    }
  }

  // --------------------------------------------------------------- stamps
  /** Flatten a circular pad toward a target height (ruins foundations). */
  flattenPad(x, z, radius, target, falloff = 10) {
    const { res, half, cell } = this; const H = this.h;
    const r2 = radius + falloff;
    const i0 = Math.max(0, Math.floor((x - r2 + half) / cell)), i1 = Math.min(res - 1, Math.ceil((x + r2 + half) / cell));
    const j0 = Math.max(0, Math.floor((z - r2 + half) / cell)), j1 = Math.min(res - 1, Math.ceil((z + r2 + half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = -half + i * cell, pz = -half + j * cell;
      const d = Math.hypot(px - x, pz - z);
      const w = 1 - smoothstep(radius, r2, d);
      if (w > 0) { const k = j * res + i; H[k] = lerp(H[k], target, w); }
    }
  }

  /**
   * Carve the cave mouth: a short notch into the hillside down to the tunnel floor.
   * The tunnel itself is a rock shell mesh buried inside the hill (heightfields cannot
   * represent overhangs), with collision handled by World.groundAt.
   */
  carveCave(cave) {
    const { res, half, cell } = this; const H = this.h, A = this.ao;
    const { x, z, dirX, dirZ, width, floorY } = cave;
    const notch = cave.notch ?? 3.5;
    const ext = notch + width * 3 + 10;
    const i0 = Math.max(0, Math.floor((x - ext + half) / cell)), i1 = Math.min(res - 1, Math.ceil((x + ext + half) / cell));
    const j0 = Math.max(0, Math.floor((z - ext + half) / cell)), j1 = Math.min(res - 1, Math.ceil((z + ext + half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = -half + i * cell - x, pz = -half + j * cell - z;
      const along = px * dirX + pz * dirZ;           // 0 at mouth, + into the hill
      const side = Math.abs(-px * dirZ + pz * dirX);
      if (along < -9 || along > notch + 1.5) continue;
      const halfW = width * 0.5 + Math.max(0, -along) * 0.35;
      const wallU = side / halfW;
      if (wallU > 2.2) continue;
      const k = j * res + i;
      const fl = floorY - 0.05;
      const prof = wallU < 1 ? fl + wallU * wallU * 0.3 : fl + 0.3 + (wallU - 1) * 5;
      const endFade = along > notch ? smoothstep(notch, notch + 1.5, along) : 0;
      const frontFade = along < -4 ? smoothstep(-4, -9, along) : 0;
      const target = lerp(prof, H[k], Math.max(endFade, frontFade));
      if (target < H[k]) H[k] = target;
      if (along > -1 && wallU < 1.3) A[k] = Math.min(A[k], 0.45);
    }
    this.stamps.push({ type: 'cave', ...cave });
  }

  /**
   * Long-range terrain shadows from the moon. For every sample we march toward the moon and
   * store the "shadow plane" height S = max(H(t) - t*tan(elevation)): any point at that xz
   * whose height is above S sees the moon. One texture therefore shadows terrain, plants,
   * tree crowns, creatures and water alike, at any distance (mountains cast shadows across
   * whole valleys, far beyond the real-time shadow map).
   */
  bakeSunShadow(sunDir, res = 427) {
    const { half, size } = this; const H = this.h, R = this.res, cell = this.cell;
    const hl = Math.hypot(sunDir.x, sunDir.z);
    const dx = sunDir.x / hl, dz = sunDir.z / hl, tanE = sunDir.y / hl;
    let maxH = -1e9; for (let k = 0; k < H.length; k++) if (H[k] > maxH) maxH = H[k];
    const out = new Float32Array(res * res);
    const st = size / (res - 1);
    const lim = R - 1.001;
    for (let j = 0; j < res; j++) {
      const z = -half + j * st;
      for (let i = 0; i < res; i++) {
        const x = -half + i * st;
        const h0 = this.heightAt(x, z);
        let S = h0 - 8;
        for (let t = 1.5; t < 900; t += 1.5 + t * 0.012) {
          const rayH = h0 + t * tanE;
          if (rayH > maxH + 0.5) break;
          let fx = (x + dx * t + half) / cell, fz = (z + dz * t + half) / cell;
          if (fx < 0 || fz < 0 || fx > lim || fz > lim) break;
          const ii = fx | 0, jj = fz | 0, u = fx - ii, v = fz - jj, k = jj * R + ii;
          const Ht = (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + R] * (1 - u) + H[k + R + 1] * u) * v;
          const s = Ht - t * tanE;
          if (s > S) S = s;
        }
        out[j * res + i] = S;
      }
    }
    const half16 = new Uint16Array(out.length);
    for (let k = 0; k < out.length; k++) half16[k] = THREE.DataUtils.toHalfFloat(out[k]);
    const tex = new THREE.DataTexture(half16, res, res, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    this.sunShadow = { data: out, res, tex };
    return tex;
  }

  /** CPU version of the baked moon visibility (0..1) for gameplay / audio use. */
  sunVisibility(x, y, z) {
    const s = this.sunShadow; if (!s) return 1;
    const f = (x + this.half) / this.size * (s.res - 1), g = (z + this.half) / this.size * (s.res - 1);
    const i = clamp(Math.round(f), 0, s.res - 1), j = clamp(Math.round(g), 0, s.res - 1);
    const S = s.data[j * s.res + i];
    return smoothstep(S - 0.7, S + 0.7, y);
  }

  // ---------------------------------------------------------------- queries
  inBounds(x, z) { return Math.abs(x) < this.half - 1 && Math.abs(z) < this.half - 1; }

  /** Exact height on the rendered L0 triangulation (diagonal from (i+1,j) to (i,j+1)). */
  heightAt(x, z) {
    const { res, half, cell } = this;
    let fx = (x + half) / cell, fz = (z + half) / cell;
    if (fx < 0) fx = 0; else if (fx > res - 1.001) fx = res - 1.001;
    if (fz < 0) fz = 0; else if (fz > res - 1.001) fz = res - 1.001;
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
    const k = j * res + i, H = this.h;
    const a = H[k], b = H[k + 1], c = H[k + res], d = H[k + res + 1];
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  /** Bilinear lookup of any per-sample field. */
  sample(field, x, z) {
    const { res, half, cell } = this;
    let fx = clamp((x + half) / cell, 0, res - 1.001), fz = clamp((z + half) / cell, 0, res - 1.001);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * res + i;
    return (field[k] * (1 - u) + field[k + 1] * u) * (1 - v) + (field[k + res] * (1 - u) + field[k + res + 1] * u) * v;
  }

  normalAt(x, z, out) {
    const e = 0.75;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z), hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    let nx = (hl - hr) / (2 * e), nz = (hd - hu) / (2 * e);
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    out.x = nx * inv; out.y = inv; out.z = nz * inv;
    return out;
  }
  slopeAt(x, z) { return 1 - this.sample(this.ny, x, z); }
  moistAt(x, z) { return this.sample(this.moist, x, z); }
  aoAt(x, z) { return this.sample(this.ao, x, z); }
  /** Lowest terrain height under a disc (for grounding wide objects). */
  minHeightDisc(x, z, r) {
    let m = this.heightAt(x, z);
    for (let a = 0; a < 6; a++) { const t = (a / 6) * Math.PI * 2; m = Math.min(m, this.heightAt(x + Math.cos(t) * r, z + Math.sin(t) * r)); }
    return m;
  }
}
