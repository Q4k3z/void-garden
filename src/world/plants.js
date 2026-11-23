// Procedural plant geometry. Each builder returns a merged BufferGeometry with
// colour / glow / sway attributes. Trees are built from a "plan" so the near and
// far LOD share the same silhouette.
import * as THREE from 'three';
import { GeoBuilder, curvePoints, col } from './geo.js';
import { cellRect, FOLIAGE_CELL as CELL } from '../render/foliagegen.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
// leaf-card atlas rectangles
const UV = { fern: cellRect(CELL.fern), broad: cellRect(CELL.broad), petal: cellRect(CELL.petal), strap: cellRect(CELL.strap), cluster: cellRect(CELL.cluster) };

export const PAL = {
  barkDark: col(0x0e1c1c), barkLight: col(0x253c39), barkWarm: col(0x2e2a26),
  capTop: col(0x0f3631), capTop2: col(0x1b3f4a), capViolet: col(0x2a2147),
  cyan: col(0x7dffe4), cyanDeep: col(0x3fe7c4), violet: col(0xb991ff), amber: col(0xffb860), gold: col(0xffd38a),
  leaf: col(0x1c6152), leaf2: col(0x14503f), leaf3: col(0x2b7a64), fernTip: col(0x58e0b8),
  moss: col(0x1f5a46), stem: col(0x174a45), shroomCap: col(0x1d4c58), shroomViolet: col(0x3a2a5e),
  bush: col(0x123f33), bush2: col(0x1d3b48), reed: col(0x1f5a4c),
};

// ------------------------------------------------------------------ trees
export function planLanternTree(rng) {
  const H = rng.float(10, 21);
  const lean = V(rng.float(-1, 1), 0, rng.float(-1, 1)).normalize().multiplyScalar(rng.float(0.4, 2.2));
  const twist = V(rng.float(-1, 1), 0, rng.float(-1, 1)).multiplyScalar(0.9);
  const trunk = [V(0, -1.2, 0), V(twist.x * 0.3, H * 0.22, twist.z * 0.3), V(lean.x * 0.4 - twist.x * 0.4, H * 0.5, lean.z * 0.4 - twist.z * 0.4), V(lean.x * 0.8, H * 0.78, lean.z * 0.8), V(lean.x * 1.05, H, lean.z * 1.05)];
  const curve = new THREE.CatmullRomCurve3(trunk, false, 'centripetal');
  const roots = [];
  const nR = rng.int(5, 7);
  for (let i = 0; i < nR; i++) {
    const a = (i / nR) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const d = V(Math.cos(a), 0, Math.sin(a));
    const start = curve.getPoint(rng.float(0.1, 0.17));
    const reach = rng.float(2.6, 4.6);
    roots.push({ ctrl: [start.clone().addScaledVector(d, 0.2), start.clone().addScaledVector(d, reach * 0.4).setY(start.y * 0.45), start.clone().addScaledVector(d, reach * 0.8).setY(0.35), start.clone().addScaledVector(d, reach).setY(-0.7)], r: rng.float(0.28, 0.45) });
  }
  const caps = [];
  const nB = rng.int(4, 6);
  const baseA = rng.angle();
  for (let i = 0; i < nB; i++) {
    const t0 = rng.float(0.5, 0.86);
    const a = baseA + (i / nB) * Math.PI * 2 + rng.float(-0.4, 0.4);
    const d = V(Math.cos(a), 0, Math.sin(a));
    const base = curve.getPoint(t0);
    const reach = rng.float(3.5, 7) * (1.15 - t0 * 0.4);
    const end = base.clone().addScaledVector(d, reach).add(V(0, rng.float(0.8, 2.6), 0));
    const ctrl = [base, base.clone().addScaledVector(d, reach * 0.3).add(V(0, reach * 0.35, 0)), base.clone().addScaledVector(d, reach * 0.7).add(V(0, reach * 0.42, 0)), end];
    caps.push(makeCapPlan(rng, end, rng.float(1.3, 3.2), ctrl, rng.float(0.2, 0.32)));
  }
  const top = curve.getPoint(1);
  caps.push(makeCapPlan(rng, top.clone().add(V(0, 0.4, 0)), rng.float(2.6, 4.6), null, 0));
  const r = rng.next();
  return { H, curve, roots, caps, hue: r < 0.2 ? 'violet' : r < 0.32 ? 'amber' : 'cyan' };
}

