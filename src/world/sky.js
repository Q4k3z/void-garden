// Sky dome, custom layered height fog (installed into Three's shader chunks), and
// a sky-derived environment map for PBR reflections.
import * as THREE from 'three';
import { U } from '../core/uniforms.js';
import { SKY_VERT, SKY_FRAG, PALETTE } from '../shaders/sky.glsl.js';

const f = (x) => x.toFixed(5);
const v3 = (a) => `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`;

/**
 * Replace Three's fog chunks with exponential height fog: dense in valleys and over the
 * lake, thin on ridges, plus a faint distance haze that layers far mountain ranges.
 * Fog colour brightens toward the moon (in-scattering). Must run before materials compile.
 */
export function installHeightFog(sunDir, opts = {}) {
  const base = opts.base ?? 0.0, fall = opts.falloff ?? 0.042, dist = opts.distance ?? 0.00042;
  const S = sunDir;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + (mvPosition.xyz * mat3(viewMatrix));
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
  {
    vec3 fr = vFogWorld - cameraPosition;
    float fd = length(fr);
    vec3 fdir = fr / max(fd, 1e-3);
    float b = ${f(fall)};
    float camH = max(cameraPosition.y - (${f(base)}), 0.0); // mirrored reflection cameras sit below the water
    float dy = fdir.y;
    float hfog = abs(dy) < 1e-3 ? fd * exp(-b * camH) : exp(-b * camH) * (1.0 - exp(-b * dy * fd)) / (b * dy);
    float amount = fogDensity * hfog + fd * ${f(dist)};
    float fogF = 1.0 - exp(-amount);
    float sunA = pow(max(dot(fdir, ${v3([S.x, S.y, S.z])}), 0.0), 8.0);
    vec3 fc = mix(fogColor, ${v3(PALETTE.sunFog)}, sunA * 0.55);
    fc = mix(fc, ${v3(PALETTE.lowFog)}, (1.0 - smoothstep(-0.05, 0.25, dy)) * 0.3);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogF);
  }
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;
}

export const FOG_COLOR = new THREE.Color().setRGB(...PALETTE.fog, THREE.LinearSRGBColorSpace);

export class Sky {
  constructor(sunDir, planetDir, rng) {
    const ringN = new THREE.Vector3(rng.float(-0.4, 0.4), 1, rng.float(-0.5, 0.5)).normalize();
    // lit from behind and to the side -> a crescent phase
    const perp = new THREE.Vector3().crossVectors(planetDir, new THREE.Vector3(0, 1, 0)).normalize();
    const starLight = perp.multiplyScalar(0.7).addScaledVector(planetDir, 0.62).add(new THREE.Vector3(0, 0.15, 0)).normalize();
    this.uniforms = {
      uSunDir: { value: sunDir.clone() },
      uPlanetDir: { value: planetDir.clone() },
      uRingN: { value: ringN },
      uStarLight: { value: starLight },
      uTime: U.uTime,
      uAurora: { value: 0.18 },
      uMeteor: { value: 0 },
      uDetail: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), this.material);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }

  update(camera) { this.mesh.position.copy(camera.position); }

  /** Pre-filtered environment from the dome (stars excluded) for reflections & ambient specular. */
  makeEnvironment(renderer) {
    const envScene = new THREE.Scene();
    const mat = this.material.clone();
    mat.uniforms = { ...this.uniforms, uDetail: { value: 0 } };
    const m = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
    envScene.add(m);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    pmrem.dispose(); m.geometry.dispose(); mat.dispose();
    return rt.texture;
  }
}
