// VOID GARDEN — bootstrap, main loop, input, menus, adaptive quality, benchmark.
import * as THREE from 'three';
import { WORLD, PRESETS, loadSettings, saveSettings, readParams, resolveQuality } from './config.js';
import { makeRng } from './core/rng.js';
import { U } from './core/uniforms.js';
import { World } from './world/world.js';
import { Sky, installHeightFog, FOG_COLOR } from './world/sky.js';
import { Particles, Atmosphere } from './world/atmosphere.js';
import { Lighting } from './render/lights.js';
import { Post } from './render/post.js';
import { Life } from './life/creatures.js';
import { Player } from './player/player.js';
import { AudioEngine } from './audio/audio.js';
import { Game } from './game.js';
import { HUD, renderJournal } from './ui/hud.js';
import { generateSurfaceTextures } from './render/texgen.js';
import { generateFoliageAtlas } from './render/foliagegen.js';
import { REFLECT_LAYER } from './world/water.js';

const $ = (id) => document.getElementById(id);
import { yieldUI as nextFrame } from './core/yield.js';

function fatal(msg) {
  const el = $('fatal'); el.classList.remove('hidden');
  el.innerHTML = `VOID GARDEN COULD NOT START<br><span style="color:#9ab7b5">${msg}</span>`;
  console.error(msg);
}
window.addEventListener('error', (e) => { if (!window.__vgStarted) fatal(e.message || String(e)); });
window.addEventListener('unhandledrejection', (e) => { if (!window.__vgStarted) fatal(e.reason?.message || String(e.reason)); });

