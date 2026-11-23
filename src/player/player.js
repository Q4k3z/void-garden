// First-person explorer: acceleration-based walking, sprint, crouch-sneak, jumping with
// coyote time, slope limits (cliffs cannot be climbed, steep ground slides you down),
// wading and swimming, diving, circle collision, cave tunnel collision, and a natural
// camera (head bob tied to stride, strafe roll, landing dip, sprint FOV kick, idle breath).
import * as THREE from 'three';
import { WORLD } from '../config.js';

const GRAV = 22, JUMP_V = 6.6;
const _g = { ground: 0, ceiling: Infinity, cave: false };
const _g2 = { ground: 0, ceiling: Infinity, cave: false };
const _n = new THREE.Vector3();

export class Player {
  constructor(world, camera, settings) {
    this.world = world; this.hf = world.hf; this.camera = camera; this.settings = settings;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.keys = {};
    this.onGround = true; this.coyote = 0; this.jumpBuf = 0;
    this.crouch = 0; this.swimming = false; this.underwater = false; this.inCave = false;
    this.eyeH = WORLD.eyeHeight;
    this.bob = 0; this.bobAmt = 0; this.dip = 0; this.dipV = 0; this.roll = 0; this.fovKick = 0;
    this.stepAcc = 0; this.noise = 0.3; this.speedNow = 0; this.lastLand = -9;
    this.onStep = null; this.onLand = null; this.onSplash = null;
    this.camera.rotation.order = 'YXZ';
    this.eye = new THREE.Vector3();
    this.frozen = false;
    this.wasIn = false;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, this.hf.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = -0.04;
    this.onGround = true;
    this.updateCamera(0, 0);
  }

