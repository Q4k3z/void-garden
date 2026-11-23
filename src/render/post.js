// Post-processing pipeline: HDR scene -> (bloom) -> final composite pass.
// When post is disabled the renderer tone-maps directly (cheapest path).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FINAL_VERT, FINAL_FRAG, SSAO_FRAG } from '../shaders/post.glsl.js';

class FinalPass extends ShaderPass {
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

/** Half-resolution depth-only SSAO into its own target (read by the final pass). */
class SSAOPass extends Pass {
  constructor(camera, samples) {
    super();
    this.camera = camera;
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      vertexShader: FINAL_VERT, fragmentShader: SSAO_FRAG, defines: { SAMPLES: samples },
      uniforms: { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(2, 2) }, uRadius: { value: 1.1 }, uIntensity: { value: 1.7 } },
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(w, h) {
    this.target.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
    this.material.uniforms.uRes.value.set(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProj.value.copy(this.camera.projectionMatrix);
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }
  dispose() { this.target.dispose(); this.material.dispose(); this.quad.dispose(); }
}

const _v = new THREE.Vector3(), _f = new THREE.Vector3();

export class Post {
  constructor(renderer, scene, camera, quality, sunDir) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.q = quality; this.sunDir = sunDir;
    this.enabled = quality.post;
    this.exposure = 1.0;
    this.build();
  }

  build() {
    const { renderer, scene, camera, q } = this;
    this.dispose();
    if (!this.enabled) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = this.exposure;
      return;
    }
    renderer.toneMapping = THREE.NoToneMapping;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa || 0 });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    rt.depthTexture.type = THREE.UnsignedIntType;
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(1); // render targets are sized in drawing-buffer pixels already
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ssao > 0) {
      this.ssao = new SSAOPass(camera, q.ssao);
      this.composer.addPass(this.ssao);
    }
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.55, 0.92);
      this.composer.addPass(this.bloom);
    }
    const samples = q.rays ? q.raySamples || 32 : 0;
    this.final = new FinalPass({
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 },
        uRayAmount: { value: 0.28 }, uExposure: { value: this.exposure }, uTime: { value: 0 }, uUnder: { value: 0 },
        uNear: { value: camera.near }, uFar: { value: camera.far }, uRes: { value: new THREE.Vector2(size.x, size.y) },
        uRayColor: { value: new THREE.Color(0.35, 0.62, 0.66) },
        tAO: { value: null }, uAOStrength: { value: 0.85 },
      },
      defines: this.ssao ? { RAY_SAMPLES: samples, USE_AO: 1 } : { RAY_SAMPLES: samples },
      vertexShader: FINAL_VERT, fragmentShader: FINAL_FRAG,
    });
    // render-target textures cannot go through ShaderPass's uniform cloning: assign afterwards
    if (this.ssao) this.final.uniforms.tAO.value = this.ssao.target.texture;
    this.composer.addPass(this.final);
  }

  setOptions(opts) {
    let rebuild = false;
    for (const k of ['bloom', 'rays']) if (opts[k] !== undefined && opts[k] !== this.q[k]) { this.q[k] = opts[k]; rebuild = true; }
    const want = this.q.bloom || this.q.rays;
    if (want !== this.enabled) { this.enabled = want; rebuild = true; }
    if (rebuild) this.build();
  }

  resize() {
    if (!this.composer) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setPixelRatio(1);
    this.composer.setSize(size.x, size.y);
    this.final.uniforms.uRes.value.set(size.x, size.y);
  }

  render(dt, t, underwater) {
    if (!this.composer) { this.renderer.render(this.scene, this.camera); return; }
    const u = this.final.uniforms;
    u.uTime.value = t;
    u.uUnder.value += ((underwater ? 1 : 0) - u.uUnder.value) * Math.min(1, dt * 6);
    // sun position on screen for the light shafts
    _f.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const facing = _f.dot(this.sunDir);
    _v.copy(this.camera.position).addScaledVector(this.sunDir, 1000).project(this.camera);
    u.uSunUV.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    const onScreen = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(_v.x), Math.abs(_v.y)), 1.0, 1.6);
    u.uSunVis.value = THREE.MathUtils.smoothstep(facing, 0.1, 0.5) * onScreen * (underwater ? 0.2 : 1);
    this.composer.render(dt);
  }

  dispose() {
    if (this.composer) {
      this.composer.renderTarget1.depthTexture?.dispose();
      this.composer.renderTarget2.depthTexture?.dispose();
      this.composer.dispose();
      this.bloom?.dispose();
      this.ssao?.dispose();
      this.composer = null; this.bloom = null; this.final = null; this.ssao = null;
    }
  }

  /** Eye adaptation target (applied smoothly by the caller each frame). */
  setExposure(v) {
    this.exposure = v;
    if (this.final) this.final.uniforms.uExposure.value = v;
    else this.renderer.toneMappingExposure = v;
  }
}
