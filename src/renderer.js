// renderer.js — Breathgarden app flow: consent → setup → session → summary.
'use strict';

const { Garden } = require('./garden');
const { PresageSource, SimulatedSource, hasPresageBridge } = require('./signals');

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const SCREENS = ['consent', 'setup', 'session', 'summary'];
function show(name) {
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  const focusable = $(`screen-${name}`).querySelector('h1, button.primary');
  if (focusable && name !== 'session') { focusable.setAttribute('tabindex', '-1'); focusable.focus({ preventScroll: true }); }
}

const garden = new Garden($('garden'));

// ---- App state (memory only; nothing in this file touches disk or storage) ----
const app = {
  config: { demo: !hasPresageBridge(), hasEnvKey: false },
  consented: false,
  telemetry: false,
  minutes: 3,
  pace: 6,
  showNumbers: false,
  source: null,
  session: null,
};

function newSession(kind) {
  return {
    kind,
    started: 0,          // performance.now() when signal became ready
    elapsed: 0,          // seconds of running time
    syncSeconds: 0,      // seconds spent in step with the guide
    bank: 0,             // sync seconds towards the next flower
    flowers: 0,
    hintOk: false,
    hintBadSince: performance.now(),
    breath: [],          // [{t, v}] last ~15 s, for normalization + sparkline
    vitals: {},          // latest
    log: [],             // 1 Hz [{t, br, pr, hrv}] for the summary — memory only
    lastLog: -1,
    ended: false,
  };
}

// ---- Consent ----
$('opt-consent').addEventListener('change', (e) => { $('btn-consent').disabled = !e.target.checked; });
$('btn-consent').addEventListener('click', () => {
  app.consented = true;
  app.telemetry = $('opt-telemetry').checked;
  enterSetup();
});
$('btn-sim-from-consent').addEventListener('click', () => { app.consented = false; enterSetup(); });
const openPrivacy = (e) => { e && e.preventDefault(); $('privacy').showModal(); };
$('btn-privacy').addEventListener('click', openPrivacy);
$('link-telemetry').addEventListener('click', openPrivacy);

// ---- Setup ----
function enterSetup() {
  const liveAvailable = !app.config.demo && app.consented;
  $('btn-begin').hidden = !liveAvailable;
  $('key-field').hidden = !liveAvailable || app.config.hasEnvKey;
  $('btn-begin-sim').textContent = liveAvailable ? 'Simulated garden (no camera)' : 'Begin simulated garden';
  $('btn-begin-sim').className = liveAvailable ? 'ghost' : 'primary';
  $('setup-msg').textContent = app.config.demo
    ? (hasPresageBridge() ? 'Demo mode: the SmartSpectra SDK and camera are disabled for this run.' : 'Running outside Breathgarden’s desktop app, so only the simulated garden is available.')
    : (!app.consented ? 'Camera consent not given, so only the simulated garden is available. Reopen the app to change this.' : '');
  $('setup-msg').style.color = 'var(--ink-3)';
  show('setup');
}
for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    for (const c of document.querySelectorAll('.chip')) { c.classList.toggle('on', c === chip); c.setAttribute('aria-checked', String(c === chip)); }
    app.minutes = Number(chip.dataset.min);
  });
}
$('pace').addEventListener('input', (e) => { app.pace = Number(e.target.value); $('pace-out').textContent = app.pace.toFixed(1); });
$('opt-numbers').addEventListener('change', (e) => { app.showNumbers = e.target.checked; });
$('btn-begin').addEventListener('click', () => beginSession('presage'));
$('btn-begin-sim').addEventListener('click', () => beginSession('simulated'));

