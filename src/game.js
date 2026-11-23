// Exploration gameplay: focus & interaction (E), the resonance pulse, discovery of
// places / flora / fauna / echoes into the field journal, sympathetic crystal chains,
// and the garden-awakening finale at the Glowing Seed.
import * as THREE from 'three';
import { U } from './core/uniforms.js';
import { allEntries, JOURNAL } from './content.js';

const _f = new THREE.Vector3(), _d = new THREE.Vector3();
const FAUNA_NAMES = { drifter: 'LUMEN DRIFTER', skitter: 'SKITTERER', strider: 'VEIL STRIDER', moth: 'GLOWMOTH', tubes: 'SHY TUBES', skyray: 'SKYRAY', eel: 'GLOW-EEL', grazer: 'MOSSBACK', prowler: 'SHADE PROWLER' };
const PENTA = [0, 2, 4, 7, 9, 12];

export class Game {
  constructor(o) {
    Object.assign(this, o); // world, life, player, hud, audio, atmosphere, camera
    const w = this.world, S = w.sites;
    this.storeKey = 'voidgarden.journal.' + w.seedName;
    this.found = new Set();
    try { JSON.parse(localStorage.getItem(this.storeKey) || '[]').forEach((id) => this.found.add(id)); } catch (e) { /* no storage */ }
    const area = w.vegetation.biomeArea, fs = w.vegetation.floraSpots;
    const placeExists = {
      basin: true, grove: true, ravine: true, ring: !!S.ring, gate: !!S.gate, orrery: !!S.orrery, pylons: !!S.pylons, leviathan: !!S.leviathan, cave: !!S.cave, mesa: w.hf.mesas.length > 0, ridge: !!S.ridge, arch: w.pois.length > 0,
      violetwood: area.fungal > 0.015, coralthicket: area.coral > 0.015, amberheights: area.amber > 0.015,
    };
    const floraExists = (id) => (fs[id] ? fs[id].length > 0 : true);
    const echoIds = new Set(S.echoes.map((e) => 'echo' + e.echo));
    this.entries = allEntries().filter((e) => (e.cat === 'places' ? placeExists[e.id] : e.cat === 'echoes' ? (e.id === 'seed' ? !!S.cave : echoIds.has(e.id)) : e.cat === 'flora' ? floraExists(e.id) : true));
    this.items = [];
    this.buildInteractables();
    this.focus = null;
    this.region = null; this.regionTimer = 0;
    this.pulse = { r: 0, str: 0, cool: 0 };
    this.chain = [];
    this.glowTarget = 1;
    this.awake = false;
    this.lastToast = -9;
    this.onRecord = null;
  }