function makeCapPlan(rng, center, R, branch, branchR) {
  const tendrils = [];
  const nT = rng.int(6, 11);
  for (let i = 0; i < nT; i++) {
    const a = (i / nT) * Math.PI * 2 + rng.float(-0.25, 0.25);
    tendrils.push({ a, rr: rng.float(0.55, 0.92), len: rng.float(1.8, 5.8), curl: rng.float(-0.4, 0.4), bulb: rng.float(0.09, 0.16) });
  }
  return { center, R, flat: rng.float(0.42, 0.68), droop: rng.float(0.5, 1.1), branch, branchR, tendrils };
}

/** part: 'body' (trunk, roots, branches, caps) or 'tendrils' (hanging luminous threads). */
export function buildLanternTree(plan, detail, part = 'body') {
  const b = new GeoBuilder();
  const { H } = plan;
  const glowC = plan.hue === 'violet' ? PAL.violet : plan.hue === 'amber' ? PAL.amber : PAL.cyan;
  b.swayFn = (p) => Math.pow(Math.max(0, p.y) / H, 2.4) * 0.22;
  const barkCol = (t) => PAL.barkDark.clone().lerp(PAL.barkLight, 0.25 + 0.5 * Math.abs(Math.sin(t * 9.0)));
  if (part === 'body') {
    const trunkPts = plan.curve.getPoints(detail ? 16 : 6);
    b.tube(trunkPts, (t) => THREE.MathUtils.lerp(1.0, 0.24, Math.pow(t, 0.7)) * (1 + 0.7 * Math.exp(-t * 12)), detail ? 10 : 6, barkCol,
      () => 0, { jitter: detail ? (t, a) => 0.09 * Math.sin(a * 6 + t * 25) + 0.05 * Math.sin(a * 13 - t * 40) : null });
    const nRoots = detail ? plan.roots.length : Math.min(3, plan.roots.length);
    for (let i = 0; i < nRoots; i++) {
      const r = plan.roots[i];
      b.tube(curvePoints(r.ctrl, detail ? 8 : 3), (t) => THREE.MathUtils.lerp(r.r, 0.06, t), detail ? 6 : 4, barkCol, () => 0);
    }
  }
  for (const c of plan.caps) {
    const top = c.R * c.flat;
    if (part === 'body') {
      if (c.branch) b.tube(curvePoints(c.branch, detail ? 8 : 3), (t) => THREE.MathUtils.lerp(c.branchR, 0.1, t), detail ? 6 : 4, barkCol, () => 0);
      // cap: dark leathery top, luminous ribbed gills underneath
      // domed, rim-drooping cap: dark leathery top, softly luminous ribbed gills beneath
      const ribs = 7 + (c.R > 2.5 ? 2 : 0);
      b.ellipsoid(c.center, V(c.R, top, c.R), detail ? 16 : 8, detail ? 8 : 5,
        (nx, ny, nz) => (ny > -0.05 ? PAL.capTop.clone().lerp(PAL.capTop2, 0.5 + 0.5 * Math.sin(Math.atan2(nz, nx) * ribs)).multiplyScalar(0.7 + 0.5 * Math.max(0, ny)) : glowC.clone().multiplyScalar(0.75)),
        (nx, ny, nz) => (ny > -0.05 ? 0 : (0.18 + 0.32 * Math.pow(Math.abs(Math.sin(Math.atan2(nz, nx) * ribs * 1.5)), 3)) * (0.5 + 0.5 * Math.min(1, -ny * 3))),
        { displace: (nx, ny, nz) => (ny > 0 ? Math.sin(Math.atan2(nz, nx) * ribs) * 0.05 : -0.2 * Math.max(0, -ny)), warpY: (nx, ny) => -Math.pow(1 - Math.abs(ny), 3) * c.droop });
    } else {
      for (const t of c.tendrils) {
        const sx = c.center.x + Math.cos(t.a) * c.R * t.rr, sz = c.center.z + Math.sin(t.a) * c.R * t.rr;
        const sy = c.center.y - top * 0.25;
        const pts = [];
        for (let k = 0; k <= 4; k++) {
          const u = k / 4;
          pts.push(V(sx + Math.sin(u * 3 + t.a) * t.curl * u, sy - u * t.len, sz + Math.cos(u * 3 + t.a) * t.curl * u));
        }
        b.tube(pts, (u) => THREE.MathUtils.lerp(0.04, 0.018, u), 3,
          (u) => PAL.stem.clone().lerp(glowC, Math.pow(u, 3)), (u) => 0.08 + Math.pow(u, 4) * 0.9, { sway: (u) => 0.35 + u * 1.5 });
        const saved = b.swayFn; b.swayFn = () => 1.9;
        b.ellipsoid(pts[4], V(t.bulb, t.bulb * 1.3, t.bulb), 5, 3, glowC, 1.0);
        b.swayFn = saved;
      }
    }
  }
  return b.toGeometry();
}

