// viz.js — canvas drawing for the session and summary screens.
'use strict';

const TAU = Math.PI * 2;
const ACCENT = [242, 106, 31];
const rgba = (a) => `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${a})`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Size a canvas to its CSS box at device pixel ratio; returns { ctx, w, h }. */
function fit(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// ---------------------------------------------------------------------------
// The breath orb: its size follows your chest; the dotted ring is the guide.
class Orb {
  constructor(canvas) { this.c = canvas; this.s = { breath: 0.5, pacer: 0.5, presence: 0.4 }; }
  draw(dt, { breath, pacer, listening }) {
    const s = this.s;
    s.breath = lerp(s.breath, breath ?? 0.5, 1 - Math.exp(-dt * 6));
    s.pacer = lerp(s.pacer, pacer, 1 - Math.exp(-dt * 12));
    s.presence = lerp(s.presence, listening ? 1 : 0.45, 1 - Math.exp(-dt * 2));
    const { ctx, w, h } = fit(this.c);
    const m = Math.min(w * 0.5, h);
    const cx = w * 0.66, cy = h * 0.5;
    const base = m * 0.24, amp = m * 0.1;
    const t = performance.now() / 1000, motion = reducedMotion() ? 0 : 1;

    const r = base * 0.8 + amp * 1.1 * s.breath;
    const glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.1);
    glow.addColorStop(0, rgba(0.24 * s.presence)); glow.addColorStop(1, rgba(0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, r * 2.1, 0, TAU); ctx.fill();

    ctx.save();
    ctx.shadowColor = rgba(0.3 * s.presence); ctx.shadowBlur = 50; ctx.shadowOffsetY = 22;
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * TAU;
      const wob = 1 + motion * (0.025 * Math.sin(a * 4 + t * 0.8) + 0.018 * Math.sin(a * 3 - t * 0.5));
      const x = cx + Math.cos(a) * r * wob, y = cy + Math.sin(a) * r * wob;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const body = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.36, r * 0.05, cx, cy, r * 1.05);
    body.addColorStop(0, '#FFE3CF'); body.addColorStop(0.38, '#F9A66C'); body.addColorStop(0.72, '#F26A1F'); body.addColorStop(1, '#B9480C');
    ctx.globalAlpha = 0.55 + 0.45 * s.presence;
    ctx.fillStyle = body; ctx.fill();
    ctx.restore();

    const pr = base + amp * s.pacer;
    ctx.strokeStyle = rgba(0.55); ctx.lineWidth = 2.2; ctx.setLineDash([1.5, 7]); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
}

// ---------------------------------------------------------------------------
// Breathing rate as dot-capsules: one capsule per 5 s bucket (min..max).
function drawRateChart(canvas, { buckets, slots, pace, guide }) {
  const { ctx, w, h } = fit(canvas);
  const lo = 3, hi = 18;
  const y = (v) => h - ((clamp(v, lo, hi) - lo) / (hi - lo)) * h;
  // The guide line glides from your starting rate down to the chosen pace.
  const g = guide && guide.length ? guide : [pace, pace];
  ctx.strokeStyle = rgba(0.45); ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
  ctx.beginPath();
  g.forEach((v, i) => { const x = (i / (g.length - 1)) * w; i ? ctx.lineTo(x, y(v)) : ctx.moveTo(x, y(v)); });
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#C2410C'; ctx.font = '12px Figtree, system-ui, sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(`guide ${pace}`, w, y(g[g.length - 1]) - 6);
  const cw = Math.min(16, (w / slots) * 0.62);
  const step = slots > 1 ? (w - cw) / (slots - 1) : 0;
  buckets.forEach((b, i) => {
    if (!b || !b.n) return;
    const x = i * step, recency = slots > 1 ? i / (slots - 1) : 1;
    const top = y(b.max + 0.35), bot = y(b.min - 0.35);
    const a = 0.35 + 0.65 * recency;
    ctx.fillStyle = rgba(a);
    ctx.beginPath(); ctx.roundRect(x, top, cw, Math.max(cw, bot - top), cw / 2); ctx.fill();
    ctx.fillStyle = rgba(a * 0.4);
    ctx.beginPath(); ctx.arc(x + cw / 2, Math.min(h - cw / 2, bot + cw * 0.9 + (i % 3) * 4), cw * 0.34, 0, TAU); ctx.fill();
  });
}

// ---------------------------------------------------------------------------
// Live chest trace: last 30 s, older samples fade, newest point glows.
function drawTrace(canvas, samples) {
  const { ctx, w, h } = fit(canvas);
  if (samples.length < 2) return;
  const span = 30, t1 = samples[samples.length - 1].t, t0 = t1 - span;
  const vis = samples.filter((p) => p.t >= t0);
  let lo = Infinity, hi = -Infinity;
  for (const p of vis) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  const r = hi - lo || 1, padTop = h * 0.18, padBot = h * 0.16;
  const endX = w * 0.78;
  const X = (t) => ((t - t0) / span) * endX;
  const Y = (v) => h - padBot - ((v - lo) / r) * (h - padTop - padBot);
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h * 0.58); ctx.lineTo(w, h * 0.58); ctx.stroke();
  const grad = ctx.createLinearGradient(0, 0, endX, 0);
  grad.addColorStop(0, rgba(0.08)); grad.addColorStop(0.7, rgba(0.75)); grad.addColorStop(1, rgba(1));
  ctx.strokeStyle = grad; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  vis.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))));
  ctx.stroke();
  const last = vis[vis.length - 1], lx = X(last.t), ly = Y(last.v);
  ctx.fillStyle = rgba(0.18); ctx.beginPath(); ctx.arc(lx, ly, 13, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba(1); ctx.beginPath(); ctx.arc(lx, ly, 6, 0, TAU); ctx.fill();
}