// ---- Session ----
async function beginSession(kind) {
  $('setup-msg').textContent = '';
  let source;
  if (kind === 'presage') {
    if (!app.consented) return; // hard gate: no consent, no camera
    const apiKey = app.config.hasEnvKey ? await window.breathgarden.getEnvKey() : $('api-key').value.trim();
    if (!apiKey) { $('setup-msg').style.color = ''; $('setup-msg').textContent = 'Please paste your Presage API key first.'; return; }
    source = new PresageSource({ apiKey, enableTelemetry: app.telemetry });
  } else {
    source = new SimulatedSource({ getTargetRate: () => app.pace });
  }

  app.source = source;
  app.session = newSession(kind);
  garden.clearFlowers();
  garden.set({ breath: 0.5, pulse: null, sync: 0, listening: false });

  $('source-badge').hidden = false;
  $('source-badge').className = `badge ${kind === 'presage' ? 'live' : 'sim'}`;
  $('source-badge').textContent = kind === 'presage' ? 'Live · Presage SmartSpectra' : 'Simulated signal · no camera';
  $('trace-src').textContent = kind === 'presage' ? '· SmartSpectra chest trace' : '· simulated';
  $('numbers').hidden = !app.showNumbers;
  $('preview-wrap').hidden = kind !== 'presage';
  $('error').hidden = true;
  $('guide-word').textContent = kind === 'presage' ? 'Waking the garden…' : 'Settling in…';
  setHint('');
  updateHud();
  show('session');

  wire(source);
  if (kind === 'presage') {
    const access = await window.breathgarden.cameraAccess().catch(() => 'unknown');
    if (access === 'denied' || access === 'restricted') {
      showError({ name: 'Camera blocked by macOS', message: CAMERA_BLOCKED_HELP });
      return;
    }
  }
  try {
    await source.start();
  } catch (err) {
    showError({ name: err.code ?? 'Error', message: err.message || String(err) });
  }
}

const CAMERA_BLOCKED_HELP =
  'macOS isn’t giving this app any camera frames. Open System Settings › Privacy & Security › Camera and allow ' +
  'the app you launched Breathgarden from (for example Terminal or iTerm). Then quit and reopen Breathgarden from that app.';

// The OS can hand back a "live" camera track that never delivers a frame when
// camera permission belongs to a different (parent) app. Catch that quickly
// instead of waiting for the SDK's 30 s startup watchdog.
function watchForFrames(video, source) {
  const deadline = performance.now() + 7000;
  const check = () => {
    if (source !== app.source || !app.session || app.session.ended) return;
    if (video.videoWidth > 0) return; // frames are flowing
    if (performance.now() > deadline) {
      source.stop().catch(() => {});
      showError({ name: 'No camera frames', message: CAMERA_BLOCKED_HELP });
      return;
    }
    setTimeout(check, 500);
  };
  check();
}

function wire(source) {
  source.on('status', (st) => {
    if (source !== app.source) return;
    $('camera-indicator').hidden = !(source.kind === 'presage' && (st === 'starting' || st === 'running'));
    if (st === 'running' && !app.session.started) app.session.started = performance.now();
  });
  source.on('stream', (stream) => {
    const v = $('preview'); v.srcObject = stream; v.play().catch(() => {});
    $('camera-indicator').hidden = false;
    watchForFrames(v, source);
  });
  source.on('hint', (h) => {
    const s = app.session; if (!s) return;
    if (h.ok && !s.hintOk) setHint('');
    if (!h.ok && s.hintOk) s.hintBadSince = performance.now();
    s.hintOk = h.ok;
    s.hintMsg = h.message;
  });
  source.on('breath', (samples) => {
    const s = app.session; if (!s) return;
    for (const p of samples) s.breath.push(p);
    const tEnd = s.breath[s.breath.length - 1].t;
    while (s.breath.length && s.breath[0].t < tEnd - 15) s.breath.shift();
  });
  source.on('vitals', (v) => { const s = app.session; if (s) Object.assign(s.vitals, v); });
  source.on('error', (e) => showError(e));
}

function setHint(msg) { $('hint').textContent = msg; $('hint').classList.toggle('show', !!msg); }

