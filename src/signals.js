// signals.js — one small event interface over two sources:
//
//   PresageSource    → the real SmartSpectra SDK (renderer entry, Electron IPC)
//   SimulatedSource  → a clearly-labelled synthetic signal for UI work/demos
//
// Both emit the same normalized events so the garden never knows which is live:
//   'status'  (name: 'idle'|'starting'|'running'|'stopping'|'error')
//   'hint'    ({ ok, code, name, message })
//   'breath'  ([{ t, v }])  chest-breathing trace samples, t in seconds
//   'vitals'  ({ breathingRate?, pulseRate?, hrv?: { rmssd, stable } })
//   'stream'  (MediaStream)  live camera preview (Presage only)
//   'error'   ({ code, name, message, retryable })

'use strict';

const {
  SmartSpectraSDK,
  ProcessingStatus,
  ValidationCode,
  SmartSpectraErrorCode,
  MetricType,
  breathingMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

class Emitter {
  constructor() { this._l = Object.create(null); }
  on(ev, fn) { (this._l[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { for (const fn of this._l[ev] || []) { try { fn(...a); } catch (e) { console.error(e); } } }
}

const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k.replace(/^k/, '')]));
const STATUS = { [ProcessingStatus.kUninitialized]: 'idle', [ProcessingStatus.kIdle]: 'idle', [ProcessingStatus.kStarting]: 'starting', [ProcessingStatus.kRunning]: 'running', [ProcessingStatus.kStopping]: 'stopping', [ProcessingStatus.kError]: 'error' };
const VALIDATION_NAMES = invert(ValidationCode);
const ERROR_NAMES = invert(SmartSpectraErrorCode);

// Gentle, non-judgemental copy for each SDK readiness code.
const HINTS = {
  [ValidationCode.kOk]: 'Lovely — the garden can hear you.',
  [ValidationCode.kNoFaceFound]: 'I can’t see you yet. Face the camera when you’re ready.',
  [ValidationCode.kMultipleFacesFound]: 'This garden is for one. Make sure only you are in frame.',
  [ValidationCode.kFaceNotCentered]: 'Drift a little toward the centre of the frame.',
  [ValidationCode.kFaceSizeOutOfRange]: 'Adjust your distance from the camera a little.',
  [ValidationCode.kTooDark]: 'It’s a bit dark. Could you add a soft light in front of you?',
  [ValidationCode.kTooBright]: 'It’s a bit bright. Try turning away from the window.',
  [ValidationCode.kChestNotVisible]: 'Let your shoulders and upper chest show in frame.',
  [ValidationCode.kCameraTuning]: 'Tuning the camera… stay still for a moment.',
  [ValidationCode.kFrameRateTooLow]: 'The camera is running slowly. Close other camera apps.',
  [ValidationCode.kExcessiveMotion]: 'Settle in and stay still. No rush.',
  [ValidationCode.kFaceTooClose]: 'Lean back a little.',
  [ValidationCode.kFaceTooFar]: 'Come a little closer.',
  [ValidationCode.kFaceTooHigh]: 'Lower the camera, or sit up a little less.',
  [ValidationCode.kFaceTooLow]: 'Raise the camera a little.',
  [ValidationCode.kFaceNotForward]: 'Face the camera directly.',
};

const ERROR_HELP = {
  [SmartSpectraErrorCode.kAuthenticationFailed]: 'Your API key was not accepted. Check it at physiology.presagetech.com.',
  [SmartSpectraErrorCode.kCreditExhausted]: 'This API key has run out of trial credits.',
  [SmartSpectraErrorCode.kNetworkError]: 'Could not reach Presage to authenticate. Check your connection.',
  [SmartSpectraErrorCode.kInputUnavailable]: 'The camera is unavailable or permission was denied.',
  [SmartSpectraErrorCode.kMetricNotAuthorized]: 'Your API key is not authorized for one of the requested signals.',
  [SmartSpectraErrorCode.kSustainedLowFrameRate]: 'The camera frame rate stayed too low, so the session ended.',
};

// Which framing-checklist row each readiness code belongs to.
const GROUP = {
  [ValidationCode.kNoFaceFound]: 'face', [ValidationCode.kMultipleFacesFound]: 'face', [ValidationCode.kFaceNotForward]: 'face',
  [ValidationCode.kFaceNotCentered]: 'frame', [ValidationCode.kFaceSizeOutOfRange]: 'frame', [ValidationCode.kChestNotVisible]: 'frame',
  [ValidationCode.kFaceTooClose]: 'frame', [ValidationCode.kFaceTooFar]: 'frame', [ValidationCode.kFaceTooHigh]: 'frame', [ValidationCode.kFaceTooLow]: 'frame',
  [ValidationCode.kTooDark]: 'light', [ValidationCode.kTooBright]: 'light',
  [ValidationCode.kCameraTuning]: 'still', [ValidationCode.kFrameRateTooLow]: 'still', [ValidationCode.kExcessiveMotion]: 'still',
};
const hintFor = (code) => ({
  ok: code === ValidationCode.kOk,
  code,
  group: GROUP[code] || null,
  name: VALIDATION_NAMES[code] || `Code ${code}`,
  message: HINTS[code] || 'Adjusting…',
});

const toNum = (ts) => (ts == null ? 0 : typeof ts === 'number' ? ts : typeof ts === 'bigint' ? Number(ts) : typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts));
const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

