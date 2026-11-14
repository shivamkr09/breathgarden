// sound.js — the sound garden. Your live signals, played as calm music.
//
//   chest trace  → a soft pad that swells as you breathe in and falls as you breathe out
//   pulse rate   → a very quiet low heartbeat at your measured tempo
//   HRV          → harmony: steadier readings open warmer chord tones
//   in step      → a gentle shimmer while you breathe with the ring
//   each flower  → a small bell
//
// Everything is synthesized with Web Audio in this window. No files, no network.
'use strict';

const NOTE = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const ROOT = 50;                       // D3
const BELLS = [74, 76, 79, 81, 83, 86]; // D major pentatonic, upper octave

class SoundGarden {
  constructor() { this.ctx = null; this.on = false; this.volume = 0.6; this._beat = 0; this._bell = 0; }

  /** Must be called from a click (browsers only allow audio after a gesture). */
  async enable() {
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.on = true;
    this._ramp(this.master.gain, this.volume * 0.5, 1.2);
  }

  disable() {
    this.on = false;
    if (this.ctx) this._ramp(this.master.gain, 0, 0.6);
  }

  setVolume(v) { this.volume = v; if (this.on && this.ctx) this._ramp(this.master.gain, v * 0.5, 0.2); }

  _ramp(param, value, secs) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + secs);
  }

  _build() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // A soft "room": a short feedback delay, lowpassed.
    this.space = ctx.createDelay(1.0); this.space.delayTime.value = 0.33;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1800;
    this.space.connect(tone).connect(fb).connect(this.space);
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    tone.connect(wet).connect(this.master);

    // Breath pad: root + fifth always, plus chord tones that HRV unlocks.
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 500; this.padFilter.Q.value = 0.7;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain); this.padGain.connect(this.master); this.padGain.connect(this.space);
    this.voices = [0, 7, 12, 16, 19, 23].map((semi, i) => {
      const g = ctx.createGain(); g.gain.value = i < 3 ? 0.28 : 0;
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = NOTE(ROOT + semi); o.detune.value = detune;
        o.connect(g); o.start();
      }
      g.connect(this.padFilter);
      return { g, semi };
    });

    // Shimmer while in step.
    this.shimmer = ctx.createGain(); this.shimmer.gain.value = 0;
    const so = ctx.createOscillator(); so.type = 'sine'; so.frequency.value = NOTE(ROOT + 31);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23; const lfoG = ctx.createGain(); lfoG.gain.value = 6;
    lfo.connect(lfoG).connect(so.detune); so.connect(this.shimmer); this.shimmer.connect(this.space); this.shimmer.connect(this.master);
    so.start(); lfo.start();
  }

  /**
   * Called every frame. breath 0..1 (null = no signal yet), pulse bpm, hrv {rmssd, stable},
   * hrvBase = first steady RMSSD of the session, sync 0..1, listening = framing OK and not talking.
   */
  update(dt, { breath, pulse, hrv, hrvBase, sync, listening }) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const present = breath != null && listening;
    const b = breath ?? 0.4;
    this.padGain.gain.setTargetAtTime(present ? 0.1 + 0.32 * b : 0.05, t, 0.12);
    this.padFilter.frequency.setTargetAtTime(380 + 1500 * b * (present ? 1 : 0.3), t, 0.12);

    // HRV opens the 3rd, 5th-above and 7th as readings steady / rise vs. your own start.
    let warmth = 0;
    if (hrv && hrv.stable) warmth = hrvBase ? Math.max(0, Math.min(1, 0.4 + (hrv.rmssd - hrvBase) / (hrvBase * 0.5))) : 0.4;
    this.voices.forEach((v, i) => { if (i >= 3) v.g.gain.setTargetAtTime(warmth > (i - 3) * 0.3 ? 0.16 : 0, t, 0.8); });

    this.shimmer.gain.setTargetAtTime(present ? 0.05 * Math.max(0, sync - 0.4) / 0.6 : 0, t, 0.6);

    // Heartbeat: a soft, low "lub-dub" on each pulse beat.
    if (pulse && present) {
      this._beat += dt * (pulse / 60);
      if (this._beat >= 1) { this._beat -= 1; this._thump(t, 1); this._thump(t + 0.16, 0.6); }
    }
  }

  _thump(at, level) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(70, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.18);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.22 * level, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    o.connect(g).connect(this.master); o.start(at); o.stop(at + 0.3);
  }

  /** A small bell for each new flower, walking up the pentatonic scale. */
  bell() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, at = ctx.currentTime, f = NOTE(BELLS[this._bell++ % BELLS.length]);
    for (const [mult, lvl, dec] of [[1, 0.16, 2.2], [2.76, 0.05, 1.1], [5.4, 0.02, 0.6]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * mult;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(lvl, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + dec);
      o.connect(g); g.connect(this.master); g.connect(this.space); o.start(at); o.stop(at + dec + 0.05);
    }
  }
}

module.exports = { SoundGarden };
