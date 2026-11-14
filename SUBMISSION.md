---
title: Breathgarden — a breathing guide that checks you're really following it, shows what the camera sees, and talks you through it eyes-closed
published: false
tags: devchallenge, presagechallenge, electron, accessibility
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04)*

## What I Built

**Breathgarden** is a desktop app for a two-to-five-minute calm break. A glowing orb grows and shrinks with your **real chest movement**, read from your webcam by SmartSpectra. A ring breathes at a gentle guide pace. Breathe with the ring and flowers grow; at the end you get a **breath-print postcard** whose hills are drawn from your own breathing.

It's a desktop app on purpose: it's built for the desk you're already sitting at between meetings, and a webcam on a desk holds still. SmartSpectra's breathing signal is best when the camera isn't moving, which is hard with a phone in your hand.

Lots of breathing apps animate something with your breath. Breathgarden does four things I haven't seen elsewhere:

1. **It checks that you're actually following, not just breathing.** "In step" is the live **correlation between your chest trace and the guide ring**: a 15-second window, allowing 0–4 s for your reaction time and the SDK's delay. I tuned it on recorded live sessions. Following scores about 0.5–0.9, while breathing freely at your own pace almost never passes.
2. **The guide is a closed loop.** It starts at *your* measured rate and eases down only while you follow. If you stop following and speed up, it holds, then **eases back up to meet you** and says so ("Eased back to 10.4 /min to match you"). It never pushes you into air hunger.
3. **You can see what the camera sees, all session.** A greyscale camera view shows where SmartSpectra looks: a face dot-grid that glows on every pulse beat, and chest lines that rise and fall with your breath. It turns invisible sensing into something you can trust (and hide, with one tap).
4. **You can do it with your eyes closed.** An optional **voice guide** (clips generated ahead of time with ElevenLabs) gives framing tips, counts your first breaths, tells you when the guide slows or eases back, notices when you talk ("I'll wait while you talk"), and reads out your flower count at the end. The optional **sound garden** turns your breath into a swelling pad, your pulse into a faint heartbeat and steadier HRV into warmer chords.

## Demo

<!-- TODO: embed demo video: consent → "what the camera sees" framing check → session (camera panel, guide easing, voice + sound) → summary + breath-print postcard -->

## Code

https://github.com/shivamkr09/breathgarden (MIT). Setup: `npm install`, put your Presage key in `.env`, `npm start`. On macOS you can double-click `start-breathgarden.command`. Run `npm test` for the 13 unit tests covering the follow score, the closed-loop guide, breath detection and framing hints.

### How judges can test