// ------------------------------------------------------------- lumen stalks
export function buildLumenStalk(rng) {
  const b = new GeoBuilder();
  const n = rng.int(3, 5);
  const Hmax = rng.float(1.4, 3.4);
  b.swayFn = (p) => Math.pow(Math.max(0, p.y) / Hmax, 1.6) * 0.65;
  for (let i = 0; i < n; i++) {
    const a = rng.angle(), off = rng.float(0, 0.3);
    const h = Hmax * rng.float(0.55, 1);
    const bend = rng.float(0.2, 0.8);
    const base = V(Math.cos(a) * off, -0.1, Math.sin(a) * off);
    const d = V(Math.cos(a), 0, Math.sin(a));
    const ctrl = [base, base.clone().add(V(0, h * 0.4, 0)).addScaledVector(d, bend * 0.2), base.clone().add(V(0, h * 0.8, 0)).addScaledVector(d, bend * 0.6), base.clone().add(V(0, h, 0)).addScaledVector(d, bend)];
    const pts = curvePoints(ctrl, 6);
    b.tube(pts, (t) => THREE.MathUtils.lerp(0.055, 0.024, t), 4, (t) => PAL.stem.clone().lerp(PAL.leaf3, t * 0.5), () => 0);
    // leaves
    const nl = rng.int(1, 2);
    for (let k = 0; k < nl; k++) {
      const t0 = rng.float(0.2, 0.6);
      const p0 = pts[Math.floor(t0 * (pts.length - 1))];
      const la = rng.angle(), ld = V(Math.cos(la), 0, Math.sin(la));
      const len = rng.float(0.3, 0.6);
      const lp = [p0.clone(), p0.clone().addScaledVector(ld, len * 0.5).add(V(0, len * 0.25, 0)), p0.clone().addScaledVector(ld, len).add(V(0, len * 0.05, 0))];
      b.ribbon(curvePoints(lp, 4), () => 0.24, V(-ld.z, 0, ld.x), () => PAL.leaf.clone(), () => 0, { cup: (t) => Math.sin(Math.PI * t) * 0.03, uvRect: UV.broad });
    }
    // bulb cluster
    const tip = pts[pts.length - 1];
    const gc = rng.chance(0.2) ? PAL.violet : PAL.cyan;
    const nb = rng.int(2, 4);
    for (let k = 0; k < nb; k++) {
      const r = rng.float(0.06, 0.13);
      const o = V(rng.float(-0.12, 0.12), rng.float(-0.04, 0.16), rng.float(-0.12, 0.12));
      b.ellipsoid(tip.clone().add(o), V(r, r * 1.25, r), 9, 6, (nx, ny) => gc.clone().multiplyScalar(0.75 + 0.25 * ny), rng.float(0.55, 0.85));
    }
  }
  return b.toGeometry();
}

