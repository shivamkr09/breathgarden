// core.js — the pure logic behind Breathgarden's live loop (no DOM), so it can be unit-tested.
'use strict';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeIO = (x) => (1 - Math.cos(Math.PI * clamp(x, 0, 1))) / 2;

// Closed-loop guide. It starts at your measured breathing rate, then:
//   following well    → eases toward your chosen pace (3 breaths/min per minute)
//   partly following  → eases very slowly
//   not following     → holds; after 8 s, if you're breathing faster than the
//                       guide, it eases back up toward your pace (never above
//                       where you started).
// Tuned on a live run where a fixed glide to 6/min outpaced the person, who then
// sped up and stopped following.
const GUIDE_DOWN = 0.05, GUIDE_DOWN_SLOW = 0.015, GUIDE_UP = 0.06;
function updateGuide(s, dt, t, listening, pace) {
  if (t < 15 || !listening) { if (t < 15) s.guideMode = 'start'; return; } // the follow window is still filling
  const f = s.follow ?? 0, user = s.vitals.breathingRate;
  if (f >= 0.55) {
    s.poorFor = 0;
    s.guide = Math.max(pace, s.guide - GUIDE_DOWN * dt);
    s.guideMode = s.guide > pace + 0.05 ? 'easing' : 'target';
  } else if (f >= 0.25) {
    s.poorFor = 0;
    s.guide = Math.max(pace, s.guide - GUIDE_DOWN_SLOW * dt);
    s.guideMode = 'slow';
  } else {
    s.poorFor += dt;
    const up = user ? Math.min(s.guide + GUIDE_UP * dt, user - 1, s.pacerFrom) : s.guide;
    if (s.poorFor > 8 && up > s.guide) { s.guide = up; s.guideMode = 'easedBack'; }
    else if (s.guideMode !== 'easedBack') s.guideMode = 'holding';
  }
}

function guideText(s, pace) {
  const g = s.guide.toFixed(1);
  switch (s.guideMode) {
    case 'start': return `Guide ${g} /min, matched to your breathing.`;
    case 'easing': return `Guide ${g} /min, easing toward ${pace}.`;
    case 'slow': return `Guide ${g} /min, easing gently while you settle.`;
    case 'holding': return `Holding at ${g} /min until you settle in.`;
    case 'easedBack': return `Eased back to ${g} /min to match you.`;
    default: return `Guide ${pace} /min. Match the bloom to the ring.`;
  }
}
// Pacer shape: inhale 40% of the cycle, exhale 60% (a longer out-breath feels calmer).
// The phase is integrated so the ring never jumps when the guide rate changes.
function pacerShape(phase) {
  const u = phase % 1;
  return u < 0.4 ? { v: easeIO(u / 0.4), word: 'Breathe in' } : { v: 1 - easeIO((u - 0.4) / 0.6), word: 'And out' };
}

function normalizedBreath(buf) {
  if (buf.length < 8) return null;
  const tEnd = buf[buf.length - 1].t;
  let lo = Infinity, hi = -Infinity;
  for (const p of buf) if (p.t >= tEnd - 15) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  const r = hi - lo;
  return r > 1e-6 ? clamp((buf[buf.length - 1].v - lo) / r, 0, 1) : 0.5;
}

function pearson(xs, ys) {
  const n = xs.length; let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * How closely your chest movement follows the guide ring: the best correlation
 * between the last 15 s of the SmartSpectra chest trace and the ring, allowing
 * 0–4 s for your reaction time and the SDK's processing delay. The sign is
 * ignored because the trace's polarity depends on camera and posture.
 */
function followScore(s) {
  const b = s.breath, hist = s.pacerHist;
  if (s.clockOff == null || b.length < 20 || hist.length < 2) return { r: 0, lag: 0 };
  const win = 15, step = 0.2, end = b[b.length - 1].t + s.clockOff;
  const tr = [];
  for (let x = end - win, j = 0; x <= end; x += step) {
    const tt = x - s.clockOff;
    while (j < b.length - 1 && b[j + 1].t <= tt) j++;
    if (b[j].t <= tt) tr.push({ x, v: b[j].v });
  }
  // Remove slow drift (shifting in your seat) with a linear fit before comparing.
  if (tr.length > 2) {
    const n = tr.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of tr) { sx += p.x; sy += p.v; sxx += p.x * p.x; sxy += p.x * p.v; }
    const den = n * sxx - sx * sx, slope = den ? (n * sxy - sx * sy) / den : 0, icpt = (sy - slope * sx) / n;
    for (const p of tr) p.v -= slope * p.x + icpt;
  }
  if (tr.length < 50) return { r: 0, lag: 0 };
  const ringAt = (x) => {
    if (x < hist[0].at) return null;
    let lo = 0, hi = hist.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (hist[m].at <= x) lo = m; else hi = m; }
    return hist[lo].v;
  };
  let best = { r: 0, lag: 0 };
  for (let L = 0; L <= 4; L += 0.25) {
    const xs = [], ys = [];
    for (const p of tr) { const v = ringAt(p.x - L); if (v != null) { xs.push(p.v); ys.push(v); } }
    if (xs.length < 50) continue;
    const r = pearson(xs, ys);
    if (Math.abs(r) > Math.abs(best.r)) best = { r, lag: L };
  }
  return best;
}


module.exports = { clamp, easeIO, GUIDE_DOWN, GUIDE_DOWN_SLOW, GUIDE_UP, updateGuide, guideText, pacerShape, normalizedBreath, pearson, followScore };