- **Live:** get a free key at [physiology.presagetech.com](https://physiology.presagetech.com/auth/register), add it to `.env`, `npm start`. The free trial is about 100 credits (roughly 50 live minutes), so a 3-minute session is plenty.
- **No key or camera:** `npm run demo` (Electron) or `npm run web-demo` (browser) runs the whole flow on a clearly labelled simulated signal.
- No login, no accounts.

## How It Responds to Human Signals

| SmartSpectra signal | What it drives |
|---|---|
| **Chest breathing trace** (`breathing.upperTrace`) | The orb, sample by sample · the follow score (trace vs. ring correlation) · the live trace and breath lengths · the moving chest lines in the camera view · the sound pad · the breath-print postcard |
| **Breathing rate** (`breathing.rate`) | Where the closed-loop guide starts and whether to ease back · 5-second capsules against the guide's real path |
| **Pulse rate** (`cardio.pulseRate`) | The face dot-grid glowing on each beat · a soft heartbeat in the sound garden · pulse tile |
| **HRV** (`cardio.hrv[].rmssd`, `stable`) | Warmer chords in the sound garden as readings steady · HRV tile · start→end trend |
| **Talking** (`face.talking`) | The garden pauses and the voice says "I'll wait while you talk." If a key isn't authorized for it, the app restarts the SDK without it |
| **Validation status** | A four-item framing checklist (face · framing · light · stillness) with plain-language and spoken tips; flowers pause until `kOk` |

**Integration:** Presage's Electron path. `bindSmartSpectraIpc(win)` runs the native engine in the main process, `@smartspectra/node-sdk/preload` is bundled into a sandboxed preload, and the renderer creates `SmartSpectraSDK` from `@smartspectra/node-sdk/renderer`:

```js
const sdk = new SmartSpectraSDK({
  apiKey,
  requestedMetrics: [...breathingMetrics, MetricType.PULSE_RATE, MetricType.HRV, MetricType.TALKING],
  enableTelemetry, // consent screen, off by default
});
sdk.on('validationStatus', (code) => checklist.update(code));
sdk.on('metrics', (buf) => {
  const m = decodeMetrics(buf);              // each event = only the new samples
  breath.push(m.breathing?.upperTrace);      // rolling window → orb, follow score, camera view
  vitals.set(m.breathing?.rate, m.cardio?.pulseRate, m.cardio?.hrv);
  talking.set(m.face?.talking?.at(-1)?.detected);
});
```

### What I learned tuning it on real sessions

I recorded the app's numbers (never video) during live runs and tuned from them:

- **Run 1: zero flowers.** The guide asked for 6 breaths/min immediately, and the SDK's breathing rate was too jumpy second to second (13.7 → 24 → 11.8) to judge "in step". So "in step" became the trace-to-ring correlation.
- **Run 2: 2 flowers in 54 s.** Real traces are noisier than my simulation (median |r| 0.49). A 15-second window and a threshold matched to real data fixed it, while keeping free breathing at about a 4% false pass rate.
- **Run 3: 7 flowers in the first 85 s, then none.** The guide kept slowing below 7.5/min; I sped up and stopped following. That's why the guide is now a closed loop.
- **macOS camera quirk:** camera permission belongs to the app that *launched* Electron. From the wrong parent, the track is "live" but delivers zero frames and the SDK times out. Breathgarden checks `systemPreferences` and explains the fix within 7 seconds.

## Prize Categories

**Most Creative or Delightful Use.** *Inspiration:* I wanted to hear my own breath grow something. Your body is the instrument: breath swells the music, your pulse keeps a soft beat, the camera view shows the sensing happening, the garden waits politely when you talk, and the keepsake is a breath-print postcard no one else could make.

**Best Thoughtful Real-World Use.** *Who it's for:* people at a desk all day who want a short reset without buying a wearable or creating an account, and people who'd rather **close their eyes**, including people with low vision, thanks to the voice guide and sound.
- The guide **meets you where you are** and backs off instead of pushing.
- **Numbers are hidden by default.** Tiles still say each signal is live, without values that might make someone anxious.
- Consent before the camera; a red "Camera on" badge and live camera panel whenever it's on; "Hide video" keeps the camera honest without showing your face.
- Plain-language framing help, keyboard-operable controls, `prefers-reduced-motion` support.

## Consent and Data Handling

- **Camera consent:** the camera never starts until you tick an explicit consent box ("I'm only measuring myself") and press Continue, enforced in code. The main process grants camera access only to the app's own page and only for video (never the microphone), and blocks navigation and popups.
- **Processing:** frames go from the window to the SmartSpectra engine in the app's own process on your computer. Nothing uploads or records video.
- **Storage and retention:** none by default. Signals live in memory for the current session only; **Forget session** clears them and quitting clears everything. No localStorage, no analytics.
- **Postcard:** optional and user-initiated. One PNG: the garden picture (hill shapes follow your breathing pattern), date, minutes and flower count. No numbers or readings.
- **Sharing:** the SDK authenticates the API key with Presage over TLS. The app makes no other requests; even the font is bundled.
- **SDK telemetry:** **off by default**, opt-in on the consent screen. If enabled, the SDK sends session summaries and readiness reports (SDK version, device model and OS, frame rates, validation counts, error codes, possibly technical free text): **no video and no measured vitals**, but linkable to the API key's account. Retention follows Presage's policies ([details](https://smartspectra.presagetech.com/docs/telemetry-and-privacy)).
- **AI services:** the voice guide's clips were **generated once, ahead of time, with ElevenLabs text-to-speech** from a fixed list of phrases (no personal data). At runtime the app only plays those local files, or your OS's built-in voice. **No AI service is called during a session**, and readings are never spoken or sent. LLM Insights is not used.
- **Talking and sound:** the talking signal only pauses the garden; no audio is captured. The sound garden is synthesized locally.
- **Not medical:** relaxation and wellness only. No diagnosis, treatment or medical decisions.

## Agent Session

<!-- Optional: upload the Claude Code transcript at https://dev.to/agent_sessions/new, remove the API keys from it, Make Public, embed here. -->