// ---------------------------------------------------------------------------
class PresageSource extends Emitter {
  /** @param {{ apiKey: string, enableTelemetry: boolean }} opts */
  constructor({ apiKey, enableTelemetry }) {
    super();
    this.kind = 'presage';
    this._opts = { apiKey, enableTelemetry };
    this._t0 = null;
    this.talkingAvailable = true;
    this._build(true);
  }

  // Breathing trace + rate drive the garden; pulse rate + HRV colour it; TALKING
  // lets the garden wait while you speak. If the API key isn't authorized for
  // TALKING, we rebuild without it and carry on (see _fallback).
  _build(withTalking) {
    const metrics = [...breathingMetrics, MetricType.PULSE_RATE, MetricType.HRV];
    if (withTalking) metrics.push(MetricType.TALKING);
    this.talkingAvailable = withTalking;
    this.sdk = new SmartSpectraSDK({
      apiKey: this._opts.apiKey,
      requestedMetrics: metrics,
      enableAccumulatedOutput: false,
      enableTelemetry: this._opts.enableTelemetry, // user's choice on the consent screen — OFF by default
    });
    const sdk = this.sdk;
    const live = () => sdk === this.sdk;
    sdk.on('processingStatus', (st) => live() && this.emit('status', STATUS[st] || 'idle'));
    sdk.on('validationStatus', (code) => live() && this.emit('hint', hintFor(code)));
    sdk.on('streamAvailable', (stream) => live() && this.emit('stream', stream));
    sdk.on('error', (code, message, retryable) => {
      if (!live()) return;
      if (code === SmartSpectraErrorCode.kMetricNotAuthorized && this.talkingAvailable) { this._fallback(); return; }
      this.emit('error', { code, name: ERROR_NAMES[code] || `Error ${code}`, message: ERROR_HELP[code] || message, retryable });
    });
    // Each 'metrics' event carries only the samples produced since the last one.
    sdk.on('metrics', (buf) => {
      if (!live()) return;
      let m;
      try { m = decodeMetrics(buf); } catch (e) { console.warn('decode failed', e); return; }
      if (!m || m instanceof Uint8Array) return;
      const trace = m.breathing?.upperTrace || [];
      if (trace.length) {
        if (this._t0 == null) this._t0 = toNum(trace[0].timestamp);
        this.emit('breath', trace.map((p) => ({ t: (toNum(p.timestamp) - this._t0) / 1e6, v: p.value })));
      }
      const v = {};
      const br = last(m.breathing?.rate); if (br) v.breathingRate = br.value;
      const pr = last(m.cardio?.pulseRate); if (pr) v.pulseRate = pr.value;
      const h = last(m.cardio?.hrv); if (h && h.rmssd > 0) v.hrv = { rmssd: h.rmssd, stable: !!h.stable };
      if (Object.keys(v).length) this.emit('vitals', v);
      const talk = last(m.face?.talking);
      if (talk) this.emit('talking', !!talk.detected);
    });
  }