function showError(e) {
  $('error-title').textContent = `Couldn’t start the garden (${e.name})`;
  $('error-msg').textContent = e.message;
  $('error').hidden = false;
  $('camera-indicator').hidden = true;
}
$('btn-error-back').addEventListener('click', async () => { await teardown(); enterSetup(); });

// Pacer: inhale 40% of the cycle, exhale 60% (a longer out-breath feels calmer).
function pacerAt(t, bpm) {
  const period = 60 / bpm, u = (t % period) / period, ease = (x) => (1 - Math.cos(Math.PI * x)) / 2;
  return u < 0.4 ? { v: ease(u / 0.4), word: 'Breathe in' } : { v: 1 - ease((u - 0.4) / 0.6), word: 'and out' };
}

function normalizedBreath(buf) {
  if (buf.length < 8) return null; // buf already holds only the last ~15 s
  let lo = Infinity, hi = -Infinity;
  for (const p of buf) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  const range = hi - lo;
  if (!(range > 1e-6)) return 0.5;
  return clamp((buf[buf.length - 1].v - lo) / range, 0, 1);
}

let lastTick = performance.now();
function tick(now) {
  const dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
  const s = app.session;
  if (s && !s.ended && s.started) {
    const t = (now - s.started) / 1000;
    s.elapsed = t;
    const p = pacerAt(t, app.pace);
    garden.set({ pacer: p.v, listening: s.hintOk });

    const nb = normalizedBreath(s.breath);
    if (nb != null) garden.set({ breath: nb });
    if (s.vitals.pulseRate) garden.set({ pulse: s.vitals.pulseRate });

    // How close is your breathing rate to the guide? Within ~3.5 breaths/min counts as "in step".
    let sync = 0;
    if (s.vitals.breathingRate) sync = clamp(1 - Math.abs(s.vitals.breathingRate - app.pace) / 3.5, 0, 1);
    if (!s.hintOk) sync *= 0.3;
    garden.set({ sync });
    s.sync = sync;

    if (s.hintOk && sync > 0.55) {
      s.syncSeconds += dt; s.bank += dt * (0.6 + sync * 0.6);
      if (s.bank >= 10) { s.bank = 0; s.flowers++; garden.addFlower(Math.floor(now)); }
    }

    // Guidance text: pacer word when we can see you, otherwise the friendliest hint.
    if (!s.hintOk && now - s.hintBadSince > 1200 && s.hintMsg) setHint(s.hintMsg);
    $('guide-word').textContent = s.vitals.breathingRate || s.breath.length > 30 ? p.word : 'Listening to your breath…';

    if (t - s.lastLog >= 1) {
      s.lastLog = t;
      s.log.push({ t, br: s.vitals.breathingRate, pr: s.vitals.pulseRate, hrv: s.vitals.hrv?.rmssd });
    }
    if (t >= app.minutes * 60) finish();
    updateHud();
  } else if (s && !s.started) {
    // Before the signal is running, keep the pacer gently moving so the screen isn't static.
    garden.set({ pacer: pacerAt(now / 1000, app.pace).v });
    if (s.hintMsg && !s.hintOk) setHint(s.hintMsg);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function updateHud() {
  const s = app.session; if (!s) return;
  $('time-left').textContent = fmt(Math.max(0, app.minutes * 60 - s.elapsed));
  $('flower-count').textContent = String(s.flowers);
  const pct = Math.round((s.sync || 0) * 100);
  $('sync-bar').style.width = `${pct}%`;
  $('sync-bar').parentElement.setAttribute('aria-valuenow', String(pct));
  if (app.showNumbers) {
    $('n-br').textContent = s.vitals.breathingRate ? s.vitals.breathingRate.toFixed(1) : '–';
    $('n-pr').textContent = s.vitals.pulseRate ? Math.round(s.vitals.pulseRate) : '–';
    $('n-hrv').textContent = s.vitals.hrv ? Math.round(s.vitals.hrv.rmssd) + (s.vitals.hrv.stable ? '' : '~') : '–';
  }
  drawTrace(s.breath);
}

const traceCanvas = $('trace');
function drawTrace(buf) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = traceCanvas.clientWidth, h = traceCanvas.clientHeight;
  if (traceCanvas.width !== Math.round(w * dpr)) { traceCanvas.width = Math.round(w * dpr); traceCanvas.height = Math.round(h * dpr); }
  const ctx = traceCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (buf.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const p of buf) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  const t1 = buf[buf.length - 1].t, t0 = t1 - 15, r = hi - lo || 1;
  ctx.strokeStyle = '#8fe3c9'; ctx.lineWidth = 1.6; ctx.beginPath();
  buf.forEach((p, i) => { const x = ((p.t - t0) / 15) * w, y = h - 4 - ((p.v - lo) / r) * (h - 8); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
}

$('btn-hide-preview').addEventListener('click', () => {
  const wrap = $('preview-wrap'); const c = wrap.classList.toggle('collapsed');
  $('btn-hide-preview').textContent = c ? 'show' : 'hide';
});
$('btn-end').addEventListener('click', () => finish());
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('screen-session').hidden) finish(); });

