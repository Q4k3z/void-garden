// GeoBuilder: accumulates procedural primitives (tubes, ellipsoids, ribbons, prisms...)
// into one BufferGeometry with per-vertex colour, glow and wind-sway weights.
// One geometry per plant/rock/creature variant keeps draw calls low when instanced.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _nm = new THREE.Matrix3();

export class GeoBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.glow = []; this.sway = []; this.uv = []; this.idx = [];
    this.matrix = new THREE.Matrix4();
    this.normalMatrix = new THREE.Matrix3();
    this.swayFn = null; // (localPos:Vector3) => weight, evaluated on transformed positions
  }
  setMatrix(m) { this.matrix.copy(m); this.normalMatrix.getNormalMatrix(m); return this; }
  resetMatrix() { this.matrix.identity(); this.normalMatrix.identity(); return this; }
  get count() { return this.pos.length / 3; }

  /** uv addresses the foliage atlas; the default points into its solid (neutral) cell. */
  vertex(p, n, c, glow = 0, sway = null, u = 0.125, v = 0.25) {
    _v.copy(p).applyMatrix4(this.matrix);
    _n.copy(n).applyMatrix3(this.normalMatrix).normalize();
    this.pos.push(_v.x, _v.y, _v.z);
    this.nor.push(_n.x, _n.y, _n.z);
    this.col.push(c.r, c.g, c.b);
    this.glow.push(glow);
    this.sway.push(sway !== null ? sway : this.swayFn ? this.swayFn(_v) : 0);
    this.uv.push(u, v);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /**
   * Tube along a polyline with parallel-transport frames.
   * radius(t), color(t) -> THREE.Color, glow(t), optional sway(t).
   */
  tube(points, radius, segs, color, glow = () => 0, opts = {}) {
    const n = points.length;
    const ringStart = [];
    let prevNormal = null;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = points[i];
      _t.copy(points[Math.min(n - 1, i + 1)]).sub(points[Math.max(0, i - 1)]).normalize();
      let nrm;
      if (!prevNormal) {
        nrm = Math.abs(_t.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(_t).normalize() : new THREE.Vector3(1, 0, 0).cross(_t).normalize();
      } else {
        nrm = prevNormal.clone().sub(_t.clone().multiplyScalar(prevNormal.dot(_t))).normalize();
      }
      prevNormal = nrm;
      const bin = new THREE.Vector3().crossVectors(_t, nrm).normalize();
      const r = radius(t);
      const c = color(t);
      const g = glow(t);
      const s = opts.sway ? opts.sway(t) : null;
      ringStart.push(this.count);
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const dir = new THREE.Vector3().addScaledVector(nrm, ca).addScaledVector(bin, sa);
        const jitter = opts.jitter ? 1 + opts.jitter(t, a) : 1;
        this.vertex(new THREE.Vector3().copy(p).addScaledVector(dir, r * jitter), dir, c, g, s);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < segs; k++) {
      const a = ringStart[i] + k, b = ringStart[i + 1] + k;
      this.quad(a, a + 1, b + 1, b);
    }
    if (opts.capEnd) {
      const p = points[n - 1];
      _t.copy(points[n - 1]).sub(points[n - 2]).normalize();
      const tip = this.vertex(new THREE.Vector3().copy(p).addScaledVector(_t, radius(1) * 0.8), _t.clone(), color(1), glow(1), opts.sway ? opts.sway(1) : null);
      const rs = ringStart[n - 1];
      for (let k = 0; k < segs; k++) this.tri(rs + k, rs + k + 1, tip);
    }
    return this;
  }

  /** Ellipsoid with optional surface displacement and per-vertex colour/glow functions. */
  ellipsoid(center, radii, wSegs, hSegs, color, glow = 0, opts = {}) {
    const start = this.count;
    const rot = opts.rotation || null;
    for (let j = 0; j <= hSegs; j++) {
      const v = j / hSegs, th = v * Math.PI;
      if (opts.thetaMax && th > opts.thetaMax + 1e-6) break;
      for (let i = 0; i <= wSegs; i++) {
        const u = i / wSegs, ph = u * Math.PI * 2;
        const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        const disp = opts.displace ? 1 + opts.displace(nx, ny, nz) : 1;
        const p = new THREE.Vector3(nx * radii.x * disp, ny * radii.y * disp, nz * radii.z * disp);
        if (opts.warpY) p.y += opts.warpY(nx, ny, nz) * radii.y;
        const n = new THREE.Vector3(nx / radii.x, ny / radii.y, nz / radii.z).normalize();
        if (rot) { p.applyQuaternion(rot); n.applyQuaternion(rot); }
        p.add(center);
        const c = typeof color === 'function' ? color(nx, ny, nz) : color;
        const g = typeof glow === 'function' ? glow(nx, ny, nz) : glow;
        this.vertex(p, n, c, g);
      }
    }
    const rows = Math.floor((this.count - start) / (wSegs + 1));
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < wSegs; i++) {
      const a = start + j * (wSegs + 1) + i, b = a + wSegs + 1;
      this.quad(a, a + 1, b + 1, b);
    }
    return this;
  }

  /** Two-sided ribbon along a path. width(t), normal hint = side vector direction. */
  ribbon(points, width, side, color, glow = () => 0, opts = {}) {
    const n = points.length;
    const front = [], back = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      _t.copy(points[Math.min(n - 1, i + 1)]).sub(points[Math.max(0, i - 1)]).normalize();
      const sd = typeof side === 'function' ? side(t) : side;
      const nrm = new THREE.Vector3().crossVectors(sd, _t).normalize();
      const w = width(t) * 0.5;
      const c = color(t), g = glow(t), s = opts.sway ? opts.sway(t) : null;
      const cup = opts.cup ? opts.cup(t) : 0;
      const pl = points[i].clone().addScaledVector(sd, -w).addScaledVector(nrm, cup);
      const pr = points[i].clone().addScaledVector(sd, w).addScaledVector(nrm, cup);
      // optional atlas mapping: u across the ribbon, v along it
      const R = opts.uvRect;
      const ul = R ? R[0] : 0.125, ur = R ? R[2] : 0.125, vv = R ? R[1] + (R[3] - R[1]) * t : 0.25;
      front.push(this.vertex(pl, nrm, c, g, s, ul, vv), this.vertex(pr, nrm, c, g, s, ur, vv));
      const nb = nrm.clone().negate();
      back.push(this.vertex(pl, nb, c, g, s, ul, vv), this.vertex(pr, nb, c, g, s, ur, vv));
    }
    for (let i = 0; i < n - 1; i++) {
      const a = front[i * 2], b = front[i * 2 + 1], c = front[i * 2 + 3], d = front[i * 2 + 2];
      this.quad(a, b, c, d);
      const e = back[i * 2], f = back[i * 2 + 1], g2 = back[i * 2 + 3], h = back[i * 2 + 2];
      this.quad(e, h, g2, f);
    }
    return this;
  }

  /** Prism (n-gon) from base point along dir; optional pointed tip (crystals, columns). */
  prism(base, dir, length, radius, sides, color, glowBase, glowTip, opts = {}) {
    const d = dir.clone().normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const tipLen = opts.tip ?? 0;
    const bodyLen = length - tipLen;
    const taper = opts.taper ?? 1;
    const rot = opts.twist ?? 0;
    const ringA = [], ringB = [];
    const flatTop = tipLen <= 0;
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2 + rot;
      const ln = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(_q);
      const p0 = new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius).applyQuaternion(_q).add(base);
      const p1 = new THREE.Vector3(Math.cos(a) * radius * taper, bodyLen, Math.sin(a) * radius * taper).applyQuaternion(_q).add(base);
      ringA.push(this.vertex(p0, ln, color, glowBase));
      ringB.push(this.vertex(p1, ln, color, glowTip * 0.8));
    }
    for (let k = 0; k < sides; k++) this.quad(ringA[k], ringB[k], ringB[k + 1], ringA[k + 1]);
    const top = base.clone().addScaledVector(d, length);
    if (flatTop) {
      const c = this.vertex(top, d, color, glowTip);
      const ring = [];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2 + rot;
        const p1 = new THREE.Vector3(Math.cos(a) * radius * taper, bodyLen, Math.sin(a) * radius * taper).applyQuaternion(_q).add(base);
        ring.push(this.vertex(p1, d, color, glowTip * 0.9));
      }
      for (let k = 0; k < sides; k++) this.tri(ring[k], c, ring[k + 1]);
    } else {
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2 + rot, a1 = ((k + 1) / sides) * Math.PI * 2 + rot;
        const p0 = new THREE.Vector3(Math.cos(a0) * radius * taper, bodyLen, Math.sin(a0) * radius * taper).applyQuaternion(_q).add(base);
        const p1 = new THREE.Vector3(Math.cos(a1) * radius * taper, bodyLen, Math.sin(a1) * radius * taper).applyQuaternion(_q).add(base);
        const fn = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(top, p0)).normalize().negate();
        if (fn.dot(new THREE.Vector3().subVectors(p0, base)) < 0) fn.negate();
        const a = this.vertex(p0, fn, color, glowTip * 0.8), b = this.vertex(p1, fn, color, glowTip * 0.8), c = this.vertex(top, fn, color, glowTip);
        this.tri(a, c, b);
      }
    }
    return this;
  }

  /** Append an existing geometry (position/normal) with flat colour & glow. */
  addGeometry(geo, color, glow = 0) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const start = this.count;
    for (let i = 0; i < p.count; i++) {
      this.vertex(_v.fromBufferAttribute(p, i).clone(), _b.fromBufferAttribute(n, i).clone(), typeof color === 'function' ? color(i) : color, glow);
    }
    if (geo.index) { const ix = geo.index.array; for (let i = 0; i < ix.length; i++) this.idx.push(start + ix[i]); }
    else for (let i = 0; i < p.count; i++) this.idx.push(start + i);
    return this;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('aFolUv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.count > 65535) g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    else g.setIndex(new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Helper: Catmull-Rom sampled polyline through control points. */
export function curvePoints(ctrl, samples) {
  const c = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  return c.getPoints(samples);
}

export const col = (hex) => new THREE.Color(hex);
export function jitterColor(c, rng, amt = 0.06) {
  const o = c.clone();
  o.offsetHSL((rng.next() - 0.5) * amt * 0.5, (rng.next() - 0.5) * amt, (rng.next() - 0.5) * amt);
  return o;
}
