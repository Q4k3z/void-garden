// Seeded gradient noise + fractal helpers used by terrain, placement and geometry.

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
// 12 evenly spread gradient directions -> visually isotropic simplex noise.
const GX = new Float32Array(12), GY = new Float32Array(12);
for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.13; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }

/** Returns simplex2(x, y) in roughly [-1, 1]. */
export function createNoise2D(rng) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }

  return function simplex2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = pm12[ii + perm[jj]]; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = pm12[ii + i1 + perm[jj + j1]]; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = pm12[ii + 1 + perm[jj + 1]]; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
    return 99.2 * n;
  };
}

/** Smooth 3D value noise in [-1, 1] (used for rock / bone displacement). */
export function createNoise3D(rng) {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = rng.next() * 2 - 1;
  const h = (x, y, z) => val[p[p[p[x & 255] + (y & 255)] + (z & 255)]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function value3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const a = h(xi, yi, zi), b = h(xi + 1, yi, zi), c = h(xi, yi + 1, zi), d = h(xi + 1, yi + 1, zi);
    const e = h(xi, yi, zi + 1), f = h(xi + 1, yi, zi + 1), g = h(xi, yi + 1, zi + 1), k = h(xi + 1, yi + 1, zi + 1);
    const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (k - g) * u;
    const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
    return y1 + (y2 - y1) * w;
  };
}

/** Fractal Brownian motion. Result is normalised to roughly [-1, 1]. */
export function fbm(noise, x, y, octaves = 5, lacunarity = 2.02, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp; amp *= gain; freq *= lacunarity;
    // rotate the domain a little each octave to hide lattice alignment
    const nx = x * 0.8 - y * 0.6, ny = x * 0.6 + y * 0.8; x = nx + 7.31; y = ny - 3.17;
  }
  return sum / norm;
}

/**
 * Ridged multifractal (Musgrave). Sharp crests, eroded-looking valleys, and
 * self-weighting so detail accumulates on ridges rather than in the lowlands.
 * Returns roughly [0, 1.2].
 */
export function ridged(noise, x, y, octaves = 6, lacunarity = 2.05, gain = 0.5, offset = 1.0) {
  let sum = 0, freq = 1, amp = 0.5, weight = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = offset - Math.abs(noise(x * freq, y * freq));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2.0));
    sum += n * amp; norm += amp;
    freq *= lacunarity; amp *= gain;
    const nx = x * 0.8 - y * 0.6, ny = x * 0.6 + y * 0.8; x = nx + 3.71; y = ny + 1.93;
  }
  return sum / norm;
}

export function fbm3(noise3, x, y, z, octaves = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * freq, y * freq, z * freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
