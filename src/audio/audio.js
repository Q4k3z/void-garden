// Fully synthesized soundscape (no audio files): layered drone that shifts with the
// region, gusting wind, positional shoreline water, HRTF-panned creature calls,
// biological ticks and bubbles, footsteps per surface, interaction tones, and
// environmental transitions (cave reverb, underwater low-pass).
import * as THREE from 'three';

const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
const MOODS = {
  default: { root: 55.0, filter: 380, chord: [0, 7, 12, 15] },
  basin: { root: 51.9, filter: 320, chord: [0, 7, 10, 14] },
  grove: { root: 58.3, filter: 460, chord: [0, 5, 12, 16] },
  ring: { root: 49.0, filter: 520, chord: [0, 7, 12, 19] },
  cave: { root: 43.7, filter: 260, chord: [0, 3, 7, 12] },
  ravine: { root: 46.2, filter: 300, chord: [0, 5, 10, 15] },
  violetwood: { root: 48.0, filter: 290, chord: [0, 3, 10, 14] },
  coralthicket: { root: 61.7, filter: 520, chord: [0, 4, 11, 16] },
  amberheights: { root: 53.4, filter: 600, chord: [0, 7, 14, 19] },
  ridge: { root: 61.7, filter: 640, chord: [0, 7, 14, 19] },
  wall: { root: 41.2, filter: 280, chord: [0, 7, 12, 17] },
};