async function boot() {
  const params = readParams();
  const settings = loadSettings();
  $('load-seed').textContent = params.seedName;

  // ------------------------------------------------------------- renderer
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) { fatal('WebGL 2 is required. ' + e.message); return; }
  if (!renderer.capabilities.isWebGL2) { fatal('WebGL 2 is required.'); return; }
  const quality = resolveQuality(settings, params, renderer);
  if (quality.name === 'medium') quality.msaa = 2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  const basePR = () => Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio) * (settings.renderScale || quality.pixelRatio);
  let dynScale = 1;
  renderer.setPixelRatio(basePR());
  renderer.setSize(innerWidth, innerHeight);
  renderer.domElement.tabIndex = 0;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.15, 2600);
  scene.add(camera);

  // ------------------------------------------------------------ generation
  const bar = $('load-bar'), step = $('load-step');
  const progress = (label, f) => { step.textContent = label; bar.style.width = `${Math.round(f * 100)}%`; };
  const t0 = performance.now();
  progress('Weaving surfaces', 0.01); await nextFrame();
  const surf = generateSurfaceTextures(renderer, quality.texSize);
  U.tRockA.value = surf.rockA; U.tRockN.value = surf.rockN;
  U.tGroundA.value = surf.groundA; U.tGroundN.value = surf.groundN;
  U.tSandA.value = surf.sandA; U.tSandN.value = surf.sandN;
  const fol = generateFoliageAtlas(renderer, quality.name === 'low' ? 256 : 512);
  U.tFolA.value = fol.folA; U.tFolN.value = fol.folN; U.uFolSize.value.copy(fol.size);
  const world = new World(params.seed, params.seedName, quality, scene);
  await world.generate(progress, renderer);
  const genMs = performance.now() - t0;

  const sp = world.sites.spawn;
  const sunDir = world.sunDir, planetDir = world.planetDir;

  progress('Mixing the atmosphere', 0.95); await nextFrame();
  installHeightFog(sunDir, { base: 0, falloff: 0.05, distance: 0.00034 });
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0068);
  const sky = new Sky(sunDir, planetDir, makeRng(params.seed, 'sky'));
  scene.add(sky.mesh);
  scene.environment = sky.makeEnvironment(renderer);
  scene.background = null;
  const lighting = new Lighting(scene, quality, sunDir);
  const particles = new Particles(world, quality.particles);
  scene.add(particles.points);
  const atmosphere = new Atmosphere(params.seed, sky, particles);
  progress('Waking fauna', 0.97); await nextFrame();
  const life = new Life(world);
  scene.add(life.group);

  const player = new Player(world, camera, settings);
  player.spawn(sp.x, sp.z, sp.yaw);
  const audio = new AudioEngine();
  const hud = new HUD();
  hud.setSector(params.seedName);
  const game = new Game({ world, life, player, hud, audio, atmosphere, camera });
  hud.setRecords(game.recordCount(), game.entries.length);
  const post = new Post(renderer, scene, camera, quality, sunDir);
  particles.resize(renderer.domElement.height, camera.fov);

  // what the lake mirrors (planar reflection renders only this layer)
  // (kept lean: the mirror pass re-renders this set, so thin/small parts are left out)
  const reflectable = [world.terrain.group, sky.mesh, world.ruins.group, world.vegetation.flowerMesh];
  for (const d of life.drifters) reflectable.push(d.bell);
  for (const s of life.striders) reflectable.push(s.body, s.head, ...s.legs.flatMap((L) => [L.up, L.lo]));
  reflectable.push(life.skyrays.mesh, life.grazers.body, life.grazers.neck, life.grazers.head, life.grazers.legs);
  for (const L of world.vegetation.layers) if (/^lanternTree/.test(L.name)) reflectable.push(L.group);
  for (const c of world.geology.group.children) if (!c.name.startsWith('scatter:')) reflectable.push(c); // crystals, basalt, arches
  for (const o of reflectable) o.traverse((c) => c.layers.enable(REFLECT_LAYER));
  // lights are layer-filtered too: keep the light set identical so programs are shared
  for (const l of [lighting.hemi, lighting.moon, ...lighting.pool.map((p) => p.light)]) l.layers.enable(REFLECT_LAYER);

  // warm up shaders + shadow maps behind the loading screen
  progress('Compiling shaders', 0.985); await nextFrame();
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch (e) { console.warn('precompile', e); }
  lighting.update(0, camera.position, world.glowSpots);
  world.update(0, 0, camera.position);
  /**
   * Warm-up through the real pipeline (offscreen targets, shadow pass, lake mirror): one frame
   * with every object visible and unculled, instanced meshes drawn once. `compile()` alone builds
   * programs for the default framebuffer, so objects that were off-screen at load used to compile
   * their real program the first time they came into view, a 50–150 ms stall that made the
   * camera jump.
   */
  const warmUpShaders = () => {
    const saved = [];
    scene.traverse((o) => {
      saved.push(o, o.visible, o.frustumCulled, o.isInstancedMesh ? o.count : -1);
      o.visible = true; o.frustumCulled = false;
      if (o.isInstancedMesh) o.count = Math.min(o.count, 1);
    });
    try { post.render(0.016, 0, false); } finally {
      for (let i = 0; i < saved.length; i += 4) { const o = saved[i]; o.visible = saved[i + 1]; o.frustumCulled = saved[i + 2]; if (saved[i + 3] >= 0) o.count = saved[i + 3]; }
    }
  };
  let warmed = false;
  if (renderer.domElement.width > 0 && renderer.domElement.height > 0) { // skip while the tab is hidden / zero-sized
    warmUpShaders(); warmed = true;
    world.update(0, 0, camera.position);
    post.render(0.016, 0, false);
    await nextFrame();
    post.render(0.016, 0, false);
  }
  progress('Ready', 1);
  window.__vgStarted = true;

  // ---------------------------------------------------------------- state
  let running = false, paused = true, locked = false, dragLook = params.nolock, lookSettle = 0;
  let elapsed = 0, perfOn = params.debug;
  if (perfOn) hud.togglePerf();
  const intro = $('intro'), pause = $('pause'), journal = $('journal'), settingsEl = $('settings');
  $('loading').classList.add('done');
  setTimeout(() => $('loading').classList.add('hidden'), 1000);
  $('intro-quality').value = params.quality || settings.quality;
  $('intro-seed').value = params.seedName;

  const relaunch = (seedName, q) => {
    const u = new URL(location.href);
    u.searchParams.set('seed', seedName);
    if (q && q !== 'auto') u.searchParams.set('quality', q); else u.searchParams.delete('quality');
    u.searchParams.set('autostart', '1');
    location.href = u.toString();
  };
  // Pointer lock. Raw (unadjusted) movement where supported: it avoids OS acceleration and the
  // spurious large deltas Chrome on Windows can report under pointer lock. A refused request
  // (no user gesture, e.g. resuming with Esc, or re-locking too soon after Esc) is not fatal:
  // the next click on the view tries again, and drag-to-look works in the meantime.
  if (!renderer.domElement.requestPointerLock) dragLook = true;
  const lockRefused = () => { if (running && !paused && !locked) hud.setHint('CLICK THE VIEW TO CAPTURE THE CURSOR <span>✧</span>'); };
  const requestLock = () => {
    if (dragLook || locked) return;
    const el = renderer.domElement;
    const plain = () => { try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(lockRefused); } catch (e) { lockRefused(); } };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch((err) => { if (err && err.name === 'NotSupportedError') plain(); else lockRefused(); });
    } catch (e) { plain(); }
  };
  const start = () => {
    intro.classList.add('fade'); setTimeout(() => intro.classList.add('hidden'), 800);
    running = true; paused = false;
    hud.show();
    audio.init(settings.volume);
    if (world.ruins.orrery) audio.setHumPosition(world.ruins.orrery.centre);
    requestLock();
    hud.setHint('LOOK FOR THE GLOWING SEED <span>✧</span>');
    setTimeout(() => { if (!paused) hud.hideHint(); }, 26000);
    renderer.domElement.focus();
  };
  $('enter').addEventListener('click', () => {
    const s = $('intro-seed').value.trim().toUpperCase() || 'LYRA-09';
    const q = $('intro-quality').value;
    if (s !== params.seedName || q !== (params.quality || settings.quality)) { settings.quality = q; saveSettings(settings); relaunch(s, q); return; }
    start();
  });
  if (params.autostart) { intro.classList.add('hidden'); } else intro.classList.remove('hidden');

  const openPanel = (el) => { for (const p of [pause, journal, settingsEl]) p.classList.toggle('hidden', p !== el); };
  const setPaused = (on, panel = pause) => {
    paused = on;
    if (on) { openPanel(panel); audio.suspend(false); player.keys = {}; if (document.pointerLockElement) document.exitPointerLock(); }
    else { openPanel(null); requestLock(); renderer.domElement.focus(); }
  };
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    lookSettle = locked ? 2 : 0; // the first deltas after the lock engages can carry the cursor jump
    if (!locked && running && !paused) { setPaused(true); hud.setStatus('CURSOR RELEASED', 0); hud.setHint('CLICK TO RETURN <span>✧</span>'); }
    if (locked) { hud.setStatus(game.awake ? 'ECOSYSTEM AWAKENED' : 'ECOSYSTEM ACTIVE', 0); hud.hideHint(); }
  });
  document.addEventListener('pointerlockerror', lockRefused);
  renderer.domElement.addEventListener('click', () => { if (running && !paused && !locked) requestLock(); });
  pause.addEventListener('click', (e) => {
    const act = e.target.dataset?.act;
    if (act === 'resume') setPaused(false);
    if (act === 'journal') { renderJournal(game); openPanel(journal); }
    if (act === 'settings') { syncSettings(); openPanel(settingsEl); }
    if (act === 'origin') { player.spawn(sp.x, sp.z, sp.yaw); setPaused(false); }
  });
  for (const p of [journal, settingsEl]) p.addEventListener('click', (e) => { if (e.target.dataset?.close !== undefined) openPanel(pause); });
  $('journal-tabs').addEventListener('click', (e) => { const t = e.target.dataset?.tab; if (t) renderJournal(game, t); });

  // ------------------------------------------------------------- settings
  function syncSettings() {
    $('set-quality').value = params.quality && PRESETS[params.quality] ? params.quality : settings.quality;
    $('set-scale').value = settings.renderScale || quality.pixelRatio; $('out-scale').textContent = Number($('set-scale').value).toFixed(2) + '×';
    $('set-adaptive').checked = settings.adaptive;
    $('set-shadows').checked = lighting.moon.castShadow;
    $('set-bloom').checked = !!quality.bloom; $('set-rays').checked = !!quality.rays;
    $('set-fov').value = settings.fov; $('out-fov').textContent = settings.fov + '°';
    $('set-sens').value = settings.sensitivity; $('out-sens').textContent = Number(settings.sensitivity).toFixed(2);
    $('set-invert').checked = settings.invertY;
    $('set-vol').value = settings.volume; $('out-vol').textContent = Math.round(settings.volume * 100) + '%';
    $('set-seed').value = params.seedName;
  }
  const bind = (id, ev, fn) => $(id).addEventListener(ev, (e) => { fn(e.target); saveSettings(settings); syncSettings(); });
  bind('set-quality', 'change', (t) => { settings.quality = t.value; settings.shadows = settings.bloom = settings.rays = null; saveSettings(settings); relaunch(params.seedName, t.value); });
  bind('set-scale', 'input', (t) => { settings.renderScale = Number(t.value); applyPixelRatio(); });
  bind('set-adaptive', 'change', (t) => { settings.adaptive = t.checked; if (!t.checked) { dynScale = 1; applyPixelRatio(); } });
  bind('set-shadows', 'change', (t) => { settings.shadows = t.checked; lighting.setShadows(t.checked, quality.shadowSize); });
  bind('set-bloom', 'change', (t) => { settings.bloom = t.checked; post.setOptions({ bloom: t.checked }); post.resize(); });
  bind('set-rays', 'change', (t) => { settings.rays = t.checked; if (t.checked && !quality.raySamples) quality.raySamples = 32; post.setOptions({ rays: t.checked }); post.resize(); });
  bind('set-fov', 'input', (t) => { settings.fov = Number(t.value); particles.resize(renderer.domElement.height, settings.fov); });
  bind('set-sens', 'input', (t) => { settings.sensitivity = Number(t.value); });
  bind('set-invert', 'change', (t) => { settings.invertY = t.checked; });
  bind('set-vol', 'input', (t) => { settings.volume = Number(t.value); audio.setVolume(settings.volume); });
  $('set-reseed').addEventListener('click', () => { const s = $('set-seed').value.trim().toUpperCase(); if (s) relaunch(s, settings.quality); });

  function applyPixelRatio() {
    renderer.setPixelRatio(basePR() * dynScale);
    renderer.setSize(innerWidth, innerHeight);
    post.resize();
    world.water.resize(renderer.domElement.width, renderer.domElement.height);
    particles.resize(renderer.domElement.height, camera.fov);
  }
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyPixelRatio(); });

  // ---------------------------------------------------------------- input
  let dragging = false, lastLookMag = 0;
  document.addEventListener('mousemove', (e) => {
    if (!running || paused) return;
    // locked: normal mouse look; not locked: drag-to-look (fallback, or until a click re-locks)
    if (!(locked || dragging)) return;
    if (lookSettle > 0) { lookSettle--; return; }
    const dx = e.movementX || 0, dy = e.movementY || 0, mag = Math.hypot(dx, dy);
    // Drop isolated outliers (a single huge delta out of nowhere) instead of snapping the view.
    // A real flick ramps up over several events, so it passes this test.
    if (mag > 180 && mag > lastLookMag * 6 + 60) { lastLookMag = mag * 0.25; return; }
    lastLookMag = mag;
    player.look(dx, dy);
  });
  renderer.domElement.addEventListener('mousedown', () => { dragging = true; lastLookMag = 0; });
  addEventListener('mouseup', () => { dragging = false; });
  // browsers keep audio suspended until a user gesture (always the case with ?autostart)
  const wakeAudio = () => { if (running) audio.init(settings.volume); };
  addEventListener('pointerdown', wakeAudio);
  document.addEventListener('keydown', (e) => {
    wakeAudio();
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'F3' || e.code === 'Backquote') { perfOn = hud.togglePerf(); e.preventDefault(); return; }
    if (!running) { if (e.code === 'Enter') $('enter').click(); return; }
    if (e.code === 'KeyJ' || e.code === 'Tab') { e.preventDefault(); if (journal.classList.contains('hidden')) { renderJournal(game); setPaused(true, journal); } else setPaused(false); return; }
    if (e.code === 'Escape' && paused) { if (!pause.classList.contains('hidden')) setPaused(false); else openPanel(pause); return; }
    if (e.code === 'Escape' && !locked) { setPaused(true); return; } // drag-look mode has no lock for Esc to release
    if (paused) return;
    player.keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyE' && !e.repeat) game.interact();
    if (e.code === 'KeyR' && !e.repeat) player.spawn(sp.x, sp.z, sp.yaw);
  });
  document.addEventListener('keyup', (e) => { player.keys[e.code] = false; });
  addEventListener('blur', () => { player.keys = {}; });
  player.onStep = (surface, k) => audio.footstep(surface, k);
  player.onLand = (impact, surface) => audio.land(impact, surface);

  // ---------------------------------------------------------- benchmark
  const bench = { on: params.bench > 0, dur: params.bench, t: 0, frames: [], path: [], done: false };
  if (bench.on) {
    const S = world.sites;
    const pts = [S.spawn, world.groveCenter, S.ring, S.orrery, S.cave, S.pylons, S.leviathan, S.gate, S.spawn].filter(Boolean);
    bench.path = pts.map((p) => new THREE.Vector3(p.x, 0, p.z));
    bench.len = 0; for (let i = 1; i < bench.path.length; i++) bench.len += bench.path[i].distanceTo(bench.path[i - 1]);
    player.frozen = true;
  }
  function benchStep(dt) {
    bench.t += dt;
    const s = Math.min(1, bench.t / bench.dur) * bench.len;
    let acc = 0;
    for (let i = 1; i < bench.path.length; i++) {
      const seg = bench.path[i].distanceTo(bench.path[i - 1]);
      if (acc + seg >= s) {
        const k = (s - acc) / seg;
        const x = THREE.MathUtils.lerp(bench.path[i - 1].x, bench.path[i].x, k), z = THREE.MathUtils.lerp(bench.path[i - 1].z, bench.path[i].z, k);
        player.pos.set(x, Math.max(world.hf.heightAt(x, z), WORLD.waterLevel - 1.3), z);
        const dx = bench.path[i].x - bench.path[i - 1].x, dz = bench.path[i].z - bench.path[i - 1].z;
        const targetYaw = Math.atan2(-dx, -dz);
        let dy = targetYaw - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        player.yaw += dy * Math.min(1, dt * 1.5); player.pitch = -0.05;
        break;
      }
      acc += seg;
    }
    if (bench.t >= bench.dur && !bench.done) {
      bench.done = true;
      const f = bench.frames.slice(10).sort((a, b) => a - b);
      const avg = f.reduce((a, b) => a + b, 0) / f.length;
      const p99 = f[Math.floor(f.length * 0.99)] || avg;
      const res = { quality: quality.name, frames: f.length, avgMs: +avg.toFixed(2), avgFps: +(1000 / avg).toFixed(1), p99Ms: +p99.toFixed(2), low1Fps: +(1000 / p99).toFixed(1), pixelRatio: +renderer.getPixelRatio().toFixed(2), canvas: `${renderer.domElement.width}x${renderer.domElement.height}`, calls: lastInfo.calls, tris: lastInfo.tris, genMs: Math.round(genMs), gpu: window.VG.gpuSamples(f.length), cpuMs: +cpuMs.toFixed(2) };
      window.__vgBench = res;
      console.log('[VOID GARDEN BENCH]', JSON.stringify(res));
      hud.toast('BENCHMARK', `${res.avgFps} FPS AVG · ${res.low1Fps} FPS 1% LOW`, 30);
    }
  }

  // GPU time per frame via timer queries: independent of vsync and of background-tab throttling
  const gpuTimer = (() => {
    const gl = renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const pending = [];
    const t = { ext: !!ext, ms: 0, samples: [], win: [], begin() { if (!ext || pending.length > 6) return null; const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); return q; },
      end(q) { if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); } },
      poll() {
        while (pending.length) {
          const q = pending[0];
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; t.ms = t.ms ? t.ms * 0.9 + ms * 0.1 : ms; t.samples.push(ms); if (t.samples.length > 4000) t.samples.shift(); if (t.win.length < 2000) t.win.push(ms); }
          gl.deleteQuery(q); pending.shift();
        }
      } };
    return t;
  })();

  // ------------------------------------------------------------ main loop
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsN = 0, fpsShow = 0, frameEma = 16.7, adaptT = 0, adaptCool = 0, adaptLow = 0, perfT = 0, cpuMs = 0;
  const lastInfo = { calls: 0, tris: 0 };
  const shoreV = new THREE.Vector3();
  let shoreT = 0, shoreDist = 999;
  const playerState = { pos: player.pos, eye: player.eye, noise: 0.3 };
  const lifeExtras = { audio, observe: (k) => game.observe(k), pulseNear: (p) => { const s = U.uPulseStr.value; if (s <= 0.01) return 0; const d = Math.hypot(p.x - U.uPulse.value.x, p.z - U.uPulse.value.z); return Math.exp(-(((d - U.uPulse.value.w) / 6) ** 2)) * s; } };
  if (params.autostart) start();

  let sizeW = -1, sizeH = -1;
  let freeCam = null; // debug camera override (VG.freeCam)
  let exposure = 1.0;
  function frame() {
    requestAnimationFrame(frame);
    // keep the canvas matched to the window (also covers pages loaded while hidden)
    if (innerWidth !== sizeW || innerHeight !== sizeH) {
      sizeW = innerWidth; sizeH = innerHeight;
      if (sizeW > 0 && sizeH > 0) { camera.aspect = sizeW / sizeH; camera.updateProjectionMatrix(); applyPixelRatio(); }
    }
    if (!warmed && renderer.domElement.width > 0 && renderer.domElement.height > 0) { warmUpShaders(); warmed = true; } // page loaded while hidden
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const c0 = performance.now();
    if (running && !paused) {
      elapsed += dt;
      U.uTime.value = elapsed;
      if (bench.on && !bench.done) { benchStep(dt); bench.frames.push(rawDt * 1000); }
      if (!bench.on) life.pushPlayer(player.pos);
      player.update(dt, elapsed);
      if (freeCam) { camera.position.copy(freeCam.pos); camera.rotation.set(freeCam.pitch, freeCam.yaw, 0); }
      U.uPlayer.value.copy(player.pos);
      playerState.noise = player.noise;
      atmosphere.update(dt, elapsed);
      game.update(dt, elapsed);
      life.update(dt, elapsed, playerState, camera.position, lifeExtras);
      shoreT -= dt; if (shoreT <= 0) { shoreT = 0.5; shoreDist = world.water.nearestShore(camera.position.x, camera.position.z, shoreV); }
      audio.update(dt, elapsed, camera, { wind: U.uWind.value.z, speed: player.speedNow, inCave: player.inCave, underwater: player.underwater, shore: shoreV, shoreDist });
      const region = game.region;
      hud.update(player.yaw, player.pos.y - WORLD.waterLevel, region, atmosphere.label() || (player.underwater ? 'SUBMERGED' : null));
    } else {
      U.uTime.value += dt * 0.5; // the world keeps breathing behind menus
      elapsed += dt * 0.5;
    }
    // eye adaptation: darker surroundings (cave, mountain shadow, underwater) open the "iris" slowly
    {
      const vis = world.hf.sunVisibility(camera.position.x, camera.position.y, camera.position.z);
      const target = (player.inCave ? 1.9 : 1.0) * (player.underwater ? 1.25 : 1.0) * (1.0 + (1 - vis) * 0.3);
      exposure += (target - exposure) * Math.min(1, dt * (target > exposure ? 0.6 : 1.5));
      post.setExposure(exposure);
    }
    world.update(dt, elapsed, camera.position);
    lighting.update(dt, camera.position, world.glowSpots);
    sky.update(camera);
    particles.update(camera.position);
    renderer.info.reset();
    const q = gpuTimer.begin();
    post.render(dt, elapsed, player.underwater);
    gpuTimer.end(q);
    gpuTimer.poll();
    lastInfo.calls = renderer.info.render.calls; lastInfo.tris = renderer.info.render.triangles;
    cpuMs = cpuMs * 0.9 + (performance.now() - c0) * 0.1;

    // FPS + adaptive resolution
    frameEma = frameEma * 0.95 + rawDt * 1000 * 0.05;
    fpsAcc += rawDt; fpsN++;
    if (fpsAcc > 0.5) { fpsShow = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    // Adaptive resolution: driven by measured GPU time when timer queries exist (immune to
    // vsync caps and background throttling), otherwise by frame time.
    // Every change reallocates the render targets (a visible hitch), and the cost of a view
    // swings about 3x between the ground and the open sky, so decisions use the 90th percentile
    // of a 2 s window, scale up only after two cheap windows in a row and never within 8 s of a
    // downscale, and only when the predicted cost at the new scale stays inside the budget.
    adaptT += rawDt; adaptCool -= rawDt;
    if (!(settings.adaptive && running && !paused && !bench.on && elapsed > 4)) { gpuTimer.win.length = 0; adaptT = 0; adaptLow = 0; }
    else if (adaptT > 2) {
      adaptT = 0;
      const useGpu = gpuTimer.ext && gpuTimer.win.length >= 8;
      let cost = frameEma;
      if (useGpu) { const w = gpuTimer.win.sort((a, b) => a - b); cost = Math.max(w[Math.floor(w.length * 0.9)], cpuMs); }
      gpuTimer.win.length = 0;
      const hi = useGpu ? 14.5 : 19, lo = useGpu ? 9.5 : 14.5;
      if (cost > hi && dynScale > 0.6 && (useGpu || frameEma < 100)) {
        dynScale = Math.max(0.6, dynScale * Math.max(0.8, Math.sqrt(hi * 0.85 / cost))); applyPixelRatio();
        adaptCool = 8; adaptLow = 0;
      } else if (cost < lo && dynScale < 1) {
        const next = Math.min(1, dynScale + 0.05);
        adaptLow = cost * (next / dynScale) ** 2 < lo ? adaptLow + 1 : 0;
        if (adaptLow >= 2 && adaptCool <= 0) { dynScale = next; applyPixelRatio(); adaptLow = 0; }
      } else adaptLow = 0;
    }
    perfT += rawDt;
    if (perfOn && perfT > 0.25) {
      perfT = 0;
      const m = renderer.info.memory;
      hud.perf(`FPS ${fpsShow.toFixed(0)}  (${frameEma.toFixed(1)} ms)  CPU ${cpuMs.toFixed(1)} ms  GPU ${gpuTimer.ext ? gpuTimer.ms.toFixed(1) + ' ms' : 'n/a'}\nQUALITY ${quality.label.toUpperCase()}  SCALE ${(basePR() * dynScale).toFixed(2)}  ${renderer.domElement.width}x${renderer.domElement.height}\nDRAWS ${lastInfo.calls}  TRIS ${(lastInfo.tris / 1000).toFixed(0)}k\nGEO ${m.geometries}  TEX ${m.textures}  PROG ${renderer.info.programs.length}\nPOS ${player.pos.x.toFixed(0)}, ${player.pos.y.toFixed(1)}, ${player.pos.z.toFixed(0)}  ${game.region ? game.region.name : ''}\nGEN ${(genMs / 1000).toFixed(2)} s  SEED ${params.seedName}`);
    }
  }
  frame();

  // ------------------------------------------------------------- debug API
  window.VG = {
    THREE, scene, camera, renderer, world, life, player, game, post, sky, lighting, atmosphere, quality, settings,
    teleport(x, z, yaw = player.yaw) { player.spawn(x, z, yaw); },
    look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; },
    /** Debug: place the camera freely (player stays put). Pass null to release. */
    freeCam(x, y, z, yaw = 0, pitch = 0) { freeCam = x === null ? null : { pos: new THREE.Vector3(x, y, z), yaw, pitch }; },
    lookAtFrom(from, to) { const d = new THREE.Vector3().subVectors(to, from); freeCam = { pos: from.clone(), yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }; },
    start, setPaused,
    gpuSamples: (n = 600) => { const s = gpuTimer.samples.slice(-n).sort((a, b) => a - b); if (!s.length) return null; const avg = s.reduce((a, b) => a + b, 0) / s.length; return { n: s.length, avgMs: +avg.toFixed(2), p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p99: +s[Math.floor(s.length * 0.99)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; },
    stats: () => ({ fps: +fpsShow.toFixed(1), frameMs: +frameEma.toFixed(2), cpuMs: +cpuMs.toFixed(2), gpuMs: +gpuTimer.ms.toFixed(2), calls: lastInfo.calls, tris: lastInfo.tris, pixelRatio: renderer.getPixelRatio(), canvas: [renderer.domElement.width, renderer.domElement.height], genMs: Math.round(genMs), programs: renderer.info.programs.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
    sites: () => JSON.parse(JSON.stringify(world.sites, (k, v) => (k === 'mesh' ? undefined : v))),
  };
}

boot().catch((e) => fatal(e.stack || e.message || String(e)));
