// Biome flora: species that give each region of the basin its own character.
//   Coral Thicket  - coral trees (branching, polyp-tipped)
//   Violet Wood    - parasol fungi (giant mushrooms with glowing gills)
//   Amber Heights  - spire horns (twisted ridged spikes) and thornbrush
//   Lily Shallows  - lily pads with lantern lilies on the water, kelp below it
// Same conventions as plants.js: GeoBuilder geometry with colour / glow / sway attributes.
import * as THREE from 'three';
import { GeoBuilder, curvePoints, col } from './geo.js';
import { cellRect, FOLIAGE_CELL as CELL } from '../render/foliagegen.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = THREE.MathUtils.lerp;
const STRAP = cellRect(CELL.strap);

// ---------------------------------------------------------------- coral trees
const CORAL = [
  { base: 0x2e1428, mid: 0x7a2f5c, tip: 0xff92d4 }, // rose
  { base: 0x2a1a1c, mid: 0x7a3c2a, tip: 0xffa860 }, // ember
  { base: 0x1c1a34, mid: 0x4a3c86, tip: 0x9fd8ff }, // dusk
];
export function buildCoralTree(rng, detail = true, palette = 0) {
  const b = new GeoBuilder();
  const P = CORAL[palette % CORAL.length];
  const cBase = col(P.base), cMid = col(P.mid), cTip = col(P.tip);
  const H = rng.float(3.2, 5.8);
  b.swayFn = (p) => Math.pow(Math.max(0, p.y) / H, 2) * 0.07;
  const maxL = detail ? 3 : 2;
  const colAt = (u) => (u < 0.5 ? cBase.clone().lerp(cMid, u * 2) : cMid.clone().lerp(cTip, (u - 0.5) * 0.7));
  const branch = (p0, dir, len, r0, level) => {
    const bend = V(rng.float(-0.5, 0.5), 0.45, rng.float(-0.5, 0.5));
    const d1 = dir.clone().addScaledVector(bend, 0.45).normalize();
    const ctrl = [p0, p0.clone().addScaledVector(dir, len * 0.5), p0.clone().addScaledVector(d1, len)];
    const pts = curvePoints(ctrl, detail ? (level < 2 ? 5 : 3) : 2);
    const r1 = r0 * 0.64;
    b.tube(pts, (t) => lerp(r0, r1, t), detail ? (level < 2 ? 6 : 4) : 3, (t) => colAt((level + t) / (maxL + 1)), () => 0,
      detail && level < 2 ? { jitter: (t, a) => 0.08 * Math.sin(a * 5 + t * 9 + level) } : {});
    const end = pts[pts.length - 1];
    const endDir = end.clone().sub(pts[pts.length - 2]).normalize();
    if (level >= maxL) {
      // polyp crown: a luminous knob with a few short feelers
      b.ellipsoid(end, V(r1 * 1.9, r1 * 2.3, r1 * 1.9), 6, 4, cTip, 1.0);
      if (detail) for (let k = 0; k < 3; k++) {
        const a = rng.angle(), fd = V(Math.cos(a), 1.2, Math.sin(a)).normalize();
        b.tube([end.clone(), end.clone().addScaledVector(fd, r1 * 5)], () => r1 * 0.35, 3, () => cTip, () => 0.7);
      }
      return;
    }
    const n = level === 0 ? 3 : rng.int(2, 3);
    const a0 = rng.angle();
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + rng.float(-0.4, 0.4);
      const spread = rng.float(0.45, 0.9);
      const nd = endDir.clone().add(V(Math.cos(a) * spread, 0.15, Math.sin(a) * spread)).normalize();
      branch(end, nd, len * rng.float(0.62, 0.82), r1, level + 1);
    }
  };
  branch(V(0, -0.35, 0), V(0, 1, 0), H * (detail ? 0.36 : 0.42), H * 0.055, 0);
  // basal encrustation
  b.ellipsoid(V(0, -0.05, 0), V(H * 0.12, H * 0.05, H * 0.12), detail ? 10 : 6, 4, cBase, 0, { displace: (nx, ny, nz) => 0.15 * Math.sin(nx * 9) * Math.sin(nz * 7) });
  return { geometry: b.toGeometry(), height: H };
}

