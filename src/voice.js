// voice.js — the voice guide, for eyes-closed sessions.
//
// Plays pre-generated ElevenLabs clips from assets/voice/en/ (listed in
// assets/voice/manifest.json). If a clip isn't there, it falls back to the
// operating system's built-in speech voice, which also runs on this computer.
// It never calls a network service and never speaks readings.
'use strict';

const { PHRASES } = require('./phrases');

class VoiceGuide {
  constructor() {
    this.on = false;
    this.clips = new Set();
    this.source = 'system';     // 'elevenlabs' when clips are present
    this.busyUntil = 0;
    this.lastSaid = {};         // id → time, for per-phrase cooldowns
    this.lastAny = 0;
    this.log = [];              // recent ids (debug only)
    this._audio = null;
  }

  /** Clip ids from assets/voice/manifest.json (the desktop app's main process reads it). */
  setClips(ids) {
    this.clips = new Set(ids || []);
    this.source = this.clips.size ? 'elevenlabs' : 'system';
  }

  /** Browser preview only: there's no main process, so read the manifest over http. */
  async loadManifestOverHttp() {
    if (!/^https?:/.test(location.protocol)) return;
    try { const r = await fetch('assets/voice/manifest.json'); if (r.ok) this.setClips((await r.json()).clips); } catch { /* none */ }
  }

  enable() { this.on = true; }
  disable() { this.on = false; this.stop(); }
  stop() {
    if (this._audio) { this._audio.pause(); this._audio = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    this.busyUntil = 0;
  }

  /**
   * Say a phrase if it's appropriate now.
   * @param {string} id  key in PHRASES
   * @param {{ cooldown?: number, gap?: number, interrupt?: boolean }} [o]
   *   cooldown: seconds before this phrase may repeat; gap: quiet seconds needed
   *   since any phrase; interrupt: cut off whatever is playing.
   */
  say(id, o = {}) {
    if (!this.on || !PHRASES[id]) return false;
    const now = performance.now() / 1000;
    const { cooldown = 20, gap = 4, interrupt = false } = o;
    if (now - (this.lastSaid[id] ?? -1e9) < cooldown) return false;
    if (!interrupt && (now < this.busyUntil || now - this.lastAny < gap)) return false;
    if (interrupt) this.stop();
    this.lastSaid[id] = now; this.lastAny = now;
    this.log.push(id); if (this.log.length > 20) this.log.shift();
    const text = PHRASES[id];
    this.busyUntil = now + Math.max(1.2, text.length * 0.065); // rough duration until 'ended' arrives
    if (this.clips.has(id)) {
      const a = new Audio(`assets/voice/en/${id}.mp3`);
      a.volume = 0.9;
      a.addEventListener('ended', () => { this.busyUntil = 0; });
      a.play().catch(() => this._speak(text));
      this._audio = a;
    } else {
      this._speak(text);
    }
    return true;
  }

  _speak(text) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.88; u.pitch = 1; u.volume = 0.9;
    const local = synth.getVoices().filter((v) => v.localService && v.lang && v.lang.startsWith('en'));
    const preferred = local.find((v) => /Samantha|Karen|Moira|Serena|Daniel|Aria|Jenny/i.test(v.name)) || local[0];
    if (preferred) u.voice = preferred;
    u.onend = () => { this.busyUntil = 0; };
    synth.speak(u);
  }
}

module.exports = { VoiceGuide };