  /** The key can't use TALKING: rebuild without it, restart, and tell the app. */
  async _fallback() {
    const old = this.sdk;
    this._build(false);
    try { await old.stop(); } catch { /* ignore */ }
    try { old.destroy(); } catch { /* ignore */ }
    this.emit('notice', 'talking-unavailable');
    if (this._running) {
      try { await this.sdk.start(); } catch (e) { this.emit('error', { code: e.code, name: ERROR_NAMES[e.code] || 'Error', message: e.message, retryable: false }); }
    }
  }

  async start() {
    this._t0 = null;
    this._running = true;
    try {
      await this.sdk.start();
    } catch (e) {
      if (e && e.code === SmartSpectraErrorCode.kMetricNotAuthorized && this.talkingAvailable) { await this._fallback(); return; }
      throw e;
    }
  }
  async stop() { this._running = false; try { await this.sdk.stop(); } catch (e) { console.warn('stop', e); } }
  async reset() { await this.sdk.reset(); }
  destroy() { this._running = false; try { this.sdk.destroy(); } catch { /* already gone */ } }
}

// ---------------------------------------------------------------------------
// Synthetic signal: breathing starts ~13/min and drifts toward the pacer the
// longer you "practise", so the whole flow can be exercised without a camera.
class SimulatedSource extends Emitter {
  constructor({ getTargetRate, getRingValue }) {
    super();
    this.kind = 'simulated';
    this.getTargetRate = getTargetRate;
    this.getRingValue = getRingValue || (() => null); // when set, the simulated person follows the ring
    this.follow = true; // debug hook: false = a simulated person who stops following and speeds up
    this._ringQ = [];
    this._timer = null;
  }
  async start() {
    this.emit('status', 'starting');
    const t0 = performance.now();
    let phase = 0, lastT = 0, lastHint = -1, rate = 13.5, pulse = 76, rmssd = 32, lastVitals = -1;
    this._timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      // Walk through a realistic readiness sequence so the framing checklist can be seen working.
      if (t < 1.4) { this.emit('hint', hintFor(ValidationCode.kCameraTuning)); return; }
      if (t < 3.0) { this.emit('hint', hintFor(ValidationCode.kTooDark)); return; }
      if (lastT === 0) { this.emit('status', 'running'); lastT = t; }
      if (t - lastHint > 1) { lastHint = t; this.emit('hint', hintFor(ValidationCode.kOk)); }
      const target = this.follow ? this.getTargetRate() : 13;
      rate += (target - rate) * 0.012 + (Math.random() - 0.5) * 0.02; // follows the guide within a few breaths
      pulse += (64 - pulse) * 0.0015 + (Math.random() - 0.5) * 0.08;
      rmssd += (52 - rmssd) * 0.0015 + (Math.random() - 0.5) * 0.15;
      const samples = [];
      let prevT = lastT;
      for (let i = 0; i < 3; i++) {
        const st = lastT + ((t - lastT) * (i + 1)) / 3;
        phase += ((st - prevT) * rate) / 60;
        prevT = st;
        const own = Math.sin(phase * 2 * Math.PI) * 0.6 + Math.sin(phase * 4 * Math.PI + 1) * 0.08;
        // A person following the ring lags it by ~1.2 s and isn't perfect.
        const ring = this._ringQ.length && this._ringQ[0].at <= performance.now() - 1200 ? this._ringQ[0].v : null;
        const v = ring == null || !this.follow ? own : (ring - 0.5) * 1.2 * 0.8 + own * 0.2;
        samples.push({ t: st, v: v + (Math.random() - 0.5) * 0.08 });
      }
      lastT = t;
      const rv = this.getRingValue();
      if (rv != null) this._ringQ.push({ at: performance.now(), v: rv });
      while (this._ringQ.length > 1 && this._ringQ[1].at <= performance.now() - 1200) this._ringQ.shift();
      this.emit('breath', samples);
      if (t - lastVitals > 1 && t > 6) {
        lastVitals = t;
        this.emit('vitals', { breathingRate: rate, pulseRate: pulse, hrv: { rmssd, stable: t > 20 } });
      }
    }, 100);
  }
  async stop() { clearInterval(this._timer); this._timer = null; this.emit('status', 'idle'); }
  async reset() { await this.stop(); }
  destroy() { clearInterval(this._timer); }
}

module.exports = { PresageSource, SimulatedSource, HINTS, hintFor, hasPresageBridge: () => typeof window !== 'undefined' && !!window.__smartspectraBridge };