  look(dx, dy) {
    const s = this.settings.sensitivity;
    this.yaw -= dx * 0.0022 * s;
    this.pitch -= dy * 0.0019 * s * (this.settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  update(dt, t) {
    const k = this.keys, W = this.hf.water;
    let ix = 0, iz = 0;
    if (!this.frozen) {
      if (k.KeyW || k.ArrowUp) iz -= 1;
      if (k.KeyS || k.ArrowDown) iz += 1;
      if (k.KeyA || k.ArrowLeft) ix -= 1;
      if (k.KeyD || k.ArrowRight) ix += 1;
    }
    const len = Math.hypot(ix, iz); if (len > 0) { ix /= len; iz /= len; }
    const crouching = !!(k.KeyC || k.ControlLeft) && !this.swimming;
    this.crouch += ((crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    const sprint = !!(k.ShiftLeft || k.ShiftRight) && !crouching && iz < 0;
    this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5, _g);
    const ground = _g.ground;
    const depth = W - ground;
    const feetDepth = W - this.pos.y;
    this.swimming = depth > 1.35 && this.pos.y < W - 0.6;
    const wading = feetDepth > 0.15 && !this.swimming;
    let speed = sprint ? 8.4 : crouching ? 2.1 : 4.4;
    if (wading) speed *= THREE.MathUtils.clamp(1 - feetDepth * 0.45, 0.45, 1);
    if (this.swimming) speed = sprint ? 3.6 : 2.6;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (-sin * -iz + cos * ix) * speed, wz = (-cos * -iz - sin * ix) * speed;
    const accel = this.onGround || this.swimming ? 11 : 2.2;
    this.vel.x += (wx - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (wz - this.vel.z) * Math.min(1, dt * accel);

    // slope limits: block motion that climbs a cliff; slide down very steep ground
    let dx = this.vel.x * dt, dz = this.vel.z * dt;
    const stepLen = Math.hypot(dx, dz);
    if (stepLen > 1e-5 && !this.swimming) {
      this.world.groundAt(this.pos.x + dx, this.pos.z + dz, this.pos.y + 0.5, _g2);
      const rise = _g2.ground - Math.max(ground, this.pos.y - 0.05);
      if (rise > stepLen * 1.12 + 0.04 && !_g2.cave) {
        this.hf.normalAt(this.pos.x + dx, this.pos.z + dz, _n);
        const gl = Math.hypot(_n.x, _n.z) || 1; const ux = -_n.x / gl, uz = -_n.z / gl; // uphill direction
        const up = dx * ux + dz * uz;
        if (up > 0) { dx -= ux * up; dz -= uz * up; this.vel.x -= ux * up / dt; this.vel.z -= uz * up / dt; }
      }
    }
    if (this.onGround && !_g.cave && !this.swimming) {
      this.hf.normalAt(this.pos.x, this.pos.z, _n);
      if (_n.y < 0.62) { this.vel.x += _n.x * 9 * dt; this.vel.z += _n.z * 9 * dt; dx += _n.x * 3 * dt; dz += _n.z * 3 * dt; }
    }
    this.pos.x += dx; this.pos.z += dz;

    // collisions with trees, stones, ruins
    this.world.colliders.resolve(this.pos, 0.38);
    // cave walls
    this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5, _g);
    if (_g.cave) {
      const l = _g.local, c = l.c;
      let side = l.side, along = l.along;
      if (Math.abs(side) > _g.halfW) side = Math.sign(side) * _g.halfW;
      if (along > _g.maxAlong) along = _g.maxAlong;
      if (side !== l.side || along !== l.along) {
        this.pos.x = c.x + c.dirX * along - c.dirZ * side;
        this.pos.z = c.z + c.dirZ * along + c.dirX * side;
      }
    }
    // sector boundary
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > WORLD.hardRadius) { this.pos.x *= WORLD.hardRadius / r; this.pos.z *= WORLD.hardRadius / r; }

    // vertical
    this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5, _g);
    const gH = _g.ground;
    this.jumpBuf = k.Space ? 0.12 : Math.max(0, this.jumpBuf - dt);
    if (this.swimming) {
      const diving = !!(k.KeyC || k.ControlLeft);
      const floatY = W - 1.38;
      let targetY = floatY;
      if (diving) targetY = Math.max(gH + 0.2, this.pos.y - 3);
      if (k.Space) targetY = floatY + 0.1;
      this.vel.y += (targetY - this.pos.y) * (diving ? 3 : 4) * dt;
      this.vel.y *= Math.exp(-dt * 2.5);
      this.pos.y += this.vel.y * dt + Math.sin(t * 1.6) * 0.002;
      if (this.pos.y < gH) { this.pos.y = gH; this.vel.y = Math.max(0, this.vel.y); }
      this.onGround = false;
    } else {
      if (this.onGround) this.coyote = 0.12; else this.coyote -= dt;
      if (this.jumpBuf > 0 && this.coyote > 0 && !this.frozen) {
        this.vel.y = JUMP_V * (wading ? 0.7 : 1); this.onGround = false; this.coyote = 0; this.jumpBuf = 0;
      }
      if (!this.onGround) this.vel.y -= GRAV * dt;
      this.pos.y += this.vel.y * dt;
      const ceil = _g.ceiling - (this.eyeH * (1 - this.crouch * 0.38)) - 0.12;
      if (this.pos.y > ceil) { this.pos.y = ceil; if (this.vel.y > 0) this.vel.y = 0; }
      if (this.pos.y <= gH + 0.001) {
        if (!this.onGround) {
          const impact = -this.vel.y;
          if (impact > 3) { this.dipV -= impact * 0.045; this.onLand?.(impact, this.surface()); this.lastLand = t; }
        }
        this.pos.y = gH; this.vel.y = 0; this.onGround = true;
      } else if (this.onGround) {
        // walking downhill: stick to the ground unless the drop is a ledge
        if (this.pos.y - gH < 0.45) this.pos.y = gH; else this.onGround = false;
      }
    }
    this.inCave = _g.cave;

    // perceived noise for creature awareness
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speedNow = hs;
    let noise = hs < 0.3 ? 0.3 : crouching ? 0.42 : sprint ? 1.75 : 1.0;
    if (wading || this.swimming) noise *= 1.25;
    if (t - this.lastLand < 0.6) noise = Math.max(noise, 1.6);
    this.noise += (noise - this.noise) * Math.min(1, dt * 4);

    // footsteps synced with head bob
    if ((this.onGround || wading) && hs > 0.6) {
      const prev = this.bob;
      this.bob += dt * hs * (sprint ? 1.25 : 1.55);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bob / Math.PI)) this.onStep?.(this.surface(), sprint ? 1.2 : crouching ? 0.45 : 0.85);
    }
    this.updateCamera(dt, t, sprint && hs > 4);
  }

  surface() {
    const W = this.hf.water;
    if (this.pos.y < W + 0.05) return 'water';
    if (this.inCave) return 'stone';
    return this.hf.slopeAt(this.pos.x, this.pos.z) > 0.38 ? 'stone' : 'moss';
  }

  updateCamera(dt, t, sprinting = false) {
    const hs = this.speedNow || 0;
    const target = this.onGround && hs > 0.5 ? Math.min(1, hs / 6) : 0;
    this.bobAmt += (target - this.bobAmt) * Math.min(1, dt * 6);
    this.dipV += (-this.dip * 60 - this.dipV * 9) * dt; this.dip += this.dipV * dt;
    const bobY = Math.abs(Math.sin(this.bob)) * 0.055 * this.bobAmt - 0.025 * this.bobAmt;
    const bobX = Math.cos(this.bob) * 0.03 * this.bobAmt;
    const breath = Math.sin(t * 1.3) * 0.008;
    const eyeH = this.eyeH * (1 - this.crouch * 0.38);
    let ey = this.pos.y + eyeH + bobY + breath + this.dip;
    if (this.swimming) ey = this.pos.y + eyeH + Math.sin(t * 1.6) * 0.04;
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    this.eye.set(this.pos.x + rightX * bobX, ey, this.pos.z + rightZ * bobX);
    this.camera.position.copy(this.eye);
    const k = this.keys;
    const strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    this.roll += (-strafe * 0.018 * Math.min(1, hs / 4) - this.roll) * Math.min(1, dt * 5);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll + Math.sin(this.bob * 0.5) * 0.004 * this.bobAmt);
    this.fovKick += ((sprinting ? 6 : 0) - this.fovKick) * Math.min(1, dt * 3);
    const fov = this.settings.fov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.underwater = this.eye.y < this.hf.water - 0.02;
  }
}
