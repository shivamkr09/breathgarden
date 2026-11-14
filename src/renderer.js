// renderer.js — Breathgarden flow: consent → framing check → session → summary.
// Everything here lives in memory. Nothing is written to disk or browser storage;
// the only file ever written is a postcard image, and only when you click Save.
'use strict';

const { PresageSource, SimulatedSource, hasPresageBridge } = require('./signals');
const { CameraView } = require('./camview');
const { Orb, drawRateChart, drawTrace, breathCycles, drawPostcard, blossomSvg } = require('./viz');
const { SoundGarden } = require('./sound');
const { VoiceGuide } = require('./voice');
const { GUIDE_DOWN, updateGuide, guideText, pacerShape, normalizedBreath, followScore } = require('./core');

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };
const word = (n) => WORDS[n] || String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const SCREENS = ['consent', 'calibrate', 'session', 'summary'];
function show(name) {
  app.screen = name;
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  const h = $(`screen-${name}`).querySelector('h1');
  if (h && name !== 'session') { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}

const app = {
  config: { demo: !hasPresageBridge(), hasEnvKey: false },
  screen: 'consent',
  pace: 6,
  minutes: 3,
  telemetry: false,
  showNumbers: false,
  source: null,
  s: null,
};
const camView = new CameraView($('camview'));                               // framing check (with compare split)
const camLive = new CameraView($('camlive'), { cy: 0.36, bottomPad: 16 });  // live panel during the session
const orb = new Orb($('orb'));
const sound = new SoundGarden();
const voice = new VoiceGuide();

// Which spoken tip fits each SDK readiness code.
const FIX_PHRASE = {
  NoFaceFound: 'fix_face', FaceNotForward: 'fix_face', MultipleFacesFound: 'fix_faces',
  FaceTooFar: 'fix_closer', FaceTooClose: 'fix_back', FaceNotCentered: 'fix_center', FaceTooHigh: 'fix_center',
  FaceTooLow: 'fix_center', FaceSizeOutOfRange: 'fix_center', ChestNotVisible: 'fix_chest',
  TooDark: 'fix_dark', TooBright: 'fix_bright', ExcessiveMotion: 'fix_still', CameraTuning: 'fix_still', FrameRateTooLow: 'fix_still',
};

function setSoundButton() {
  $('btn-sound').textContent = sound.on ? 'Sound on' : 'Sound off';
  $('btn-sound').setAttribute('aria-pressed', String(sound.on));
}
$('btn-sound').addEventListener('click', async () => {
  if (sound.on) sound.disable(); else await sound.enable().catch((e) => console.warn('audio', e));
  setSoundButton();
});

// ---------------------------------------------------------------- Consent ---
const PACES = [4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
const LENGTHS = [1, 3, 5];
function renderSettings() {
  $('pace-val').textContent = String(app.pace);
  $('len-val').textContent = String(app.minutes);
  $('hero-minutes').textContent = word(app.minutes);
  $('pace-down').disabled = app.pace <= PACES[0];
  $('pace-up').disabled = app.pace >= PACES[PACES.length - 1];
  $('len-down').disabled = app.minutes <= LENGTHS[0];
  $('len-up').disabled = app.minutes >= LENGTHS[LENGTHS.length - 1];
}
const stepIn = (list, v, d) => list[clamp(list.indexOf(v) + d, 0, list.length - 1)];
$('pace-down').addEventListener('click', () => { app.pace = stepIn(PACES, app.pace, -1); renderSettings(); });
$('pace-up').addEventListener('click', () => { app.pace = stepIn(PACES, app.pace, 1); renderSettings(); });
$('len-down').addEventListener('click', () => { app.minutes = stepIn(LENGTHS, app.minutes, -1); renderSettings(); });
$('len-up').addEventListener('click', () => { app.minutes = stepIn(LENGTHS, app.minutes, 1); renderSettings(); });
$('opt-consent').addEventListener('change', (e) => { $('btn-continue').disabled = !e.target.checked; });
$('btn-continue').addEventListener('click', () => beginSession('presage'));
$('btn-sim').addEventListener('click', () => beginSession('simulated'));
$('btn-privacy').addEventListener('click', () => $('privacy').showModal());

function enterConsent(msg = '') {
  voice.disable();
  const live = !app.config.demo;
  $('consent-row').hidden = !live;
  $('btn-continue').hidden = !live;
  $('key-field').hidden = !live || app.config.hasEnvKey;
  $('btn-sim').className = live ? 'btn' : 'btn primary grow';
  $('btn-sim').textContent = live ? 'Try without camera' : 'Try the simulated garden';
  $('consent-msg').textContent = msg || (live ? '' : hasPresageBridge()
    ? 'Demo mode: the SmartSpectra SDK and camera are turned off for this run.'
    : 'This is the browser preview, so only the simulated signal is available. Run the desktop app for live SmartSpectra.');
  renderSettings();
  show('consent');
}

// ------------------------------------------------------------ Session data ---
function newSession(kind) {
  return {
    kind,
    phase: 'calibrate',
    status: 'starting',
    calStart: performance.now(),
    seenHint: false,
    okSince: null,
    groupBad: { face: 0, frame: 0, light: 0, still: 0 },
    groupMsg: {},
    hintOk: false,
    hintMsg: '',
    hintBadSince: performance.now(),
    started: 0,
    elapsed: 0,
    sync: 0,
    syncSeconds: 0,
    bank: 0,
    flowers: 0,
    breath: [],          // [{t, v}] last ~40 s
    vitals: {},
    log: [],             // 1 Hz {t, br, pr, hrv} — memory only
    lastLog: -1,
    buckets: [],         // 5 s breathing-rate buckets for the chart
    pacerHist: [],       // [{at, v}] ring position, last 20 s
    print: [],           // breath-print: normalized breath every 0.25 s (shape only, for the postcard)
    lastPrint: -1,
    flowerTimes: [],     // seconds into the session when each flower bloomed
    talkingUntil: 0,     // the garden waits while you talk
    talkingAvailable: true,
    hrvBase: null,
    clockOff: null,
    ended: false,
  };
}

// --------------------------------------------------------------- Begin -----
async function beginSession(kind) {
  let source;
  if (kind === 'presage') {
    if (!$('opt-consent').checked) return; // hard gate: no consent, no camera
    const apiKey = app.config.hasEnvKey ? await window.breathgarden.getEnvKey() : $('api-key').value.trim();
    if (!apiKey) { $('consent-msg').textContent = 'Please paste your Presage API key first.'; return; }
    app.telemetry = $('opt-telemetry').checked;
    source = new PresageSource({ apiKey, enableTelemetry: app.telemetry });
  } else {
    source = new SimulatedSource({
      getTargetRate: () => (app.s && app.s.phase === 'session' ? app.s.guide : 13.5),
      getRingValue: () => (app.s && app.s.phase === 'session' && app.s.pacerHist.length ? app.s.pacerHist[app.s.pacerHist.length - 1].v : null),
    });
  }
  app.showNumbers = $('opt-numbers').checked;
  if ($('opt-sound').checked) sound.enable().catch((e) => console.warn('audio', e)); // inside the click gesture
  if ($('opt-voice').checked) voice.enable(); else voice.disable();
  setSoundButton();
  app.source = source;
  app.s = newSession(kind);

  const live = kind === 'presage';
  for (const id of ['cal-source', 's-source']) {
    $(id).textContent = live ? 'Live · SmartSpectra' : 'Simulated · no camera';
    $(id).className = live ? 'chip' : 'chip sim';
  }
  $('trace-src').textContent = live ? 'SmartSpectra chest trace' : 'Simulated signal';
  camView.setSimulated(!live);
  camLive.setSimulated(!live);
  $('btn-hide-video').hidden = !live;
  $('btn-cal-anyway').hidden = true;
  resetChecklist();
  $('cam-hint').classList.remove('show');
  show('calibrate');
  voice.say('check_start', { cooldown: 0, interrupt: true });

  wire(source);
  if (live) {
    const access = await window.breathgarden.cameraAccess().catch(() => 'unknown');
    if (access === 'denied' || access === 'restricted') return showError('Camera blocked by macOS', CAMERA_BLOCKED_HELP);
  }
  try {
    await source.start();
  } catch (err) {
    showError(`Couldn’t start (${err.code ?? 'Error'})`, err.message || String(err));
  }
}

const CAMERA_BLOCKED_HELP =
  'macOS isn’t giving this app any camera frames. Open System Settings › Privacy & Security › Camera and allow ' +
  'the app you launched Breathgarden from (for example Terminal). Then quit and reopen Breathgarden from that app.';

function setCameraOn(on) { $('cal-cam').hidden = !on; $('s-cam').hidden = !on; }

function wire(source) {
  const mine = () => source === app.source && app.s && !app.s.ended;
  source.on('status', (st) => { if (!mine()) return; app.s.status = st; setCameraOn(source.kind === 'presage' && (st === 'starting' || st === 'running')); });
  source.on('stream', (stream) => {
    if (!mine()) return;
    camView.attach(stream);
    camLive.attach(stream);
    setCameraOn(true);
    watchForFrames($('cam-base'), source);
  });
  source.on('hint', (h) => {
    if (!mine()) return;
    const s = app.s, now = performance.now();
    s.seenHint = true;
    if (h.ok) { if (s.okSince == null) s.okSince = now; }
    else {
      s.okSince = null;
      if (h.group) { s.groupBad[h.group] = now; s.groupMsg[h.group] = h.message; }
      if (s.hintOk) s.hintBadSince = now;
    }
    if (h.ok) s.badSince = null; else if (s.hintOk || s.badSince == null) s.badSince = now;
    s.hintOk = h.ok;
    s.hintName = h.name;
    s.hintMsg = h.message;
  });
  source.on('breath', (samples) => {
    if (!mine()) return;
    const s = app.s, b = s.breath;
    // Map SDK sample time to our clock. The smallest (arrival - sample time) seen
    // is the best estimate; it relaxes slowly in case the clocks drift.
    const off = performance.now() / 1000 - samples[samples.length - 1].t;
    s.clockOff = s.clockOff == null ? off : Math.min(off, s.clockOff + 0.002);
    for (const p of samples) b.push(p);
    const tEnd = b[b.length - 1].t;
    while (b.length && b[0].t < tEnd - 40) b.shift();
  });
  source.on('vitals', (v) => {
    if (!mine()) return;
    Object.assign(app.s.vitals, v);
    if (v.hrv && v.hrv.stable && app.s.hrvBase == null) app.s.hrvBase = v.hrv.rmssd;
  });
  source.on('talking', (on) => { if (mine() && on) app.s.talkingUntil = performance.now() + 1500; });
  source.on('notice', (n) => { if (mine() && n === 'talking-unavailable') app.s.talkingAvailable = false; });
  source.on('error', (e) => { if (mine()) showError(`Couldn’t start (${e.name})`, e.message); });
}

// A "live" camera track can deliver zero frames when macOS gives camera access
// to a different parent app. Catch that quickly instead of waiting 30 s.
function watchForFrames(video, source) {
  const deadline = performance.now() + 7000;
  const check = () => {
    if (source !== app.source || !app.s || app.s.ended) return;
    if (video.videoWidth > 0) return;
    if (performance.now() > deadline) { source.stop().catch(() => {}); showError('No camera frames', CAMERA_BLOCKED_HELP); return; }
    setTimeout(check, 500);
  };
  check();
}

function showError(title, msg) {
  $('error-title').textContent = title;
  $('error-msg').textContent = msg;
  $('error').hidden = false;
  setCameraOn(false);
  $('btn-error-back').focus();
}
$('btn-error-back').addEventListener('click', async () => { $('error').hidden = true; await teardown(); enterConsent(); });

// ------------------------------------------------------------ Calibrate ----
const READY_TEXT = { face: 'Found you.', frame: 'Face and shoulders are in frame.', light: 'Light looks good.', still: 'Nice and steady.' };
function resetChecklist() {
  for (const li of $('checks').children) { li.dataset.state = 'pending'; li.querySelector('.d').textContent = 'Checking…'; }
  $('ready-bar').style.width = '0%';
  $('ready-count').textContent = '0 of 4 ready';
  $('ready-note').textContent = 'Opens automatically';
}

function updateChecklist(now) {
  const s = app.s;
  const groups = ['face', 'frame', 'light', 'still'];
  const faceReady = s.seenHint && now - s.groupBad.face > 2500;
  let ready = 0;
  for (const li of $('checks').children) {
    const g = li.dataset.group;
    let state = 'pending', text = 'Checking…';
    if (s.seenHint) {
      if (now - s.groupBad[g] < 2500) { state = 'fix'; text = s.groupMsg[g] || 'Adjusting…'; }
      else if (g === 'face' || faceReady) {
        if (g === 'still' && s.status !== 'running') { state = 'pending'; text = 'Warming up…'; }
        else { state = 'ready'; text = READY_TEXT[g]; }
      }
    }
    if (state === 'ready') ready++;
    if (li.dataset.state !== state) li.dataset.state = state;
    const d = li.querySelector('.d'); if (d.textContent !== text) d.textContent = text;
  }
  $('ready-bar').style.width = `${(ready / groups.length) * 100}%`;
  $('ready-count').textContent = `${ready} of 4 ready`;

  const hint = $('cam-hint');
  const showHint = s.seenHint && !s.hintOk && s.hintMsg;
  hint.textContent = showHint ? s.hintMsg : ''; hint.classList.toggle('show', !!showHint);

  if (now - s.calStart > 15000 && s.status === 'running') $('btn-cal-anyway').hidden = false;
  if (ready === 4 && s.okSince && now - s.okSince > 1500 && s.status === 'running' && s.phase === 'calibrate') {
    s.phase = 'opening';
    voice.say('ready', { cooldown: 0, interrupt: true });
    $('ready-note').textContent = 'Opening the garden…';
    setTimeout(() => { if (app.s === s && !s.ended) startSession(); }, 900);
  }
}
$('btn-cal-anyway').addEventListener('click', () => startSession());
$('btn-cal-back').addEventListener('click', async () => { await teardown(); enterConsent(); });
$('btn-cal-off').addEventListener('click', async () => { await teardown(); enterConsent('Camera turned off.'); });

// -------------------------------------------------------------- Session ----
function startSession() {
  const s = app.s; if (!s || s.ended || s.phase === 'session') return;
  s.phase = 'session';
  s.started = performance.now();
  // Adaptive guide: start at the breathing rate we just measured and glide
  // down to the chosen pace, so the guide meets you where you are.
  const cycles = breathCycles(s.breath, 3);
  const measured = s.vitals.breathingRate || (cycles.length ? 60 / (cycles.reduce((a, b) => a + b, 0) / cycles.length) : 12);
  s.pacerFrom = clamp(Math.round(measured * 2) / 2, app.pace, 14);
  s.guide = s.pacerFrom;
  s.guideMode = 'start';
  s.poorFor = 0;
  s.guideSlots = [];
  s.pacerPhase = 0;
  $('blossoms').textContent = '';
  $('time-total').textContent = fmt(app.minutes * 60);
  buildAxis();
  for (const id of ['pr-note', 'br-note']) $(id).textContent = '';
  show('session');
  s.cues = 6; // speak "Breathe in / And out" for the first three breaths
  setTimeout(() => { if (app.s === s && !s.ended) voice.say('start', { cooldown: 0, interrupt: true }); }, 1800);
}

// Spoken guidance for the framing check: a tip once a problem has lasted 2.5 s.
function voiceCalibrate(s, now) {
  if (!voice.on || s.hintOk || !s.badSince || now - s.badSince < 2500) return;
  const id = FIX_PHRASE[s.hintName];
  if (id) voice.say(id, { cooldown: 10, gap: 4 });
}

// Spoken guidance during the session, driven by the live signals.
function voiceSession(s, t, prevPhase, talking) {
  if (!voice.on) return;
  const total = app.minutes * 60;
  // The first three breaths, spoken on the ring's turns.
  if (s.cues > 0 && t > 6) {
    const a = prevPhase % 1, b = s.pacerPhase % 1;
    if (b < a) { if (voice.say('in', { cooldown: 0, gap: 0 })) s.cues--; }
    else if (a < 0.4 && b >= 0.4) { if (voice.say('out', { cooldown: 0, gap: 0 })) s.cues--; }
    return;
  }
  if (s.pendingSay && voice.say(s.pendingSay, { cooldown: 0, gap: 1 })) s.pendingSay = null;
  if (talking && !s.wasTalking) voice.say('talking', { cooldown: 20, gap: 1 });
  s.wasTalking = talking;
  if (!s.hintOk && performance.now() - s.hintBadSince > 3000) { voice.say('lost', { cooldown: 30 }); return; }
  if (s.guideMode !== s.lastSpokenMode) {
    const id = { easing: 'easing', easedBack: 'eased_back', holding: 'holding' }[s.guideMode];
    if (id && t > 20 && voice.say(id, { cooldown: 45 })) s.lastSpokenMode = s.guideMode;
    else if (!id) s.lastSpokenMode = s.guideMode;
  }
  if ((s.follow ?? 0) > 0.9 && s.syncSeconds > 20) voice.say('with_me', { cooldown: 75, gap: 8 });
  if (total >= 180 && t >= total / 2 && !s.saidHalf) s.saidHalf = voice.say('halfway', { cooldown: 0 });
  if (total >= 180 && t >= total - 60 && !s.saidMinute) s.saidMinute = voice.say('one_minute', { cooldown: 0 });
}

function buildAxis() {
  const total = app.minutes * 60, ax = $('rate-axis');
  ax.textContent = '';
  for (let i = 0; i < 4; i++) { const sp = document.createElement('span'); sp.textContent = fmt((total * i) / 4); ax.appendChild(sp); }
  const end = document.createElement('span'); end.textContent = fmt(total); ax.appendChild(end);
}

function addFlower(s) {
  s.flowers++;
  s.flowerTimes.push(s.elapsed);
  sound.bell();
  const milestone = { 1: 'first_flower', 5: 'five_flowers', 10: 'ten_flowers' }[s.flowers];
  if (milestone && !voice.say(milestone, { cooldown: 0, gap: 2 })) s.pendingSay = milestone; // say it when the voice is free
  const box = $('blossoms');
  const colors = ['#F26A1F', '#F9A66C', '#F7B98F'];
  if (s.flowers <= 10) {
    box.insertAdjacentHTML('beforeend', blossomSvg(22 + (s.flowers % 3) * 6, colors[s.flowers % 3]));
  } else {
    let more = box.querySelector('.more');
    if (!more) { more = document.createElement('span'); more.className = 'more'; box.appendChild(more); }
    more.textContent = `+${s.flowers - 10}`;
  }
}

function sessionTick(now, dt) {
  const s = app.s;
  const t = (now - s.started) / 1000;
  s.elapsed = t;
  const guide = s.guide;
  const prevPhase = s.pacerPhase;
  s.pacerPhase += (dt * guide) / 60;
  const p = pacerShape(s.pacerPhase);
  s.pacerHist.push({ at: now / 1000, v: p.v });
  while (s.pacerHist.length && s.pacerHist[0].at < now / 1000 - 24) s.pacerHist.shift();
  const nb = normalizedBreath(s.breath);

  // "In step" = does your breath move with the ring? The correlation between the
  // live chest trace and the ring (15 s window). Tuned on a recorded live session:
  // |r| ≥ 0.49 counts as in step; free breathing passes ~4% of the time.
  // The SDK's breathing rate vs. the guide is a fallback while the window fills.
  if (now - (s.lastFollow || 0) > 500) { s.lastFollow = now; s.followRaw = followScore(s); }
  const f = s.followRaw || { r: 0, lag: 0 };
  const followS = clamp((Math.abs(f.r) - 0.3) / 0.35, 0, 1);
  const recent = breathCycles(s.breath, 2);
  s.nowRate = recent.length ? 60 / (recent.reduce((a, b) => a + b, 0) / recent.length) : null; // shown only
  const sdkRate = s.vitals.breathingRate;
  const rateS = sdkRate ? clamp(1 - Math.abs(sdkRate - guide) / 3, 0, 1) : 0;
  s.follow = (s.follow ?? 0) + (followS - (s.follow ?? 0)) * Math.min(1, dt * 1.5);
  let sync = Math.max(s.follow, rateS * 0.8);
  const talking = now < s.talkingUntil;
  const listening = s.hintOk && !talking;
  if (!s.hintOk) sync *= 0.3;
  if (talking) sync = 0;
  s.sync = sync;
  if (listening && sync > 0.55) {
    s.syncSeconds += dt; s.bank += dt * (0.6 + sync * 0.6);
    if (s.bank >= 10) { s.bank = 0; addFlower(s); }
  }

  orb.draw(dt, { breath: nb, pacer: p.v, listening });
  sound.update(dt, { breath: nb, pulse: s.vitals.pulseRate, hrv: s.vitals.hrv, hrvBase: s.hrvBase, sync, listening });
  if (nb != null && t - s.lastPrint >= 0.25) { s.lastPrint = t; s.print.push(nb); }
  $('guide-word').textContent = talking ? 'The garden is listening…' : s.vitals.breathingRate || s.breath.length > 30 ? `${p.word}…` : 'Listening to your breath…';
  const hint = $('s-hint');
  const hintMsg = talking ? 'Paused while you talk. It picks up again when you’re quiet.' : (!s.hintOk && now - s.hintBadSince > 1200 && s.hintMsg) || '';
  hint.textContent = hintMsg; hint.classList.toggle('show', !!hintMsg);

  // 1 Hz log + 5 s chart buckets.
  if (t - s.lastLog >= 1) {
    s.lastLog = t;
    s.log.push({ t, br: s.vitals.breathingRate, pr: s.vitals.pulseRate, hrv: s.vitals.hrv?.rmssd });
    const br = s.vitals.breathingRate;
    if (br) {
      const i = Math.floor(t / 5);
      const b = (s.buckets[i] ||= { min: br, max: br, n: 0 });
      b.min = Math.min(b.min, br); b.max = Math.max(b.max, br); b.n++;
    }
  }

  const slots = Math.ceil((app.minutes * 60) / 5);
  updateGuide(s, dt, t, listening, app.pace);
  // Chart: the guide's real path so far, then where it's heading if you keep following.
  const cur = Math.floor(t / 5);
  s.guideSlots[cur] = s.guide;
  const line = Array.from({ length: slots }, (_, i) => (i <= cur ? (s.guideSlots[i] ?? s.pacerFrom) : Math.max(app.pace, s.guide - GUIDE_DOWN * (i * 5 + 2.5 - t))));
  drawRateChart($('rate-chart'), { buckets: s.buckets, slots, pace: app.pace, guide: line });
  const gTxt = guideText(s, app.pace);
  if ($('guide-sub').textContent !== gTxt) $('guide-sub').textContent = gTxt;
  drawTrace($('trace'), s.breath);
  camLive.draw({ pulse: listening ? s.vitals.pulseRate : null, breathing: s.vitals.breathingRate, breath: nb, showNumbers: app.showNumbers });

  const cycles = breathCycles(s.breath);
  const cy = $('cycles');
  const html = cycles.map((c) => `${c.toFixed(1)} s`).join('|');
  if (cy.dataset.v !== html) {
    cy.dataset.v = html; cy.textContent = '';
    for (const c of cycles) { const sp = document.createElement('span'); sp.textContent = `${c.toFixed(1)} s`; cy.appendChild(sp); }
  }

  const v = s.vitals, num = app.showNumbers;
  $('sync-val').textContent = String(Math.round(sync * 100));
  $('flower-val').textContent = String(s.flowers);
  $('rate-big-v').textContent = num && v.breathingRate ? v.breathingRate.toFixed(1) : v.breathingRate ? '•' : '–';
  $('pr-val').textContent = num && v.pulseRate ? String(Math.round(v.pulseRate)) : v.pulseRate ? '•' : '–';
  $('br-val').textContent = num && v.breathingRate ? v.breathingRate.toFixed(1) : v.breathingRate ? '•' : '–';
  $('hrv-val').textContent = num && v.hrv ? String(Math.round(v.hrv.rmssd)) : v.hrv ? '•' : '–';
  $('pr-note').textContent = v.pulseRate ? (num ? 'Live' : 'Live · numbers hidden') : 'Reading…';
  $('br-note').textContent = v.breathingRate ? (num ? 'Live' : 'Live · numbers hidden') : 'Reading…';
  $('hrv-note').textContent = v.hrv ? `RMSSD · ${v.hrv.stable ? 'steady' : 'settling'}` : 'RMSSD · reading…';
  $('time-left').textContent = fmt(Math.max(0, app.minutes * 60 - t));

  voiceSession(s, t, prevPhase, talking);
  if (t >= app.minutes * 60) finish();
}

// Hide your face but keep the overlay (and the Camera on badge): the camera is still on.
$('btn-hide-video').addEventListener('click', () => {
  const hidden = $('camlive').classList.toggle('video-hidden');
  $('btn-hide-video').textContent = hidden ? 'Show video' : 'Hide video';
  $('btn-hide-video').setAttribute('aria-pressed', String(hidden));
});
$('btn-end').addEventListener('click', () => finish());
addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.screen === 'session') finish(); });