// ----------------------------------------------------------- bloom flowers
export function buildBloomFlower(rng, detail = true) {
  const b = new GeoBuilder();
  const H = rng.float(1.5, 2.1);
  b.swayFn = (p) => Math.pow(Math.max(0, p.y) / H, 2) * 0.32;
  const lean = V(rng.float(-0.25, 0.25), 0, rng.float(-0.25, 0.25));
  const ctrl = [V(0, -0.1, 0), V(lean.x * 0.3, H * 0.35, lean.z * 0.3), V(lean.x * 0.9, H * 0.7, lean.z * 0.9), V(lean.x, H, lean.z)];
  const stalk = curvePoints(ctrl, detail ? 10 : 5);
  b.tube(stalk, (t) => THREE.MathUtils.lerp(0.07, 0.04, t), detail ? 6 : 4, () => PAL.stem, () => 0);
  // basal leaves
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.float(-0.3, 0.3); const d = V(Math.cos(a), 0, Math.sin(a));
    const len = rng.float(0.6, 1.0);
    const lp = [V(0, 0.02, 0), d.clone().multiplyScalar(len * 0.4).add(V(0, len * 0.45, 0)), d.clone().multiplyScalar(len).add(V(0, len * 0.15, 0))];
    b.ribbon(curvePoints(lp, detail ? 7 : 3), () => 0.38, V(-d.z, 0, d.x), (t) => PAL.leaf2.clone().lerp(PAL.leaf3, t), (t) => t * 0.05, { cup: (t) => Math.sin(Math.PI * t) * 0.05, uvRect: UV.broad });
  }
  const head = stalk[stalk.length - 1];
  const nP = 7;
  for (let i = 0; i < nP; i++) {
    const a = (i / nP) * Math.PI * 2;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const pp = [head.clone(), head.clone().addScaledVector(d, 0.2).add(V(0, 0.2, 0)), head.clone().addScaledVector(d, 0.5).add(V(0, 0.36, 0)), head.clone().addScaledVector(d, 0.74).add(V(0, 0.26, 0))];
    const c0 = i % 3 === 0 ? PAL.violet : PAL.cyan;
    b.ribbon(curvePoints(pp, detail ? 8 : 4), () => 0.4, V(-d.z, 0, d.x),
      (t) => PAL.cyanDeep.clone().lerp(c0, t), (t) => 0.22 + Math.pow(t, 1.5) * 0.8, { cup: (t) => Math.sin(Math.PI * t) * 0.07, uvRect: UV.petal });
  }
  b.ellipsoid(head.clone().add(V(0, 0.08, 0)), V(0.15, 0.12, 0.15), 10, 6, PAL.gold, 1.0);
  if (detail) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3; const d = V(Math.cos(a), 0, Math.sin(a));
      const sp = [head.clone().add(V(0, 0.1, 0)), head.clone().addScaledVector(d, 0.12).add(V(0, 0.32, 0)), head.clone().addScaledVector(d, 0.2).add(V(0, 0.44, 0))];
      b.tube(curvePoints(sp, 4), () => 0.012, 3, () => PAL.gold, (t) => t * 0.6);
      b.ellipsoid(sp[2], V(0.03, 0.03, 0.03), 5, 3, PAL.amber, 1.0);
    }
  }
  return { geometry: b.toGeometry(), height: H + 0.4 };
}