export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.volume = 0.8; this._v = new THREE.Vector3(); this.nextBio = 3; this.nextDistant = 25; }

  init(volume = 0.8) {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.volume = volume;
    // master chain: bus -> lowpass (underwater) -> compressor -> master -> out
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 3);
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -18; this.comp.ratio.value = 3;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    this.bus = ctx.createGain();
    this.bus.connect(this.lp); this.lp.connect(this.comp); this.comp.connect(this.master); this.master.connect(ctx.destination);
    // generated impulse response reverb
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(4.2, 2.6);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.35;
    this.reverb.connect(this.wet); this.wet.connect(this.bus);
    this.send = ctx.createGain(); this.send.connect(this.reverb);
    this.noiseBuf = this._noise(4, 'pink');
    this.whiteBuf = this._noise(2, 'white');
    this._drone(); this._wind(); this._water(); this._hum();
    this.ready = true;
  }

  setVolume(v) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2); }
  suspend(on) { if (!this.ctx) return; if (on) this.ctx.suspend(); else this.ctx.resume(); }

  _impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(sec * ctx.sampleRate);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  _noise(sec, kind) {
    const ctx = this.ctx, n = Math.floor(sec * ctx.sampleRate);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') { d[i] = w * 0.5; continue; }
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    return b;
  }
  _loop(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }
  _panner(pos, ref = 4, roll = 1.1) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 400;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  _drone() {
    const ctx = this.ctx;
    this.droneFilter = ctx.createBiquadFilter(); this.droneFilter.type = 'lowpass'; this.droneFilter.frequency.value = 380; this.droneFilter.Q.value = 0.8;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.16;
    this.droneFilter.connect(this.droneGain); this.droneGain.connect(this.bus); this.droneGain.connect(this.send);
    this.droneOsc = [];
    const m = MOODS.default;
    m.chord.forEach((semi, i) => {
      const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : i === 1 ? 'sawtooth' : 'triangle';
      o.frequency.value = m.root * Math.pow(2, semi / 12);
      o.detune.value = (i - 1.5) * 6;
      const g = ctx.createGain(); g.gain.value = i === 0 ? 0.6 : 0.16;
      o.connect(g); g.connect(this.droneFilter); o.start();
      this.droneOsc.push(o);
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(this.droneFilter.frequency); lfo.start();
  }
  setMood(id) {
    if (!this.ready) return;
    const m = MOODS[id] || MOODS.default, t = this.ctx.currentTime;
    m.chord.forEach((semi, i) => this.droneOsc[i]?.frequency.setTargetAtTime(m.root * Math.pow(2, semi / 12), t, 2.5));
    this.droneFilter.frequency.setTargetAtTime(m.filter, t, 3);
    this.swell(0.4);
  }
  swell(amount = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o2.type = 'sawtooth';
    const base = 110 * Math.pow(2, PENTA[Math.floor(Math.random() * 5)] / 12);
    o.frequency.value = base; o2.frequency.value = base * 1.501; o2.detune.value = 7;
    f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(1400, t + 3); f.frequency.linearRampToValueAtTime(300, t + 7);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * amount, t + 2.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 8);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.bus); g.connect(this.send);
    o.start(t); o2.start(t); o.stop(t + 8.2); o2.stop(t + 8.2);
  }

  _wind() {
    const ctx = this.ctx;
    const src = this._loop(this.noiseBuf);
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 420; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0.12;
    src.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.bus);
    const src2 = this._loop(this.whiteBuf);
    this.whistleF = ctx.createBiquadFilter(); this.whistleF.type = 'bandpass'; this.whistleF.frequency.value = 1600; this.whistleF.Q.value = 9;
    this.whistleG = ctx.createGain(); this.whistleG.gain.value = 0;
    src2.connect(this.whistleF); this.whistleF.connect(this.whistleG); this.whistleG.connect(this.bus);
  }
  _water() {
    const ctx = this.ctx;
    const src = this._loop(this.noiseBuf);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 2400;
    this.waterG = ctx.createGain(); this.waterG.gain.value = 0;
    this.waterLFO = ctx.createGain(); this.waterLFO.gain.value = 1;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.22;
    const lg = ctx.createGain(); lg.gain.value = 0.45; lfo.connect(lg); lg.connect(this.waterLFO.gain); lfo.start();
    this.waterPan = this._panner(new THREE.Vector3(0, 0, 0), 5, 1.4);
    src.connect(f); f.connect(f2); f2.connect(this.waterLFO); this.waterLFO.connect(this.waterG); this.waterG.connect(this.waterPan); this.waterPan.connect(this.bus);
  }
  _hum() {
    // positional hum of the Orrery (placed later)
    const ctx = this.ctx;
    this.humPan = this._panner(new THREE.Vector3(0, -999, 0), 3, 1.6);
    this.humG = ctx.createGain(); this.humG.gain.value = 0.06;
    [82.4, 123.6, 164.8].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = i * 3; const g = ctx.createGain(); g.gain.value = 0.5 / (i + 1); o.connect(g); g.connect(this.humG); o.start(); });
    this.humG.connect(this.humPan); this.humPan.connect(this.bus); this.humPan.connect(this.send);
  }
  setHumPosition(v) { if (!this.ready) return; const p = this.humPan; if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; } else p.setPosition(v.x, v.y, v.z); }

  // ---------------------------------------------------------- one-shots
  _voice(pos, ref = 4) {
    const out = this.ctx.createGain();
    if (pos) { const p = this._panner(pos, ref); out.connect(p); p.connect(this.bus); p.connect(this.send); }
    else { out.connect(this.bus); out.connect(this.send); }
    return out;
  }
  creatureCall(kind, pos) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (kind === 'drifter') {
      const out = this._voice(pos, 5);
      const o = ctx.createOscillator(), g = ctx.createGain(), v = ctx.createOscillator(), vg = ctx.createGain();
      o.type = 'sine'; const f0 = 520 + Math.random() * 200;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + 0.5); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + 1.4);
      v.frequency.value = 7; vg.gain.value = 18; v.connect(vg); vg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g); g.connect(out); o.start(t); v.start(t); o.stop(t + 1.7); v.stop(t + 1.7);
    } else if (kind === 'skitter') {
      const out = this._voice(pos, 3);
      for (let i = 0; i < 7; i++) {
        const s = ctx.createBufferSource(); s.buffer = this.whiteBuf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000 + Math.random() * 2500; f.Q.value = 12;
        const g = ctx.createGain(); const st = t + i * 0.055 + Math.random() * 0.02;
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.5, st + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.04);
        s.connect(f); f.connect(g); g.connect(out); s.start(st, Math.random()); s.stop(st + 0.06);
      }
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square';
      o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.02, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
    } else if (kind === 'strider' || kind === 'distant') {
      const out = this._voice(pos, kind === 'distant' ? 60 : 12);
      const o = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      const f0 = (kind === 'distant' ? 70 : 92) + Math.random() * 30, dur = kind === 'distant' ? 5 : 3.6;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.35, t + dur * 0.45); o.frequency.linearRampToValueAtTime(f0 * 0.8, t + dur);
      m.frequency.value = f0 * 0.5; mg.gain.value = f0 * 0.8; m.connect(mg); mg.connect(o.frequency);
      f.type = 'bandpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(900, t + dur * 0.5); f.frequency.linearRampToValueAtTime(300, t + dur); f.Q.value = 3;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === 'distant' ? 0.07 : 0.16, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(out); o.start(t); m.start(t); o.stop(t + dur + 0.1); m.stop(t + dur + 0.1);
    } else if (kind === 'skyray') {
      // airy, falling two-note whistle carried from high above
      const out = this._voice(pos, 30);
      [0, 0.55].forEach((d, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        const f0 = (i ? 880 : 1180) + Math.random() * 120, st = t + d;
        o.type = 'triangle'; o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, st + 0.7);
        f.type = 'lowpass'; f.frequency.value = 2200;
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.05, st + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.8);
        o.connect(f); f.connect(g); g.connect(out); o.start(st); o.stop(st + 0.85);
      });
    } else if (kind === 'grazer') {
      // low nasal bellow with a breathy onset
      const out = this._voice(pos, 10);
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      const f0 = 62 + Math.random() * 18, dur = 1.3;
      o.type = 'sawtooth'; o2.type = 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.35); o.frequency.linearRampToValueAtTime(f0 * 0.9, t + dur);
      o2.frequency.value = f0 * 2.01;
      f.type = 'bandpass'; f.frequency.setValueAtTime(320, t); f.frequency.linearRampToValueAtTime(520, t + 0.4); f.frequency.linearRampToValueAtTime(260, t + dur); f.Q.value = 4;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const g2 = ctx.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(f);
      o.connect(f); f.connect(g); g.connect(out); o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.06, t + 0.05); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      s.connect(nf); nf.connect(ng); ng.connect(out); s.start(t, Math.random()); s.stop(t + 0.55);
    } else if (kind === 'prowler') {
      // rasping, pulsed growl (amplitude-modulated noise through a low resonant filter)
      const out = this._voice(pos, 8);
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 180 + Math.random() * 60; f.Q.value = 6;
      const g = ctx.createGain(), am = ctx.createOscillator(), amg = ctx.createGain(), dur = 1.6;
      am.frequency.value = 24 + Math.random() * 8; amg.gain.value = 0.5; am.connect(amg); amg.connect(g.gain);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); am.start(t); s.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
    }
  }
  footstep(surface, intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = surface === 'water' ? this.whiteBuf : this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = surface === 'water' ? 'bandpass' : 'lowpass';
    f.frequency.value = surface === 'water' ? 1400 + Math.random() * 600 : surface === 'stone' ? 1800 : 650 + Math.random() * 200;
    const g = ctx.createGain();
    const amp = (surface === 'water' ? 0.14 : surface === 'stone' ? 0.1 : 0.12) * intensity;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + (surface === 'water' ? 0.28 : 0.13));
    s.connect(f); f.connect(g); g.connect(this.bus); s.start(t, Math.random() * 1.5); s.stop(t + 0.3);
  }
  footfall(kind, pos) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._voice(pos, 8);
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45);
  }
  land(impact, surface) { this.footstep(surface, Math.min(2.2, impact * 0.25)); }
  chime(pos, kind = 'bloom', pitch = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._voice(pos, 4);
    const notes = kind === 'crystal' ? [0, 7, 12] : kind === 'echo' ? [0, 5, 10, 15] : kind === 'resonance' ? [0, 7, 12, 19, 24] : [0, 3, 7, 12];
    const base = (kind === 'crystal' ? 660 : kind === 'resonance' ? 220 : 440) * Math.pow(2, pitch / 12);
    notes.forEach((n, i) => {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o2.type = 'sine';
      const f = base * Math.pow(2, n / 12);
      o.frequency.value = f; o2.frequency.value = f * (kind === 'crystal' ? 2.76 : 2.0);
      const st = t + i * (kind === 'resonance' ? 0.09 : 0.12);
      const dur = kind === 'crystal' ? 3.2 : 1.8;
      g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.09 / (1 + i * 0.3), st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out);
      o.start(st); o2.start(st); o.stop(st + dur + 0.1); o2.stop(st + dur + 0.1);
    });
  }
  signal(pos) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._voice(pos, 6);
    const pattern = [0, 0.15, 0.3, 0.7, 0.85, 1.4, 1.55, 1.7, 1.85];
    pattern.forEach((dt, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = i % 3 === 2 ? 1320 : 880;
      const st = t + dt; g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.035, st + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.1);
      o.connect(g); g.connect(out); o.start(st); o.stop(st + 0.12);
    });
  }
  _bio(pos) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._voice(pos, 2.5);
    const r = Math.random();
    if (r < 0.4) { // bubbling
      for (let i = 0; i < 5; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
        const st = t + i * 0.07 + Math.random() * 0.05, f = 300 + Math.random() * 500;
        o.frequency.setValueAtTime(f, st); o.frequency.exponentialRampToValueAtTime(f * 2.2, st + 0.06);
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.04, st + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
        o.connect(g); g.connect(out); o.start(st); o.stop(st + 0.1);
      }
    } else if (r < 0.75) { // insect-like trill
      const o = ctx.createOscillator(), am = ctx.createOscillator(), ag = ctx.createGain(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 2600 + Math.random() * 1800; am.frequency.value = 30 + Math.random() * 30;
      ag.gain.value = 0.5; am.connect(ag); ag.connect(g.gain);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.012, t + 0.1); g.gain.linearRampToValueAtTime(0.0, t + 0.9);
      o.connect(g); g.connect(out); o.start(t); am.start(t); o.stop(t + 1); am.stop(t + 1);
    } else { // soft clicks / ticks
      for (let i = 0; i < 3; i++) {
        const s = ctx.createBufferSource(); s.buffer = this.whiteBuf;
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
        const g = ctx.createGain(); const st = t + i * 0.16;
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.06, st + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.03);
        s.connect(f); f.connect(g); g.connect(out); s.start(st, Math.random()); s.stop(st + 0.05);
      }
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, t, camera, state) {
    if (!this.ready) return;
    const ctx = this.ctx, L = ctx.listener, now = ctx.currentTime;
    const p = camera.position;
    const fwd = this._v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, now, 0.02); L.positionY.setTargetAtTime(p.y, now, 0.02); L.positionZ.setTargetAtTime(p.z, now, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, now, 0.02); L.forwardY.setTargetAtTime(fwd.y, now, 0.02); L.forwardZ.setTargetAtTime(fwd.z, now, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
    // wind: louder with altitude, speed and gust fronts
    const alt = THREE.MathUtils.clamp((p.y - 5) / 60, 0, 1);
    const wind = state.wind * (0.6 + alt * 1.2) * (state.inCave ? 0.15 : 1);
    this.windG.gain.setTargetAtTime(0.06 + wind * 0.16 + state.speed * 0.008, now, 0.4);
    this.windF.frequency.setTargetAtTime(300 + wind * 500 + Math.sin(t * 0.3) * 80, now, 0.6);
    this.whistleG.gain.setTargetAtTime(alt * wind * 0.035, now, 0.8);
    this.whistleF.frequency.setTargetAtTime(1400 + Math.sin(t * 0.17) * 500, now, 1);
    // shoreline water
    if (state.shore) {
      const wp = this.waterPan;
      if (wp.positionX) { wp.positionX.setTargetAtTime(state.shore.x, now, 0.3); wp.positionY.setTargetAtTime(state.shore.y, now, 0.3); wp.positionZ.setTargetAtTime(state.shore.z, now, 0.3); }
      else wp.setPosition(state.shore.x, state.shore.y, state.shore.z);
      this.waterG.gain.setTargetAtTime(state.shoreDist < 60 ? 0.22 : 0, now, 0.5);
    }
    // environment transitions
    this.lp.frequency.setTargetAtTime(state.underwater ? 600 : 20000, now, 0.15);
    this.wet.gain.setTargetAtTime(state.inCave ? 0.9 : 0.35, now, 0.6);
    // biological ambience around the listener
    this.nextBio -= dt;
    if (this.nextBio <= 0 && !state.underwater) {
      this.nextBio = 1.5 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 12;
      this._bio(new THREE.Vector3(p.x + Math.cos(a) * d, p.y - 1, p.z + Math.sin(a) * d));
    }
    this.nextDistant -= dt;
    if (this.nextDistant <= 0) {
      this.nextDistant = 25 + Math.random() * 40;
      const a = Math.random() * Math.PI * 2;
      this.creatureCall('distant', new THREE.Vector3(p.x + Math.cos(a) * 180, p.y + 30, p.z + Math.sin(a) * 180));
    }
  }
}
