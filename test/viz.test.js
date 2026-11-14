'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.matchMedia = () => ({ matches: false });
const { breathCycles } = require('../src/viz');
const { rng } = require('./helpers');

test('breathCycles: measures breath length within ~15% across paces, noise and drift', () => {
  for (const [rate, noise, drift] of [[6, 0.3, 1.5], [8, 0.6, 2], [12, 0.5, 1.5], [16, 0.4, 1]]) {
    const rand = rng(rate), s = [];
    for (let t = 0; t < 40; t += 1 / 30) { const ph = 2 * Math.PI * t * rate / 60; s.push({ t, v: Math.sin(ph) + 0.15 * Math.sin(2 * ph + 1) + drift * t / 40 + (rand() - 0.5) * noise * 2 }); }
    const c = breathCycles(s);
    assert.ok(c.length >= 2, `rate ${rate}: found ${c.length}`);
    const mean = c.reduce((a, b) => a + b, 0) / c.length, truth = 60 / rate;
    assert.ok(Math.abs(mean - truth) / truth < 0.15, `rate ${rate}: ${mean.toFixed(2)}s vs ${truth.toFixed(2)}s`);
  }
});