// ---------------------------------------------------------------- mushrooms
export function buildMushroomCluster(rng, kind) {
  const b = new GeoBuilder();
  b.swayFn = (p) => Math.max(0, p.y) * 0.02;
  const n = kind === 'needle' ? rng.int(5, 11) : kind === 'puff' ? rng.int(4, 9) : rng.int(3, 7);
  for (let i = 0; i < n; i++) {
    const a = rng.angle(), off = rng.float(0, kind === 'needle' ? 0.6 : 0.5) * (i === 0 ? 0 : 1);
    const base = V(Math.cos(a) * off, -0.05, Math.sin(a) * off);
    const violet = rng.chance(0.3);
    const gc = violet ? PAL.violet : PAL.cyan;
    if (kind === 'puff') {
      const r = rng.float(0.1, 0.36) * (i === 0 ? 1.3 : 1);
      b.ellipsoid(base.clone().add(V(0, r * 0.45, 0)), V(r, r * 0.8, r), 10, 6,
        (nx, ny, nz) => ((Math.sin(nx * 23 + i) * Math.sin(nz * 19) * Math.sin(ny * 17)) > 0.35 ? gc : PAL.shroomCap),
        (nx, ny, nz) => ((Math.sin(nx * 23 + i) * Math.sin(nz * 19) * Math.sin(ny * 17)) > 0.35 ? 0.9 : 0.04));
      continue;
    }
    const h = kind === 'needle' ? rng.float(0.8, 2.3) : rng.float(0.25, 1.3);
    const capR = kind === 'needle' ? rng.float(0.06, 0.12) : rng.float(0.16, 0.5) * (0.5 + h * 0.5);
    const lean = V(rng.float(-0.25, 0.25), 0, rng.float(-0.25, 0.25)).multiplyScalar(h);
    const pts = curvePoints([base, base.clone().add(V(lean.x * 0.3, h * 0.5, lean.z * 0.3)), base.clone().add(V(lean.x, h, lean.z))], 4);
    b.tube(pts, (t) => THREE.MathUtils.lerp(capR * 0.28, capR * 0.18, t) + 0.012, 5, (t) => PAL.stem.clone().lerp(PAL.capTop2, t), (t) => (kind === 'needle' ? t * 0.3 : 0.02));
    const top = pts[pts.length - 1];
    const capC = violet ? PAL.shroomViolet : PAL.shroomCap;
    b.ellipsoid(top.clone(), V(capR, capR * (kind === 'needle' ? 1.1 : 0.62), capR), kind === 'needle' ? 7 : 10, kind === 'needle' ? 5 : 6,
      (nx, ny) => (ny > 0.05 ? capC.clone().lerp(gc, Math.max(0, Math.sin(nx * 30) * Math.sin(ny * 25)) * 0.5) : gc),
      (nx, ny) => (ny > 0.05 ? (kind === 'needle' ? 0.5 : 0.12) : 0.95),
      { displace: (nx, ny) => (ny < 0 ? -0.55 * -ny : 0) });
  }
  return b.toGeometry();
}

// -------------------------------------------------------------------- ferns
export function buildFern(rng, detail = true) {
  const b = new GeoBuilder();
  const nF = detail ? rng.int(6, 8) : rng.int(4, 5);
  const L = rng.float(0.8, 1.5);
  b.swayFn = null;
  const tint = rng.float(0, 1);
  for (let i = 0; i < nF; i++) {
    const a = (i / nF) * Math.PI * 2 + rng.float(-0.25, 0.25);
    const d = V(Math.cos(a), 0, Math.sin(a));
    const len = L * rng.float(0.75, 1.1);
    const rise = rng.float(0.5, 0.95);
    const ctrl = [V(0, 0, 0), d.clone().multiplyScalar(len * 0.22).add(V(0, len * 0.55 * rise, 0)), d.clone().multiplyScalar(len * 0.62).add(V(0, len * 0.78 * rise, 0)), d.clone().multiplyScalar(len * 1.0).add(V(0, len * 0.42 * rise, 0)), d.clone().multiplyScalar(len * 1.15).add(V(0, len * 0.05, 0))];
    const pts = curvePoints(ctrl, detail ? 11 : 5);
    const side = V(-d.z, 0.15, d.x).normalize();
    const base = PAL.leaf2.clone().lerp(PAL.leaf, tint);
    // a pinnate frond card: the atlas supplies the leaflets, the ribbon supplies the arch
    b.ribbon(pts, (t) => len * 0.62 * (1 - t * 0.15), side,
      (t) => base.clone().lerp(PAL.fernTip, Math.pow(t, 2.2) * 0.6), (t) => Math.pow(Math.max(0, t - 0.75) / 0.25, 2) * 0.25,
      { sway: (t) => 0.12 + t * 0.6, cup: (t) => Math.sin(Math.PI * t) * 0.04, uvRect: UV.fern });
  }
  if (detail) {
    const nfh = rng.int(1, 2);
    for (let k = 0; k < nfh; k++) {
      const pts = [];
      const r0 = 0.12, h0 = rng.float(0.35, 0.6), ox = rng.float(-0.1, 0.1), oz = rng.float(-0.1, 0.1);
      for (let s = 0; s <= 14; s++) {
        const u = s / 14;
        if (u < 0.5) pts.push(V(ox, (u / 0.5) * h0, oz));
        else { const th = (u - 0.5) * 2 * Math.PI * 1.6; const rr = r0 * (1 - (u - 0.5) * 1.6); pts.push(V(ox + Math.sin(th) * rr, h0 + Math.cos(th) * rr - r0 + r0, oz + (1 - Math.cos(th)) * 0.02)); }
      }
      b.tube(pts, (t) => THREE.MathUtils.lerp(0.03, 0.012, t), 4, (t) => PAL.leaf3.clone().lerp(PAL.fernTip, t), (t) => t * 0.35, { sway: (t) => t * 0.3 });
    }
  }
  return b.toGeometry();
}