// ------------------------------------------------------------ parasol fungi
export function buildParasolFungus(rng, detail = true) {
  const b = new GeoBuilder();
  const H = rng.float(4.5, 8.5), R = H * rng.float(0.36, 0.5);
  b.swayFn = (p) => Math.pow(Math.max(0, p.y) / H, 2) * 0.05;
  const stemA = col(0x4a4560), stemB = col(0x77708e), capA = col(0x2c2342), capB = col(0x4a3a6e), gill = col(0xb08cff), wart = col(0xd8c8ff);
  const lean = V(rng.float(-1, 1), 0, rng.float(-1, 1)).multiplyScalar(H * 0.09);
  const stem = curvePoints([V(0, -0.5, 0), V(lean.x * 0.2, H * 0.35, lean.z * 0.2), V(lean.x * 0.7, H * 0.72, lean.z * 0.7), V(lean.x, H, lean.z)], detail ? 10 : 4);
  const sr = H * 0.05;
  b.tube(stem, (t) => lerp(sr * 1.2, sr * 0.75, t) * (1 + 0.9 * Math.exp(-t * 9)), detail ? 10 : 6, (t) => stemA.clone().lerp(stemB, t), () => 0,
    { jitter: detail ? (t, a) => 0.05 * Math.sin(a * 5 + t * 14) + 0.03 * Math.sin(a * 11 - t * 30) : null });
  // skirt (annulus) hanging from the upper stem
  const rp = stem[Math.floor((stem.length - 1) * 0.74)];
  b.ellipsoid(rp, V(sr * 2.6, sr * 0.9, sr * 2.6), detail ? 12 : 6, 4, stemB, 0, { warpY: (nx, ny) => -Math.pow(1 - Math.abs(ny), 2) * 1.4, displace: (nx, ny, nz) => (ny < 0 ? 0.1 * Math.sin(Math.atan2(nz, nx) * 9) : 0) });
  // cap: broad flattened dome, warty top, luminous radial gills beneath
  const top = stem[stem.length - 1].clone().add(V(0, R * 0.08, 0));
  const warts = (nx, ny, nz) => ny > 0.3 && Math.sin(nx * 21) * Math.sin(nz * 19) > 0.72;
  b.ellipsoid(top, V(R, R * 0.24, R), detail ? 24 : 10, detail ? 8 : 5,
    (nx, ny, nz) => (ny > -0.05 ? (warts(nx, ny, nz) ? wart : capA.clone().lerp(capB, 0.5 + 0.5 * Math.sin(Math.atan2(nz, nx) * 7) * (1 - ny))) : gill.clone().multiplyScalar(0.35 + 0.35 * Math.pow(Math.abs(Math.sin(Math.atan2(nz, nx) * 26)), 2))),
    (nx, ny, nz) => (ny > -0.05 ? (warts(nx, ny, nz) ? 0.35 : 0) : (0.06 + 0.4 * Math.pow(Math.abs(Math.sin(Math.atan2(nz, nx) * 26)), 4)) * Math.min(1, -ny * 2.5)),
    { warpY: (nx, ny) => -Math.pow(1 - Math.abs(ny), 4) * 0.7, displace: (nx, ny, nz) => (ny > 0 ? 0.025 * Math.sin(Math.atan2(nz, nx) * 9) : -0.3 * Math.max(0, -ny)) });
  // companions at the foot
  if (detail) {
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      const a = rng.angle(), d = rng.float(0.7, 1.6), h = rng.float(0.35, 1.2), r = h * 0.45;
      const p0 = V(Math.cos(a) * d, -0.05, Math.sin(a) * d);
      b.tube([p0, p0.clone().add(V(0, h, 0))], (t) => lerp(r * 0.2, r * 0.13, t), 5, (t) => stemA.clone().lerp(stemB, t), () => 0);
      b.ellipsoid(p0.clone().add(V(0, h, 0)), V(r, r * 0.3, r), 10, 5, (nx, ny) => (ny > -0.05 ? capB : gill), (nx, ny) => (ny > -0.05 ? 0 : 0.7), { warpY: (nx, ny) => -Math.pow(1 - Math.abs(ny), 4) * 0.5 });
    }
  }
  return { geometry: b.toGeometry(), height: H, radius: R };
}

