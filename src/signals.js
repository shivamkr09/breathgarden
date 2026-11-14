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

const toNum = (ts) => (ts == null ? 0 : typeof ts === 'number' ? ts : typeof ts === 'bigint' ? Number(ts) : typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts));
const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

// ---------------------------------------------------------------------------
class PresageSource extends Emitter {
  /** @param {{ apiKey: string, enableTelemetry: boolean }} opts */
  constructor({ apiKey, enableTelemetry }) {
    super();
    this.kind = 'presage';
    this._t0 = null;
    this.sdk = new SmartSpectraSDK({
      apiKey,
      // Breathing trace + rate drive the garden; pulse rate + HRV colour it.
      requestedMetrics: [...breathingMetrics, MetricType.PULSE_RATE, MetricType.HRV],
      enableAccumulatedOutput: false,
      enableTelemetry, // user's choice on the consent screen — OFF by default
    });

    this.sdk.on('processingStatus', (s) => this.emit('status', STATUS[s] || 'idle'));
    this.sdk.on('validationStatus', (code) => this.emit('hint', {
      ok: code === ValidationCode.kOk,
      code,
      name: VALIDATION_NAMES[code] || `Code ${code}`,
      message: HINTS[code] || 'Adjusting…',
    }));
    this.sdk.on('streamAvailable', (stream) => this.emit('stream', stream));
    this.sdk.on('error', (code, message, retryable) => this.emit('error', {
      code, name: ERROR_NAMES[code] || `Error ${code}`, message: ERROR_HELP[code] || message, retryable,
    }));
    // Each 'metrics' event carries only the samples produced since the last one.
    this.sdk.on('metrics', (buf) => {
      let m;
      try { m = decodeMetrics(buf); } catch (e) { console.warn('decode failed', e); return; }
      if (!m || m instanceof Uint8Array) return;
      const trace = m.breathing?.upperTrace || [];
      if (trace.length) {
        if (this._t0 == null) this._t0 = toNum(trace[0].timestamp);
        this.emit('breath', trace.map((s) => ({ t: (toNum(s.timestamp) - this._t0) / 1e6, v: s.value })));
      }
      const v = {};
      const br = last(m.breathing?.rate); if (br) v.breathingRate = br.value;
      const pr = last(m.cardio?.pulseRate); if (pr) v.pulseRate = pr.value;
      const h = last(m.cardio?.hrv); if (h && h.rmssd > 0) v.hrv = { rmssd: h.rmssd, stable: !!h.stable };
      if (Object.keys(v).length) this.emit('vitals', v);
    });
  }
  async start() { this._t0 = null; await this.sdk.start(); }
  async stop() { try { await this.sdk.stop(); } catch (e) { console.warn('stop', e); } }
  async reset() { await this.sdk.reset(); }
  destroy() { try { this.sdk.destroy(); } catch { /* already gone */ } }
}

// ---------------------------------------------------------------------------
// Synthetic signal: breathing starts ~13/min and drifts toward the pacer the
// longer you "practise", so the whole flow can be exercised without a camera.
class SimulatedSource extends Emitter {
  constructor({ getTargetRate }) {
    super();
    this.kind = 'simulated';
    this.getTargetRate = getTargetRate;
    this._timer = null;
  }
  async start() {
    this.emit('status', 'starting');
    const t0 = performance.now();
    let phase = 0, lastT = 0, rate = 13.5, pulse = 76, rmssd = 32, lastVitals = -1;
    this._timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      if (t < 2.2) { this.emit('hint', { ok: false, code: 10, name: 'CameraTuning', message: HINTS[10] }); return; }
      if (lastT === 0) { this.emit('status', 'running'); this.emit('hint', { ok: true, code: 0, name: 'Ok', message: HINTS[0] }); lastT = t; }
      const target = this.getTargetRate();
      rate += (target - rate) * 0.0035 + (Math.random() - 0.5) * 0.02;
      pulse += (64 - pulse) * 0.0015 + (Math.random() - 0.5) * 0.08;
      rmssd += (52 - rmssd) * 0.0015 + (Math.random() - 0.5) * 0.15;
      const samples = [];
      let prevT = lastT;
      for (let i = 0; i < 3; i++) {
        const st = lastT + ((t - lastT) * (i + 1)) / 3;
        phase += ((st - prevT) * rate) / 60;
        prevT = st;
        samples.push({ t: st, v: Math.sin(phase * 2 * Math.PI) * 0.6 + Math.sin(phase * 4 * Math.PI + 1) * 0.08 + (Math.random() - 0.5) * 0.05 });
      }
      lastT = t;
      this.emit('breath', samples);
      if (t - lastVitals > 1 && t > 8) {
        lastVitals = t;
        this.emit('vitals', { breathingRate: rate, pulseRate: pulse, hrv: { rmssd, stable: t > 20 } });
      }
    }, 100);
  }
  async stop() { clearInterval(this._timer); this._timer = null; this.emit('status', 'idle'); }
  async reset() { await this.stop(); }
  destroy() { clearInterval(this._timer); }
}

module.exports = { PresageSource, SimulatedSource, hasPresageBridge: () => typeof window !== 'undefined' && !!window.__smartspectraBridge };
