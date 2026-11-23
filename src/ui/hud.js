// Minimal exploration HUD: compass without markers, region title cards, discovery
// toasts, echo text, interaction prompt, records counter, perf overlay, journal UI.
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), prompt: $('prompt'), verb: $('prompt-verb'), name: $('prompt-name'), reticle: $('reticle'),
      rt: $('region-title'), rtName: $('rt-name'), rtEyebrow: $('rt-eyebrow'), toast: $('toast'), toastText: $('toast-text'), toastEye: $('toast-eyebrow'),
      echo: $('echo'), echoText: $('echo-text'), status: $('status'), records: $('records'), hint: $('hint'), biome: $('biome'), alt: $('altitude'),
      atmo: $('atmo'), sector: $('sector'), regionSmall: $('region-small'), compass: $('compass-strip'), perf: $('perf'),
    };
    this.timers = {};
    this._buildCompass();
    this.promptKey = '';
    this.statusDefault = 'ECOSYSTEM ACTIVE';
  }

  _buildCompass() {
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    this.ppd = 340 / 120;
    let html = '';
    for (let d = -360; d <= 720; d += 15) {
      const x = (d + 360) * this.ppd;
      const n = ((d % 360) + 360) % 360;
      if (labels[n] !== undefined) html += `<span class="${n % 90 === 0 ? 'major' : ''}" style="left:${x}px">${labels[n]}</span>`;
      else html += `<span class="tick" style="left:${x}px"></span>`;
    }
    this.el.compass.innerHTML = html;
  }

  show() { this.el.hud.classList.remove('faded'); }
  hide() { this.el.hud.classList.add('faded'); }

  _timer(name, sec, fn) { clearTimeout(this.timers[name]); if (sec > 0) this.timers[name] = setTimeout(fn, sec * 1000); }

  setPrompt(verb, name) {
    const key = verb + name;
    if (key !== this.promptKey) { this.el.verb.textContent = verb; this.el.name.textContent = name; this.promptKey = key; }
    this.el.prompt.classList.add('show'); this.el.reticle.classList.add('focus');
  }
  hidePrompt() { if (this.promptKey) { this.el.prompt.classList.remove('show'); this.el.reticle.classList.remove('focus'); this.promptKey = ''; } }

  region(name, eyebrow = 'ENTERING') {
    this.el.rtEyebrow.textContent = eyebrow; this.el.rtName.textContent = name;
    this.el.rt.classList.add('show');
    this._timer('rt', 3.6, () => this.el.rt.classList.remove('show'));
  }
  toast(eyebrow, text, sec = 2.6) {
    this.el.toastEye.textContent = eyebrow; this.el.toastText.textContent = text;
    this.el.toast.classList.add('show');
    this._timer('toast', sec, () => this.el.toast.classList.remove('show'));
  }
  echo(text, sec = 6) {
    this.el.echoText.textContent = text; this.el.echo.classList.add('show');
    this._timer('echo', sec, () => this.el.echo.classList.remove('show'));
  }
  setStatus(text, sec = 0) {
    this.el.status.textContent = text;
    if (sec > 0) this._timer('status', sec, () => { this.el.status.textContent = this.statusDefault; });
    else this.statusDefault = text;
  }
  setRecords(n, total) { this.el.records.textContent = `RECORDS ${n} / ${total}`; }
  setHint(html) { this.el.hint.innerHTML = html; this.el.hint.classList.remove('off'); }
  hideHint() { this.el.hint.classList.add('off'); }
  setSector(name) { this.el.sector.textContent = name; }

  update(yaw, altitude, region, atmo) {
    const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const x = -((heading + 360) * this.ppd) + 170;
    this.el.compass.style.transform = `translateX(${x.toFixed(1)}px)`;
    const altText = `${altitude.toFixed(0)} M`;
    if (altText !== this._alt) { this.el.alt.textContent = altText; this._alt = altText; }
    if (region && region.biome !== this._biome) { this.el.biome.textContent = region.biome; this.el.regionSmall.textContent = region.name; this._biome = region.biome; }
    const a = atmo || 'BREATHABLE';
    if (a !== this._atmo) { this.el.atmo.textContent = a; this._atmo = a; }
  }

  perf(text) { this.el.perf.textContent = text; }
  togglePerf() { this.el.perf.classList.toggle('hidden'); return !this.el.perf.classList.contains('hidden'); }
}

export function renderJournal(game, tab = 'all') {
  const tabs = [['all', 'ALL'], ['places', 'PLACES'], ['flora', 'FLORA'], ['fauna', 'FAUNA'], ['echoes', 'ECHOES']];
  const tabsEl = $('journal-tabs'), list = $('journal-list');
  tabsEl.innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
  const rows = game.entries.filter((e) => tab === 'all' || e.cat === tab).map((e) => {
    const ok = game.found.has(e.id);
    const cat = e.cat.toUpperCase();
    return ok
      ? `<div class="entry"><h4>${e.title.toUpperCase()}<small>${cat}</small></h4><p>${e.text}</p></div>`
      : `<div class="entry locked"><h4>UNRECORDED<small>${cat}</small></h4><p>${e.cat === 'places' ? 'Somewhere in the sector.' : e.cat === 'echoes' ? 'A voice not yet heard.' : 'Not yet observed.'}</p></div>`;
  });
  list.innerHTML = rows.join('');
  $('journal-count').textContent = `${game.recordCount()} / ${game.entries.length} RECORDED`;
}