// --------------------------------------------------------------- spire horns
export function buildSpireHorns(rng, detail = true) {
  const b = new GeoBuilder();
  const bone = col(0x8a7658), dark = col(0x2e2620), amber = col(0xffb860);
  const n = rng.int(3, 6);
  let Hmax = 0;
  for (let i = 0; i < n; i++) {
    const h = rng.float(1.4, 4.6) * (i === 0 ? 1.25 : 1);
    Hmax = Math.max(Hmax, h);
    const a = rng.angle(), off = i === 0 ? 0 : rng.float(0.35, 1.1);
    const base = V(Math.cos(a) * off, -0.3, Math.sin(a) * off);
    const lean = V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(rng.float(0.1, 0.35) * h);
    const ph = rng.angle(), curl = rng.float(0.05, 0.16) * h;
    const S = detail ? 14 : 6, pts = [];
    for (let k = 0; k <= S; k++) {
      const t = k / S;
      pts.push(V(base.x + lean.x * t * t + Math.sin(t * 4 + ph) * curl * t, base.y + t * h, base.z + lean.z * t * t + Math.cos(t * 4 + ph) * curl * t));
    }
    const r0 = h * 0.085;
    const band = (t) => Math.max(0, Math.sin(t * h * 4.2 + ph) - 0.88) / 0.12;
    b.tube(pts, (t) => r0 * Math.pow(1 - t, 0.85) + 0.006, detail ? 8 : 5,
      (t) => (band(t) > 0.2 ? amber.clone().multiplyScalar(0.8) : bone.clone().lerp(dark, 0.35 + 0.4 * t + 0.15 * Math.sin(t * 30))),
      (t) => band(t) * 0.8 + (t > 0.94 ? 0.6 : 0),
      { jitter: (t, ang) => 0.16 * Math.sin(ang * 4 + t * h * 7 + ph) * (1 - t * 0.5) });
  }
  return { geometry: b.toGeometry(), height: Hmax };
}

