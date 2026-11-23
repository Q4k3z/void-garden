// Ambient particles (spores, glimmers) in a camera-wrapped volume that hugs the terrain,
// plus the atmospheric event director (aurora surges, meteor showers, spore blooms, gust
// fronts, distant choruses) and the slowly-shifting wind.
import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { makeRng } from '../core/rng.js';
import { NOISE_GLSL, PULSE_GLSL, HEIGHT_GLSL } from '../shaders/common.glsl.js';

const VERT = /* glsl */`
attribute vec4 aSeed;
attribute float aKind;
uniform vec3 uCam; uniform float uTime; uniform vec3 uBox; uniform vec4 uWind; uniform float uScale; uniform float uBloomEvt; uniform float uWaterLevel; uniform float uGlow;
varying vec3 vCol; varying float vAlpha;
${NOISE_GLSL}
${PULSE_GLSL}
${HEIGHT_GLSL}
void main(){
  bool fly = aKind > 0.5;
  vec3 base = aSeed.xyz * uBox;
  float sp = fly ? 0.15 : 1.0;
  vec2 drift = uWind.xy * uTime * (0.25 + aSeed.w * 0.6) * uWind.z * sp;
  drift += vec2(sin(uTime * 0.31 + aSeed.w * 40.0), cos(uTime * 0.27 + aSeed.w * 30.0)) * (fly ? 2.2 : 1.1);
  vec2 rel = mod(base.xz + drift - uCam.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
  vec2 wxz = uCam.xz + rel;
  float g = max(vg_height(wxz), uWaterLevel);
  float hAbove = fly ? 0.35 + aSeed.y * 2.6 : pow(aSeed.y, 1.5) * uBox.y;
  float rise = fly ? 0.0 : uTime * (0.06 + aSeed.w * 0.08) * (1.0 + uBloomEvt * 4.0);
  float y = g + 0.15 + mod(hAbove + rise, uBox.y) + sin(uTime * 0.5 + aSeed.w * 20.0) * 0.3;
  vec3 wp = vec3(wxz.x, y, wxz.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  float edge = 1.0 - smoothstep(uBox.x * 0.34, uBox.x * 0.5, length(rel));
  float blink = fly ? pow(max(0.0, sin(uTime * (0.7 + aSeed.w * 1.4) + aSeed.x * 50.0)), 5.0) : 0.55 + 0.45 * sin(uTime * 1.3 + aSeed.w * 60.0);
  float pls = vg_pulse(wp);
  vAlpha = edge * blink * (1.0 - smoothstep(26.0, 55.0, dist)) * (0.8 + pls * 3.0 + uBloomEvt * 0.9) * uGlow;
  float size = fly ? 0.12 : (0.03 + aSeed.w * 0.05) * (1.0 + uBloomEvt * 0.6);
  gl_PointSize = clamp(size * uScale / max(dist, 0.1), 1.0, 26.0);
  float hue = fract(aSeed.x * 7.13 + aSeed.z * 3.7);
  vCol = hue < 0.72 ? vec3(0.45, 1.0, 0.88) : hue < 0.92 ? vec3(0.72, 0.55, 1.0) : vec3(1.0, 0.75, 0.42);
  if (fly) vCol = vec3(0.7, 1.0, 0.75);
}`;
const FRAG = /* glsl */`
varying vec3 vCol; varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vCol * 1.6, a * vAlpha);
}`;

export class Particles {
  constructor(world, count) {
    const rng = makeRng(world.seed, 'particles');
    const fireflies = Math.round(count * 0.12);
    const n = count + fireflies;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), kind = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed[i * 4] = rng.next(); seed[i * 4 + 1] = rng.next(); seed[i * 4 + 2] = rng.next(); seed[i * 4 + 3] = rng.next();
      kind[i] = i >= count ? 1 : 0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      ...world.heightUniforms,
      uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(80, 14, 80) }, uScale: { value: 600 }, uBloomEvt: { value: 0 },
      uTime: U.uTime, uWind: U.uWind, uPulse: U.uPulse, uPulseStr: U.uPulseStr, uWaterLevel: U.uWaterLevel, uGlow: U.uGlow,
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'particles';
  }
  resize(height, fov) { this.uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)); }
  update(camPos) { this.uniforms.uCam.value.copy(camPos); }
}

/** Director for occasional atmospheric events and the living wind. */
export class Atmosphere {
  constructor(seed, sky, particles) {
    this.rng = makeRng(seed, 'events');
    this.sky = sky; this.particles = particles;
    this.next = this.rng.float(45, 80);
    this.active = null;
    this.windA = this.rng.angle();
    this.listeners = [];
    this.gust = 0;
  }
  on(fn) { this.listeners.push(fn); }
  trigger(name, dur) {
    const D = { aurora: 42, meteors: 24, sporebloom: 30, gust: 16, chorus: 14 };
    this.active = { name, t: 0, dur: dur || D[name] || 20 };
    for (const f of this.listeners) f(name);
  }
  label() {
    if (!this.active) return null;
    return { aurora: 'AURORA SURGE', meteors: 'METEOR SHOWER', sporebloom: 'SPORE BLOOM', gust: 'WIND FRONT', chorus: 'DISTANT CHORUS' }[this.active.name];
  }
  update(dt, t) {
    // wind slowly veers and breathes
    this.windA += Math.sin(t * 0.013) * dt * 0.02;
    let strength = 0.5 + Math.sin(t * 0.07) * 0.12 + Math.sin(t * 0.23) * 0.06;
    let aurora = 0.16, meteor = 0, bloom = 0;
    if (this.active) {
      const a = this.active; a.t += dt;
      const env = Math.min(1, a.t / 6) * Math.min(1, Math.max(0, (a.dur - a.t) / 8));
      if (a.name === 'aurora') aurora += env * 0.95;
      if (a.name === 'meteors') meteor = env;
      if (a.name === 'sporebloom') bloom = env;
      if (a.name === 'gust') strength += env * 0.9;
      if (a.t > a.dur) { this.active = null; this.next = t + this.rng.float(75, 140); }
    } else if (t > this.next) {
      this.trigger(this.rng.pick(['aurora', 'meteors', 'sporebloom', 'gust', 'chorus']));
    }
    U.uWind.value.set(Math.cos(this.windA), Math.sin(this.windA), strength, t * 0.1);
    this.sky.uniforms.uAurora.value += (aurora - this.sky.uniforms.uAurora.value) * Math.min(1, dt);
    this.sky.uniforms.uMeteor.value = meteor;
    this.particles.uniforms.uBloomEvt.value += (bloom - this.particles.uniforms.uBloomEvt.value) * Math.min(1, dt);
  }
}