// -------------------------------------------------------------------- bushes
export function buildBush(rng, detail = true) {
  const b = new GeoBuilder();
  const R = rng.float(0.7, 1.4);
  b.swayFn = (p) => Math.max(0, p.y) * 0.06;
  const c0 = rng.chance(0.4) ? PAL.bush2 : PAL.bush;
  // a dark woody core so the canopy never reads as hollow
  b.ellipsoid(V(0, R * 0.35, 0), V(R * 0.42, R * 0.32, R * 0.42), 6, 4, c0.clone().multiplyScalar(0.45), 0);
  // leaf-cluster cards spread over a dome, facing outward with random roll
  const n = detail ? rng.int(24, 32) : rng.int(9, 12);
  for (let i = 0; i < n; i++) {
    const a = rng.angle(), el = Math.asin(rng.float(0.08, 1.0));
    const dir = V(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    const c = dir.clone().multiplyScalar(R * rng.float(0.42, 0.9)); c.y = c.y * 0.85 + R * 0.28;
    const s = R * rng.float(0.6, 0.9) * (detail ? 1 : 1.35);
    const roll = rng.angle();
    const t1 = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.95 ? V(1, 0, 0) : UP).normalize();
    const t2 = new THREE.Vector3().crossVectors(dir, t1).normalize();
    const up = t1.clone().multiplyScalar(Math.cos(roll)).addScaledVector(t2, Math.sin(roll));
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    const pts = [c.clone().addScaledVector(up, -s * 0.5), c.clone(), c.clone().addScaledVector(up, s * 0.5)];
    const tint = c0.clone().lerp(PAL.leaf3, rng.float(0, 0.45) + Math.max(0, dir.y) * 0.2).multiplyScalar(rng.float(0.8, 1.15));
    b.ribbon(pts, () => s, side, () => tint, () => 0, { uvRect: UV.cluster, cup: (t) => Math.sin(Math.PI * t) * s * 0.08 });
  }
  if (detail) {
    const nb = rng.int(5, 12);
    const bc = rng.chance(0.55) ? PAL.amber : PAL.cyan;
    for (let i = 0; i < nb; i++) {
      const a = rng.angle(), el = rng.float(0.1, 1.2);
      const p = V(Math.cos(a) * Math.cos(el) * R * 0.9, Math.sin(el) * R * 0.8 + R * 0.3, Math.sin(a) * Math.cos(el) * R * 0.9);
      b.ellipsoid(p, V(0.05, 0.05, 0.05), 5, 3, bc, 1.0);
    }
  }
  return b.toGeometry();
}

// --------------------------------------------------------------------- reeds
export function buildReeds(rng) {
  const b = new GeoBuilder();
  const n = rng.int(8, 15);
  for (let i = 0; i < n; i++) {
    const a = rng.angle(), off = rng.float(0, 0.5);
    const h = rng.float(0.9, 2.3);
    const base = V(Math.cos(a) * off, -0.2, Math.sin(a) * off);
    const lean = V(rng.float(-0.3, 0.3), 0, rng.float(-0.3, 0.3)).multiplyScalar(h);
    const pts = curvePoints([base, base.clone().add(V(lean.x * 0.2, h * 0.5, lean.z * 0.2)), base.clone().add(V(lean.x, h, lean.z))], 6);
    const side = V(Math.cos(a + 1.3), 0, Math.sin(a + 1.3));
    b.ribbon(pts, () => 0.1, side, (t) => PAL.reed.clone().lerp(PAL.fernTip, t * t * 0.7), (t) => (t > 0.88 ? 0.6 : 0.02), { sway: (t) => t * t * 0.9, uvRect: UV.strap });
  }
  return b.toGeometry();
}