  buildInteractables() {
    const w = this.world, S = w.sites, V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const f of w.vegetation.flowers) this.items.push({ kind: 'bloom', name: 'LUMEN BLOOM', verb: 'AWAKEN', pos: V(f.x, f.top - 0.5, f.z), radius: 3.4, ref: f });
    for (const c of w.geology.crystals) this.items.push({ kind: 'crystal', name: 'RESONANT CRYSTAL', verb: 'STRIKE', pos: V(c.x, c.y + 1.1 * c.scale, c.z), radius: 3.4 + c.scale, ref: c });
    const R = w.ruins;
    if (R.ring) this.items.push({ kind: 'altar', name: 'LISTENING ALTAR', verb: 'SPEAK', pos: V(S.ring.x, S.ring.y + 1.2, S.ring.z), radius: 4.2 });
    if (R.orrery) this.items.push({ kind: 'orrery', name: 'THE ORRERY', verb: 'ALIGN', pos: R.orrery.centre.clone(), radius: 5.2 });
    if (R.pylons && R.pylons.console) this.items.push({ kind: 'console', name: 'SIGNAL CONSOLE', verb: 'TRANSMIT', pos: R.pylons.console.clone(), radius: 3.2 });
    if (R.leviathan) this.items.push({ kind: 'skull', name: 'LEVIATHAN SKULL', verb: 'EXAMINE', pos: R.leviathan.skull.clone(), radius: 6.5 });
    for (const e of S.echoes) this.items.push({ kind: 'echo', name: 'ECHO STONE', verb: 'LISTEN', pos: V(e.x, e.y + 1.2, e.z), radius: 3.2, echo: e.echo });
    if (R.seed) this.items.push({ kind: 'seed', name: 'THE GLOWING SEED', verb: 'TOUCH', pos: R.seed.pos.clone(), radius: 3.4 });
  }

  // ---------------------------------------------------------------- journal
  record(id, quiet = false) {
    if (this.found.has(id)) return false;
    const e = this.entries.find((x) => x.id === id);
    if (!e) return false;
    this.found.add(id);
    try { localStorage.setItem(this.storeKey, JSON.stringify([...this.found])); } catch (err) { /* ignore */ }
    if (!quiet) {
      const eyebrow = e.cat === 'places' ? 'DISCOVERED' : e.cat === 'fauna' ? 'OBSERVED' : e.cat === 'flora' ? 'CATALOGUED' : 'RECORDED';
      this.hud.toast(eyebrow, e.title.toUpperCase(), 3.2);
      this.audio.chime(null, 'echo', 5);
    }
    this.hud.setRecords(this.recordCount(), this.entries.length);
    this.onRecord?.(id);
    return true;
  }
  recordCount() { let n = 0; for (const e of this.entries) if (this.found.has(e.id)) n++; return n; }
  observe(kind) { this.record(kind); }

  // ------------------------------------------------------------ interaction
  updateFocus() {
    const eye = this.player.eye;
    _f.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best = null, bestS = -1;
    const test = (it, minDot) => {
      _d.subVectors(it.pos, eye);
      const dist = _d.length();
      if (dist > it.radius) return;
      const dot = _d.divideScalar(Math.max(dist, 1e-3)).dot(_f);
      const need = dist < 1.8 ? minDot - 0.25 : minDot;
      if (dot < need) return;
      const s = dot - dist * 0.015;
      if (s > bestS) { bestS = s; best = it; }
    };
    for (const it of this.items) test(it, 0.86);
    for (const o of this.life.observables()) { if (o.hidden) continue; o.name = FAUNA_NAMES[o.kind]; o.verb = 'OBSERVE'; test(o, 0.95); }
    this.focus = best;
    if (best) this.hud.setPrompt(best.verb, best.name); else this.hud.hidePrompt();
  }

  interact() {
    if (this.focus) this.use(this.focus);
    else this.resonate();
  }

  resonate() {
    if (this.pulse.cool > 0) return;
    this.pulse.r = 0; this.pulse.str = 1.15; this.pulse.cool = 2.4;
    U.uPulse.value.set(this.player.pos.x, this.player.pos.y, this.player.pos.z, 0);
    this.life.ctx.pulseFresh = true;
    this.life.ctx.pulseOrigin.copy(this.player.pos);
    this.audio.chime(null, 'resonance', PENTA[Math.floor(Math.random() * PENTA.length)] - 12);
    this.hud.setStatus('RESONANCE DETECTED', 3);
    if (this.time - this.lastToast > 6) { this.hud.toast('RESONANCE', 'THE GARDEN REMEMBERS YOUR TOUCH', 2); this.lastToast = this.time; }
    this.record('mycelium');
  }

  use(it) {
    const w = this.world, R = w.ruins;
    switch (it.kind) {
      case 'bloom': {
        const f = it.ref; f.flare = 1.8; f.awakened = true;
        w.vegetation.setFlowerFlare(f.index, f.flare, 1.6);
        this.audio.chime(it.pos, 'bloom', PENTA[Math.floor(Math.random() * PENTA.length)]);
        this.life.moths.attractTo(f);
        this.record('bloom');
        break;
      }
      case 'crystal': {
        const c = it.ref; c.flare = 1.6; w.geology.setCrystalFlare(c, c.flare);
        this.audio.chime(it.pos, 'crystal', -Math.round(c.scale * 5));
        for (const o of w.geology.crystals) {
          if (o === c) continue;
          const d = Math.hypot(o.x - c.x, o.z - c.z);
          if (d < 24) this.chain.push({ c: o, at: this.time + 0.35 + d * 0.06 });
        }
        this.record('crystal');
        break;
      }
      case 'altar':
        R.ring.active = 1; this.atmosphere.trigger('aurora', 50); this.audio.swell(1.2); this.audio.chime(it.pos, 'resonance', 0);
        this.hud.toast('THE RING LISTENS', 'THE SKY ANSWERS', 3.5); this.record('ring', true);
        break;
      case 'orrery':
        R.orrery.align = 1; this.audio.swell(1); this.audio.chime(it.pos, 'resonance', 5); this.atmosphere.trigger('meteors', 26);
        this.hud.toast('ALIGNMENT', 'THE RINGS COME TO REST', 3.5); this.record('orrery', true);
        break;
      case 'console':
        R.pylons.signal = 4.5; this.audio.signal(it.pos);
        this.hud.toast('TRANSMISSION', 'NO REPLY. THE LIGHT KEEPS BLINKING.', 3.5); this.record('pylons', true);
        break;
      case 'skull':
        this.hud.toast('EXAMINED', 'CRYSTAL GROWS ALONG EVERY FRACTURE', 3.2); this.record('leviathan', true); this.audio.chime(it.pos, 'echo', -5);
        break;
      case 'echo': {
        const e = JOURNAL.echoes[it.echo];
        this.hud.echo(e.text, 7); this.audio.chime(it.pos, 'echo', it.echo);
        this.record(e.id, true); this.hud.setRecords(this.recordCount(), this.entries.length);
        break;
      }
      case 'seed': this.awaken(it); break;
      default:
        if (FAUNA_NAMES[it.kind]) { this.record(it.kind) || this.hud.toast('OBSERVED', FAUNA_NAMES[it.kind], 2); }
    }
  }

  awaken(it) {
    const R = this.world.ruins;
    if (this.awake) { this.resonate(); return; }
    this.awake = true;
    R.seed.awakened = true;
    this.glowTarget = 1.7;
    this.pulse.r = 0; this.pulse.str = 1.6; this.pulse.cool = 6; this.pulse.big = true;
    U.uPulse.value.set(it.pos.x, it.pos.y, it.pos.z, 0);
    for (const f of this.world.vegetation.flowers) { f.awakened = true; f.flare = 1.2; }
    this.atmosphere.trigger('aurora', 70);
    this.audio.swell(1.6); this.audio.chime(it.pos, 'resonance', 0);
    setTimeout(() => this.audio.swell(1.2), 2500);
    this.hud.toast('THE GLOWING SEED', 'THE GARDEN IS AWAKE', 5);
    this.hud.setStatus('ECOSYSTEM AWAKENED', 0);
    this.record('seed', true);
  }

  // ------------------------------------------------------------------ update
  update(dt, t) {
    this.time = t;
    // resonance wave
    const p = this.pulse;
    p.cool = Math.max(0, p.cool - dt);
    if (p.str > 0.001) {
      p.r += dt * (p.big ? 55 : 24);
      p.str = Math.max(0, p.str - dt * (p.big ? 0.16 : 0.26));
      U.uPulse.value.w = p.r; U.uPulseStr.value = p.str;
      if (p.str <= 0) p.big = false;
    } else U.uPulseStr.value = 0;
    // sympathetic crystal chain
    for (let i = this.chain.length - 1; i >= 0; i--) {
      const c = this.chain[i];
      if (t >= c.at) {
        c.c.flare = Math.max(c.c.flare, 1.1); this.world.geology.setCrystalFlare(c.c, c.c.flare);
        this.audio.chime(new THREE.Vector3(c.c.x, c.c.y + 1, c.c.z), 'crystal', -Math.round(c.c.scale * 5) + 7);
        this.chain.splice(i, 1);
      }
    }
    U.uGlow.value += (this.glowTarget - U.uGlow.value) * Math.min(1, dt * 0.5);
    // regions & place discovery
    this.regionTimer -= dt;
    if (this.regionTimer <= 0) {
      this.regionTimer = 0.25;
      const e = this.player.eye;
      const r = this.world.regionAt(e.x, e.z, this.player.pos.y);
      // hysteresis: a new region must hold for 1 s, so walking along a border does not make the
      // region card, the chime and the ambient chord flicker back and forth
      let change = !this.region;
      if (this.region && r.name !== this.region.name) {
        if (this.regionCand !== r.name) { this.regionCand = r.name; this.regionCandT = 0; } else this.regionCandT += 0.25;
        change = this.regionCandT >= 1.0;
      } else this.regionCand = null;
      if (change) {
        this.regionCand = null;
        const first = !this.region;
        this.region = r;
        const isNew = r.id ? this.record(r.id, true) : false;
        if (isNew) { this.hud.region(r.name, 'DISCOVERED'); this.audio.chime(null, 'echo', 5); }
        else if (!first) this.hud.region(r.name, 'ENTERING');
        this.audio.setMood(r.id || 'default');
      }
      // flora discovery by proximity
      if (!this.found.has('tree')) for (const tr of this.world.vegetation.trees) if (Math.hypot(tr.x - e.x, tr.z - e.z) < 10) { this.record('tree'); break; }
      if (!this.found.has('moth')) for (const s of this.life.moths.swarms) if (s.anchor.distanceTo(e) < 5) { this.record('moth'); break; }
      for (const id in this.world.vegetation.floraSpots) {
        if (this.found.has(id)) continue;
        const r = id === 'parasol' ? 9 : id === 'lily' ? 6 : 5;
        for (const p of this.world.vegetation.floraSpots[id]) if (Math.hypot(p.x - e.x, p.z - e.z) < r) { this.record(id); break; }
      }
    }
    this.updateFocus();
  }
}