/**
 * Seconds between recent breath peaks. The trace is smoothed (~0.3 s), then a
 * moving baseline (~10 s) is subtracted so slow drift can't hide peaks; peaks
 * are found with hysteresis (one per up-then-down swing).
 */
function breathCycles(samples, maxCount = 3) {
  if (samples.length < 60) return [];
  const avgWin = (arr, i, halfSecs) => {
    let s = 0, n = 0; const t0 = arr[i].t;
    for (let j = i; j >= 0 && t0 - arr[j].t <= halfSecs; j--) { s += arr[j].v; n++; }
    for (let j = i + 1; j < arr.length && arr[j].t - t0 <= halfSecs; j++) { s += arr[j].v; n++; }
    return s / n;
  };
  const sm = samples.map((p, i) => ({ t: p.t, v: avgWin(samples, i, 0.15) }));
  const hp = sm.map((p, i) => ({ t: p.t, v: p.v - avgWin(sm, i, 5) })); // ~10 s baseline ≥ one slow breath
  const sd = Math.sqrt(hp.reduce((a, p) => a + p.v * p.v, 0) / hp.length) || 1;
  // Hysteresis: a breath = rising above +0.35·sd, then falling below −0.35·sd.
  // Its peak is the highest point in between, so bumps on a flat top can't split it.
  const peaks = [];
  let high = false, best = null;
  for (const p of hp) {
    if (!high && p.v > sd * 0.35) { high = true; best = p; }
    else if (high) {
      if (p.v > best.v) best = p;
      if (p.v < -sd * 0.35) { peaks.push(best); high = false; best = null; }
    }
  }
  const d = [];
  for (let i = 1; i < peaks.length; i++) { const x = peaks[i].t - peaks[i - 1].t; if (x >= 2 && x < 20) d.push(x); }
  return d.slice(-maxCount);
}

// ---------------------------------------------------------------------------
function drawFlower(ctx, x, y, size, color) {
  ctx.strokeStyle = '#7FA37A'; ctx.lineWidth = size * 0.09; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y + size * 2.1); ctx.quadraticCurveTo(x - size * 0.15, y + size, x, y); ctx.stroke();
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    ctx.save(); ctx.translate(x, y); ctx.rotate((i / 5) * TAU);
    ctx.beginPath(); ctx.ellipse(0, -size * 0.42, size * 0.24, size * 0.42, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y, size * 0.2, 0, TAU); ctx.fill();
}

/** Resample a 0..1 series to n points, then smooth it with a moving average of width k. */
function resample(series, n, k) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * series.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * series.length) / n));
    let sum = 0; for (let j = a; j < b; j++) sum += series[j]; out.push(sum / (b - a));
  }
  return out.map((_, i) => { let sum = 0, c = 0; for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) { sum += out[j]; c++; } return sum / c; });
}

/**
 * The breath-print postcard. The front hill is drawn from your session's own
 * breathing pattern (the normalized chest trace, compressed left to right over
 * time), and each flower sits where you earned it. Shape only: no numbers.
 */