// ---------------------------------------------------------------- thornbrush
export function buildThornbrush(rng, detail = true) {
  const b = new GeoBuilder();
  const R = rng.float(0.7, 1.4);
  b.swayFn = (p) => Math.max(0, p.y) * 0.05;
  const twig = col(0x241a17), twig2 = col(0x5a3428), berry = rng.chance(0.6) ? col(0xffa040) : col(0xff6a4a), thorn = col(0xb8a088);
  b.ellipsoid(V(0, R * 0.12, 0), V(R * 0.35, R * 0.2, R * 0.35), 6, 4, twig, 0);
  const n = detail ? rng.int(18, 26) : rng.int(8, 11);
  for (let i = 0; i < n; i++) {
    const a = rng.angle(), el = rng.float(0.35, 1.25), len = R * rng.float(0.7, 1.3);
    const d = V(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    const kink = V(rng.float(-0.3, 0.3), rng.float(-0.1, 0.25), rng.float(-0.3, 0.3));
    const p0 = V(0, R * 0.1, 0);
    const pts = curvePoints([p0, p0.clone().addScaledVector(d, len * 0.5).addScaledVector(kink, len * 0.3), p0.clone().addScaledVector(d.clone().add(kink).normalize(), len)], detail ? 5 : 2);
    b.tube(pts, (t) => lerp(0.032, 0.007, t), 3, (t) => twig.clone().lerp(twig2, t), () => 0);
    if (detail) {
      for (let k = 1; k < pts.length - 1; k++) {
        const td = V(rng.float(-1, 1), rng.float(-0.2, 0.6), rng.float(-1, 1)).normalize();
        b.prism(pts[k], td, 0.09, 0.009, 3, thorn, 0, 0, { tip: 0.07 });
      }
    }
    if (rng.chance(detail ? 0.55 : 0.35)) {
      const tip = pts[pts.length - 1];
      for (let k = 0; k < (detail ? 3 : 1); k++) b.ellipsoid(tip.clone().add(V(rng.float(-0.05, 0.05), rng.float(-0.03, 0.05), rng.float(-0.05, 0.05))), V(0.04, 0.04, 0.04), 5, 3, berry, 0.9);
    }
  }
  return { geometry: b.toGeometry(), height: R * 1.2 };
}

// ---------------------------------------------------- lily pads & lantern lilies
export function buildLilyPads(rng) {
  const b = new GeoBuilder();
  b.swayFn = () => 0.03;
  const padA = col(0x123a2c), padB = col(0x2c6248), vein = col(0x3f8a62), rimGlow = col(0x7dffe4);
  const n = rng.int(4, 9), placed = [];
  for (let i = 0; i < n && placed.length < 9; i++) {
    const r = rng.float(0.25, 0.75);
    let px = 0, pz = 0, ok = false;
    for (let k = 0; k < 12 && !ok; k++) {
      const a = rng.angle(), d = rng.float(0, 1.8);
      px = Math.cos(a) * d; pz = Math.sin(a) * d;
      ok = placed.every((p) => Math.hypot(p.x - px, p.z - pz) > (p.r + r) * 0.92);
    }
    if (!ok) continue;
    placed.push({ x: px, z: pz, r });
    const notch = rng.angle(), y = 0.015 + i * 0.002, seg = 20;
    const c = b.vertex(V(px, y, pz), V(0, 1, 0), padA, 0);
    const ring = [];
    for (let s = 0; s <= seg; s++) {
      const a = notch + 0.32 + (s / seg) * (Math.PI * 2 - 0.64);
      const vv = Math.abs(Math.sin(a * 7 + i)) > 0.92;
      ring.push(b.vertex(V(px + Math.cos(a) * r, y + 0.012, pz + Math.sin(a) * r), V(0, 1, 0), vv ? vein : padB, rng.chance(0.08) ? 0.35 : 0));
    }
    for (let s = 0; s < seg; s++) b.tri(c, ring[s + 1], ring[s]);
    // underside so the pads read from below the surface too
    const cu = b.vertex(V(px, y - 0.004, pz), V(0, -1, 0), padA.clone().multiplyScalar(0.6), 0);
    const ringU = [];
    for (let s = 0; s <= seg; s++) {
      const a = notch + 0.32 + (s / seg) * (Math.PI * 2 - 0.64);
      ringU.push(b.vertex(V(px + Math.cos(a) * r, y + 0.008, pz + Math.sin(a) * r), V(0, -1, 0), padA.clone().multiplyScalar(0.7), 0));
    }
    for (let s = 0; s < seg; s++) b.tri(cu, ringU[s], ringU[s + 1]);
  }
  // lantern lilies: closed luminous buds on short stems
  const nl = rng.int(0, 2);
  for (let i = 0; i < nl; i++) {
    const p = placed[Math.floor(rng.next() * placed.length)] || { x: 0, z: 0, r: 0.3 };
    const x = p.x + rng.float(-0.1, 0.1), z = p.z + rng.float(-0.1, 0.1), h = rng.float(0.25, 0.5);
    const gc = rng.chance(0.5) ? col(0xffc070) : col(0x8fffe6);
    b.tube([V(x, -0.4, z), V(x, h * 0.6, z + 0.02), V(x, h, z)], () => 0.018, 4, () => padA, () => 0);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.ellipsoid(V(x + Math.cos(a) * 0.035, h + 0.08, z + Math.sin(a) * 0.035), V(0.06, 0.12, 0.06), 7, 5, (nx, ny) => gc.clone().multiplyScalar(0.7 + 0.3 * ny), 0.95);
    }
  }
  void rimGlow;
  return { geometry: b.toGeometry(), height: 0.6 };
}

// ---------------------------------------------------------------------- kelp
export function buildKelp(rng) {
  const b = new GeoBuilder();
  const blade = col(0x1d3a2c), tipC = col(0x3f7a56), glowC = col(0x7dffe4);
  b.swayFn = (p) => Math.pow(Math.min(1, Math.max(0, p.y + 0.2) / 3), 2) * 1.1; // float bladders ride the blades
  const n = rng.int(4, 8);
  let Hmax = 0;
  for (let i = 0; i < n; i++) {
    const h = rng.float(1.2, 3.2); Hmax = Math.max(Hmax, h);
    const a = rng.angle(), off = rng.float(0, 0.6), ph = rng.angle();
    const pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(V(Math.cos(a) * off + Math.sin(t * 3 + ph) * 0.18 * t, -0.2 + t * h, Math.sin(a) * off + Math.cos(t * 2.4 + ph) * 0.18 * t)); }
    const side = V(Math.cos(a + 1.4), 0, Math.sin(a + 1.4));
    b.ribbon(pts, (t) => 0.12 + Math.sin(Math.PI * t) * 0.1, side, (t) => blade.clone().lerp(tipC, t), (t) => (t > 0.9 ? 0.25 : 0), { sway: (t) => t * t * 1.1, uvRect: STRAP });
    for (let k = 2; k < 8; k += 2) b.ellipsoid(pts[k], V(0.035, 0.05, 0.035), 5, 3, glowC, 0.7);
  }
  return { geometry: b.toGeometry(), height: Hmax };
}
