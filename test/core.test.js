'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pearson, followScore, updateGuide, guideText, pacerShape, normalizedBreath } = require('../src/core');
const { rng } = require('./helpers');

// Build a session-like object: a chest trace (SDK time) and the ring history (app time).
function makeSession({ follow, ownRate = 14, guideRate = 9, lag = 1.3, noise = 0.6, seed = 7 }) {
  const rand = rng(seed);
  const clockOff = 100; // app time = sdk time + 100 s
  const breath = [], pacerHist = [];
  let ph = 0;
  for (let t = 0; t <= 30; t += 1 / 60) { ph += (guideRate / 60) / 60; pacerHist.push({ at: t + clockOff, v: pacerShape(ph).v }); }
  const ringAt = (at) => { const i = Math.max(0, Math.min(pacerHist.length - 1, Math.round((at - clockOff) * 60))); return pacerHist[i].v; };
  for (let t = 5; t <= 30; t += 1 / 30) {
    const v = follow ? ringAt(t + clockOff - lag) - 0.5 : 0.5 * Math.sin(2 * Math.PI * t * ownRate / 60);
    breath.push({ t, v: v + 0.3 * (t / 30) + (rand() - 0.5) * noise });
  }
  return { breath, pacerHist, clockOff };
}

test('pearson: identical, inverted and flat series', () => {
  const xs = [1, 2, 3, 4, 5];
  assert.ok(Math.abs(pearson(xs, xs) - 1) < 1e-9);
  assert.ok(Math.abs(pearson(xs, xs.map((x) => -x)) + 1) < 1e-9);
  assert.equal(pearson(xs, [2, 2, 2, 2, 2]), 0);
});

test('followScore: someone following the ring scores high, at about their reaction lag', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { r, lag } = followScore(makeSession({ follow: true, seed }));
    assert.ok(Math.abs(r) > 0.8, `|r| ${r}`);
    assert.ok(lag >= 0.75 && lag <= 2, `lag ${lag}`);
  }
});

test('followScore: breathing freely at a different pace rarely counts as in step', () => {
  let passes = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { r } = followScore(makeSession({ follow: false, ownRate: 13 + (seed % 5), guideRate: 7 + (seed % 3), seed }));
    if (Math.abs(r) >= 0.49) passes++;
  }
  assert.ok(passes <= 4, `${passes}/40 free-breathing windows passed`);
});

test('followScore: not enough data yet returns zero', () => {
  assert.deepEqual(followScore({ breath: [], pacerHist: [], clockOff: null }), { r: 0, lag: 0 });
});

function guideState(extra = {}) {
  return { guide: 12, pacerFrom: 12, guideMode: 'start', poorFor: 0, follow: 0, vitals: {}, ...extra };
}

test('guide: holds during the first 15 s and while framing is not OK', () => {
  const s = guideState({ follow: 1 });
  updateGuide(s, 1, 10, true, 6); assert.equal(s.guide, 12); assert.equal(s.guideMode, 'start');
  updateGuide(s, 1, 30, false, 6); assert.equal(s.guide, 12);
});

test('guide: eases toward the target while you follow, never below it', () => {
  const s = guideState({ follow: 1 });
  for (let t = 15; t < 400; t++) updateGuide(s, 1, t, true, 6);
  assert.equal(s.guide, 6);
  assert.equal(s.guideMode, 'target');
});

test('guide: partly following eases slowly', () => {
  const a = guideState({ follow: 1 }), b = guideState({ follow: 0.4 });
  for (let t = 15; t < 35; t++) { updateGuide(a, 1, t, true, 6); updateGuide(b, 1, t, true, 6); }
  assert.ok(b.guide < 12 && b.guide > a.guide);
  assert.equal(b.guideMode, 'slow');
});

test('guide: when you stop following and breathe faster, it holds, then eases back up (capped)', () => {
  const s = guideState({ guide: 8, pacerFrom: 12, follow: 0, vitals: { breathingRate: 13 } });
  for (let t = 15; t < 20; t++) updateGuide(s, 1, t, true, 6);
  assert.equal(s.guide, 8); assert.equal(s.guideMode, 'holding');
  for (let t = 20; t < 200; t++) updateGuide(s, 1, t, true, 6);
  assert.equal(s.guideMode, 'easedBack');
  assert.ok(Math.abs(s.guide - 12) < 1e-9, `capped at where you started: ${s.guide}`);
});

test('guide text explains what the guide is doing', () => {
  assert.match(guideText({ guide: 10.4, guideMode: 'easedBack' }, 6), /Eased back to 10\.4/);
  assert.match(guideText({ guide: 9, guideMode: 'easing' }, 6), /easing toward 6/);
  assert.match(guideText({ guide: 9, guideMode: 'holding' }, 6), /Holding at 9\.0/);
});

test('pacer shape: in for 40% of the cycle, out for 60%', () => {
  assert.equal(pacerShape(0.2).word, 'Breathe in');
  assert.equal(pacerShape(0.7).word, 'And out');
  assert.ok(Math.abs(pacerShape(0.4).v - 1) < 1e-9);
  assert.ok(Math.abs(pacerShape(1.0).v) < 1e-9);
});

test('normalizedBreath: 0..1 over the last 15 s, null without data', () => {
  assert.equal(normalizedBreath([]), null);
  const buf = Array.from({ length: 100 }, (_, i) => ({ t: i / 10, v: Math.sin(i / 5) }));
  const v = normalizedBreath(buf);
  assert.ok(v >= 0 && v <= 1);
});