async function teardown() {
  const src = app.source; app.source = null;
  if (src) { await src.stop(); src.destroy(); }
  const v = $('preview'); v.srcObject = null;
  $('camera-indicator').hidden = true;
}

async function finish() {
  const s = app.session; if (!s || s.ended) return;
  s.ended = true;
  await teardown();
  renderSummary(s);
  show('summary');
}

function avg(arr) { const xs = arr.filter((x) => x != null && isFinite(x)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function renderSummary(s) {
  $('s-flowers').textContent = String(s.flowers);
  $('s-sync').textContent = fmt(s.syncSeconds);
  $('s-time').textContent = fmt(s.elapsed);
  const span = Math.min(60, s.elapsed / 3);
  const first = s.log.filter((r) => r.t <= span + 10), lastL = s.log.filter((r) => r.t >= s.elapsed - span);
  const rows = [
    ['Breathing rate', 'br', 1, '/min'],
    ['Pulse rate', 'pr', 0, 'bpm'],
    ['HRV (RMSSD)', 'hrv', 0, 'ms'],
  ].map(([label, key, dp, unit]) => {
    const a = avg(first.map((r) => r[key])), b = avg(lastL.map((r) => r[key]));
    if (a == null || b == null) return '';
    return `<div class="trend"><span>${label}, start → end</span><b>${a.toFixed(dp)} → ${b.toFixed(dp)} ${unit}</b></div>`;
  }).join('');
  $('s-trends').innerHTML = rows || '<div class="trend"><span>Not enough signal for trends this time. Try a longer session in good light.</span></div>';
  if (s.kind === 'simulated') $('s-trends').insertAdjacentHTML('afterbegin', '<div class="trend"><span>These numbers come from the simulated signal, not from you.</span></div>');
}

function forget() {
  app.session = null;
  garden.clearFlowers();
  garden.set({ breath: 0.5, pulse: null, sync: 0, listening: false });
  $('s-trends').innerHTML = '';
  $('source-badge').hidden = true;
}
$('btn-again').addEventListener('click', () => { forget(); enterSetup(); });
$('btn-forget').addEventListener('click', () => { forget(); enterSetup(); $('setup-msg').style.color = 'var(--ink-3)'; $('setup-msg').textContent = 'Session forgotten. Nothing was kept.'; });

// ---- Boot ----
(async () => {
  if (window.breathgarden) {
    try { Object.assign(app.config, await window.breathgarden.getConfig()); } catch (e) { console.warn(e); }
  }
  if (app.config.demo) {
    $('btn-consent').textContent = 'Continue';
  }
  show('consent');
})();