// ------------------------------------------------------------- Main loop ---
let lastTick = performance.now();
function tick(now) {
  const dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
  const s = app.s;
  if (s && !s.ended) {
    if (app.screen === 'calibrate') {
      updateChecklist(now);
      voiceCalibrate(app.s, now);
      camView.draw({ pulse: s.vitals.pulseRate, breathing: s.vitals.breathingRate, breath: normalizedBreath(s.breath), showNumbers: app.showNumbers });
    } else if (app.screen === 'session') {
      sessionTick(now, dt);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// -------------------------------------------------------------- Finish -----
async function teardown() {
  const src = app.source; app.source = null;
  if (app.s) app.s.ended = true;
  if (src) { await src.stop(); src.destroy(); }
  camView.clear();
  camLive.clear();
  sound.disable(); setSoundButton();
  voice.stop();
  setCameraOn(false);
}

async function finish() {
  const s = app.s; if (!s || s.ended) return;
  await teardown();
  renderSummary(s);
  show('summary');
  // Spoken close: end of session, then the flower count (no readings are ever spoken).
  if (voice.on) {
    voice.say('end', { cooldown: 0, interrupt: true });
    const n = s.flowers > 20 ? 'summary_many' : `summary_${s.flowers}`;
    setTimeout(() => { if (app.screen === 'summary') voice.say(n, { cooldown: 0, interrupt: true }); }, 4800);
    setTimeout(() => { if (app.screen === 'summary') voice.say('goodbye', { cooldown: 0, interrupt: true }); }, 7600);
  }
}

function avg(xs) { const v = xs.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

function renderSummary(s) {
  const title = $('sum-title'); title.textContent = '';
  const soft = document.createElement('span'); soft.className = 'unit';
  if (s.flowers === 0) {
    title.append('Your garden is sprouting. ');
    soft.textContent = 'Slow, steady breaths grow flowers.';
  } else {
    title.append(`${cap(word(s.flowers))} ${s.flowers === 1 ? 'flower' : 'flowers'} `);
    const hr = new Date().getHours();
    soft.textContent = hr < 5 || hr >= 21 ? 'tonight.' : hr < 12 ? 'this morning.' : hr < 17 ? 'this afternoon.' : 'this evening.';
  }
  title.append(soft);
  $('st-flowers').textContent = String(s.flowers);
  $('st-sync').textContent = fmt(s.syncSeconds);
  $('st-total').textContent = fmt(s.elapsed);
  s.postcard = {
    flowers: s.flowers, minutes: Math.max(1, Math.round(s.elapsed / 60)),
    date: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    print: s.print, flowerTimes: s.flowerTimes, duration: s.elapsed,
  };
  drawPostcard($('postcard'), s.postcard);

  const span = Math.min(60, s.elapsed / 3);
  $('trend-note').textContent = span >= 59 ? 'first minute vs last minute' : 'start of session vs end';
  const first = s.log.filter((r) => r.t <= span + 5), last = s.log.filter((r) => r.t >= s.elapsed - span);
  const box = $('trends'); box.textContent = '';
  if (s.kind === 'simulated') {
    const n = document.createElement('p'); n.className = 'fine'; n.textContent = 'These numbers come from the simulated signal, not from you.'; box.appendChild(n);
  }
  let rows = 0;
  for (const [label, key, dp, unit] of [['Breathing rate', 'br', 1, '/min'], ['Pulse rate', 'pr', 0, 'bpm'], ['HRV (RMSSD)', 'hrv', 0, 'ms']]) {
    const a = avg(first.map((r) => r[key])), b = avg(last.map((r) => r[key]));
    if (a == null || b == null) continue;
    rows++;
    const row = document.createElement('div'); row.className = 'trend';
    const l = document.createElement('span'); l.className = 'muted'; l.textContent = label;
    const bars = document.createElement('div'); bars.className = 'bars';
    const vals = s.log.map((r) => r[key]).filter((x) => x != null);
    const nB = 14, lo = Math.min(...vals), hi = Math.max(...vals), rng = hi - lo || 1;
    for (let i = 0; i < nB; i++) {
      const chunk = vals.slice(Math.floor((i * vals.length) / nB), Math.floor(((i + 1) * vals.length) / nB));
      const m = avg(chunk); const bar = document.createElement('i');
      bar.style.height = `${8 + (m == null ? 0 : ((m - lo) / rng) * 26)}px`;
      bar.style.opacity = String(0.35 + 0.65 * (i / (nB - 1)));
      bars.appendChild(bar);
    }
    const v = document.createElement('span'); v.className = 'v';
    v.append(`${a.toFixed(dp)} `); const arrow = document.createElement('small'); arrow.textContent = '→ '; v.append(arrow, `${b.toFixed(dp)} `);
    const u = document.createElement('small'); u.textContent = unit; v.append(u);
    row.append(l, bars, v); box.appendChild(row);
  }
  if (rows && !last.some((r) => r.hrv != null)) {
    const n = document.createElement('p'); n.className = 'fine'; n.textContent = 'HRV needs about two minutes of steady signal, so it isn’t shown for this session.'; box.appendChild(n);
  }
  if (!rows) { const n = document.createElement('p'); n.className = 'fine'; n.textContent = 'Not enough signal for trends this time. Try a longer session in good light.'; box.appendChild(n); }
  $('sum-msg').textContent = '';
}

$('btn-save').addEventListener('click', () => {
  // User-initiated: the postcard holds only the picture, date, minutes and flower count.
  $('postcard').toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `breathgarden-postcard-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('sum-msg').textContent = 'Postcard saved. It contains only the picture, no readings.';
  }, 'image/png');
});

function forget() {
  app.s = null;
  $('trends').textContent = '';
  $('blossoms').textContent = '';
  const ctx = $('postcard').getContext('2d'); ctx.clearRect(0, 0, $('postcard').width, $('postcard').height);
}
$('btn-again').addEventListener('click', () => { forget(); enterConsent(); });
$('btn-forget').addEventListener('click', () => { forget(); enterConsent('Session forgotten. Nothing was kept.'); });

// Debug snapshot (only with --bg-debug): lets a developer read the live numbers
// over DevTools while tuning. Contains no frames; nothing is stored.
function debugSnapshot() {
  const s = app.s; if (!s) return null;
  const t = s.started ? (performance.now() - s.started) / 1000 : 0;
  return {
    source: s.kind, screen: app.screen, status: s.status, t: +t.toFixed(1), hintOk: s.hintOk, hint: s.hintMsg,
    guide: s.started ? +s.guide.toFixed(2) : null, guideMode: s.guideMode ?? null, sdkRate: s.vitals.breathingRate ?? null,
    nowRate: s.nowRate ? +s.nowRate.toFixed(2) : null, r: s.followRaw ? +s.followRaw.r.toFixed(2) : null,
    lag: s.followRaw ? s.followRaw.lag : null, follow: +(s.follow ?? 0).toFixed(2), sync: +(s.sync ?? 0).toFixed(2),
    pulse: s.vitals.pulseRate ?? null, traceN: s.breath.length, flowers: s.flowers, syncSeconds: +s.syncSeconds.toFixed(1),
    talking: performance.now() < s.talkingUntil, talkingAvailable: s.talkingAvailable, soundOn: sound.on, printN: s.print.length,
    voiceOn: voice.on, voiceSource: voice.source, voiceLog: voice.log.slice(-6),
  };
}

// ---------------------------------------------------------------- Boot -----
(async () => {
  if (window.breathgarden) {
    try { Object.assign(app.config, await window.breathgarden.getConfig()); } catch (e) { console.warn(e); }
    voice.setClips(app.config.voiceClips);
  } else {
    await voice.loadManifestOverHttp();
  }
  if (app.config.debug) {
    window.__bgDebug = debugSnapshot;
    // Simulated mode only: pretend to talk, to check the pause behaviour.
    window.__bgSimTalk = () => { if (app.source && app.source.kind === 'simulated') app.source.emit('talking', true); };
    // Draw a postcard from a synthetic noisy breath print, to check the hills look right.
    window.__bgPostcardTest = () => {
      const print = []; let seed = 3; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i = 0; i < 720; i++) print.push(Math.min(1, Math.max(0, 0.5 + 0.45 * Math.sin(i / 4) + (rnd() - 0.5) * 0.5)));
      drawPostcard($('postcard'), { flowers: 10, minutes: 3, date: '14 Nov', print, flowerTimes: [8, 20, 31, 45, 58, 70, 84, 95, 110, 130], duration: 180 });
      show('summary');
    };
    window.__bgSimFollow = (on) => { if (app.source && app.source.kind === 'simulated') app.source.follow = on; };
  }
  enterConsent();
})();
