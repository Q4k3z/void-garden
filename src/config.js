// Global configuration: world constants, quality presets, persisted user settings, URL params.
import { hashString } from './core/rng.js';

export const WORLD = {
  size: 640,          // heightfield extent in metres (x and z from -320 to +320)
  res: 641,           // heightfield samples per side (1 m spacing)
  chunk: 64,          // terrain chunk size in metres
  playRadius: 262,    // soft limit of explorable area
  hardRadius: 286,    // absolute limit
  waterLevel: 0,
  eyeHeight: 1.65,
  backdropRadius: 2300,
};

export const PRESETS = {
  low: {
    label: 'Low', pixelRatio: 0.85, maxPixelRatio: 1, msaa: 0, shadows: false, shadowSize: 1024, post: false, bloom: false, rays: false,
    raySamples: 0, vegDensity: 0.45, grassGrid: 0, grassCell: 0.8, particles: 1400, bioLights: 2, terrainLod: 0.7, farDetail: 0,
    texSize: 512, ssao: 0, reflections: 0,
  },
  medium: {
    label: 'Medium', pixelRatio: 1, maxPixelRatio: 1, msaa: 0, shadows: true, shadowSize: 1024, post: true, bloom: true, rays: true,
    raySamples: 24, vegDensity: 0.7, grassGrid: 84, grassCell: 0.8, particles: 2400, bioLights: 4, terrainLod: 0.85, farDetail: 1,
    texSize: 1024, ssao: 8, reflections: 0,
  },
  high: {
    label: 'High', pixelRatio: 1, maxPixelRatio: 1.5, msaa: 4, shadows: true, shadowSize: 2048, post: true, bloom: true, rays: true,
    raySamples: 40, vegDensity: 1.0, grassGrid: 116, grassCell: 0.72, particles: 3800, bioLights: 6, terrainLod: 1.0, farDetail: 1,
    texSize: 1024, ssao: 12, reflections: 0.5,
  },
  ultra: {
    label: 'Ultra', pixelRatio: 1.25, maxPixelRatio: 2, msaa: 4, shadows: true, shadowSize: 4096, post: true, bloom: true, rays: true,
    raySamples: 56, vegDensity: 1.25, grassGrid: 144, grassCell: 0.66, particles: 5600, bioLights: 8, terrainLod: 1.25, farDetail: 2,
    texSize: 2048, ssao: 16, reflections: 0.6,
  },
};

const STORE_KEY = 'voidgarden.settings.v1';
const DEFAULT_SETTINGS = {
  quality: 'auto', renderScale: null, adaptive: true, shadows: null, bloom: null, rays: null,
  fov: 72, sensitivity: 1, invertY: false, volume: 0.8,
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { s = {}; }
  return { ...DEFAULT_SETTINGS, ...s };
}
export function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable: settings stay per-session */ }
}

export function readParams() {
  const q = new URLSearchParams(location.search);
  const seedName = (q.get('seed') || 'LYRA-09').toUpperCase().slice(0, 24);
  return {
    seedName,
    seed: hashString(seedName),
    quality: q.get('quality'),
    bench: q.has('bench') ? Number(q.get('bench') || 20) : 0,
    debug: q.has('debug'),
    autostart: q.has('autostart') || q.has('bench'),
    nolock: q.has('nolock'),
  };
}

/** Pick a preset from coarse hardware hints; adaptive resolution refines it at runtime. */
export function autoPreset(renderer) {
  const gl = renderer.getContext();
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  } catch (e) { /* ignore */ }
  const cores = navigator.hardwareConcurrency || 4;
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  if (/intel|uhd|iris|mali|adreno|powervr|apple m1(?! (pro|max))/.test(gpu)) return cores >= 8 ? 'medium' : 'low';
  if (/rtx\s?(40[789]|50[6789])|rx\s?(79|90)|apple m[3-5] max/.test(gpu)) return 'ultra';
  return 'high';
}

export function resolveQuality(settings, params, renderer) {
  const key = params.quality && PRESETS[params.quality] ? params.quality : settings.quality;
  const name = key === 'auto' || !PRESETS[key] ? autoPreset(renderer) : key;
  const p = { ...PRESETS[name], name };
  if (settings.shadows !== null) p.shadows = settings.shadows;
  if (settings.bloom !== null) p.bloom = settings.bloom;
  if (settings.rays !== null) p.rays = settings.rays;
  if (!p.post && (p.bloom || p.rays)) p.post = true;
  return p;
}