function drawPostcard(canvas, { flowers, minutes, date, print = [], flowerTimes = [], duration = 1 }) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#FCEBDD'); sky.addColorStop(0.55, '#F8D2B5'); sky.addColorStop(1, '#F3C29F');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  const sx = w * 0.74, sy = h * 0.2, sr = w * 0.075;
  const sun = ctx.createRadialGradient(sx - sr * 0.2, sy - sr * 0.2, sr * 0.1, sx, sy, sr);
  sun.addColorStop(0, '#FFF3E8'); sun.addColorStop(1, '#FBB98A');
  ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();

  const hasPrint = print.length >= 12;
  const N = 140;
  const base = (i) => h * 0.66 - Math.sin((i / (N - 1)) * Math.PI) * h * 0.05; // a gentle arc
  let front = null;
  if (hasPrint) {
    // Back hill: your breathing, heavily smoothed (the slow shape of the session).
    const back = resample(print, N, 9);
    ctx.fillStyle = '#E7DCC9';
    ctx.beginPath(); ctx.moveTo(0, h);
    back.forEach((v, i) => ctx.lineTo((i / (N - 1)) * w, base(i) - h * 0.06 - (v - 0.5) * h * 0.08));
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    // Front hill: each breath becomes a rolling hill.
    const fr = resample(print, N, 1);
    front = fr.map((v, i) => base(i) + (0.5 - v) * h * 0.07);
    ctx.fillStyle = '#DCE5D3';
    ctx.beginPath(); ctx.moveTo(0, h);
    front.forEach((y, i) => ctx.lineTo((i / (N - 1)) * w, y));
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(127,163,122,0.55)'; ctx.lineWidth = w * 0.004; ctx.lineJoin = 'round';
    ctx.beginPath(); front.forEach((y, i) => (i ? ctx.lineTo((i / (N - 1)) * w, y) : ctx.moveTo(0, y))); ctx.stroke();
  } else {
    ctx.fillStyle = '#DCE5D3';
    ctx.beginPath(); ctx.ellipse(w / 2, h * 1.02, w * 0.75, h * 0.42, 0, 0, TAU); ctx.fill();
  }
  const hillY = (x) => (front ? front[clamp(Math.round((x / w) * (N - 1)), 0, N - 1)] : h * 0.7);

  const colors = ['#F26A1F', '#F9A66C', '#F26A1F', '#F7B98F'];
  const n = Math.min(flowers, 30);
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  if (n === 0) {
    // No flowers yet: a row of sprouts, so the postcard is never empty.
    ctx.strokeStyle = '#7FA37A'; ctx.fillStyle = '#9DBF8F'; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const x = w * (0.14 + i * 0.145), y0 = Math.max(hillY(x) + h * 0.08, h * (0.8 + (i % 2) * 0.04)), sz = w * 0.03;
      ctx.lineWidth = sz * 0.18;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 - sz * 1.4); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - sz * 0.5, y0 - sz * 1.4, sz * 0.55, sz * 0.25, -0.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + sz * 0.5, y0 - sz * 1.6, sz * 0.55, sz * 0.25, 0.5, 0, TAU); ctx.fill();
    }
  }
  for (let i = 0; i < n; i++) {
    // Placed where it was earned in time, when we know; otherwise spread out.
    const tf = flowerTimes[i] != null ? clamp(flowerTimes[i] / Math.max(1, duration), 0.05, 0.95) : 0.08 + ((i * 0.37 + rnd() * 0.12) % 0.84);
    const x = w * tf + (rnd() - 0.5) * w * 0.02;
    const y = hillY(x) + h * (0.05 + (i % 3) * 0.055) + rnd() * h * 0.015;
    drawFlower(ctx, x, y, w * (0.042 + rnd() * 0.012), colors[i % colors.length]);
  }
  const label = `${date} · ${minutes} min · ${flowers} ${flowers === 1 ? 'flower' : 'flowers'}`;
  ctx.font = `500 ${Math.round(w * 0.028)}px Figtree, system-ui, sans-serif`;
  const tw = ctx.measureText(label).width, px = w * 0.04, py = h - w * 0.04, ph = w * 0.06;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath(); ctx.roundRect(px, py - ph, tw + ph * 0.8, ph, ph / 2); ctx.fill();
  ctx.fillStyle = '#1D1D1F'; ctx.textBaseline = 'middle';
  ctx.fillText(label, px + ph * 0.4, py - ph / 2);
}

/** A blossom for the session hero card, as an SVG string (static markup, no user data). */
function blossomSvg(size, color) {
  const petals = [0, 72, 144, 216, 288].map((r) => `<ellipse cx="0" cy="-9" rx="5" ry="9" transform="rotate(${r})" fill="${color}"/>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="-20 -20 40 40">${petals}<circle r="4.5" fill="#fff"/></svg>`;
}

module.exports = { Orb, drawRateChart, drawTrace, breathCycles, drawPostcard, blossomSvg, fit };
