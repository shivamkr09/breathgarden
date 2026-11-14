---
title: Breathgarden — a night garden that grows when you breathe slowly
published: false
tags: devchallenge, presagechallenge, electron, wellness
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04)*

## What I Built

**Breathgarden** is a small desktop app for a calm break between meetings. When you start a session, a night garden appears. In the middle is a glowing bloom that **expands and contracts with your actual chest movement**, read from your webcam by SmartSpectra. Around it, a dotted guide ring breathes at a slow pace that you choose (default 6 breaths/min, with a longer out-breath).

Settle into that pace and the "in step" meter fills, the sky warms, and **flowers bloom** in the meadow. Each flower is coloured by your pulse at the moment it opens. Fireflies blink in time with your pulse. At the end, a summary shows how many flowers you grew, how long you were in step, and how your breathing rate, pulse and HRV moved from start to finish. Then you can **forget** it all with one tap.

## Demo

<!-- TODO: embed demo video showing the consent screen, the Camera-on badge + preview, and the bloom tracking real breathing -->

## Code

https://github.com/shivamkr09/breathgarden — it includes setup instructions (`npm install`, add your key to `.env`, `npm start`).

## How It Responds to Human Signals

| SmartSpectra signal | Response |
|---|---|
| Chest breathing trace (`breathing.upperTrace`) | Drives the bloom's size sample by sample, the swaying grass and petals, and a live sparkline |
| Breathing rate (`breathing.rate`) | Compared with the guide pace to fill the "in step" meter. Time in step grows flowers |
| Pulse rate (`cardio.pulseRate`) | Firefly blink tempo, sky warmth, and the colour of each new flower |
| HRV (`cardio.hrv[].rmssd`) | Optional readout and a start-to-end trend |
| Validation status | Gentle guidance ("Come a little closer"). The garden dims and pauses until it can see you |

**Integration:** I used Presage's Electron path. `bindSmartSpectraIpc(win)` runs the native engine in the main process. `@smartspectra/node-sdk/preload` is bundled into a sandboxed preload. The renderer creates `SmartSpectraSDK` from `@smartspectra/node-sdk/renderer`:

```js
const sdk = new SmartSpectraSDK({
  apiKey,
  requestedMetrics: [...breathingMetrics, MetricType.PULSE_RATE, MetricType.HRV],
  enableTelemetry, // from the consent screen, off by default
});
sdk.on('streamAvailable', (stream) => (preview.srcObject = stream));
sdk.on('validationStatus', (code) => showFriendlyHint(code));
sdk.on('metrics', (buf) => {
  const m = decodeMetrics(buf);           // each event = samples since the last one
  pushBreath(m.breathing?.upperTrace);    // rolling 15 s window → normalized bloom size
  setVitals(m.breathing?.rate, m.cardio?.pulseRate, m.cardio?.hrv);
});
await sdk.start();
```

One thing I learned from the quickstart: each `metrics` event carries only the **new** samples. So I keep a rolling 15-second window and normalize the chest trace to 0..1 against its own recent min and max. That makes the bloom work for any body, camera distance or breathing depth.

## Prize Categories

**Most Creative or Delightful Use.** Breathing exercises usually mean staring at a timer or a number. Here, your body literally animates a living scene, and the reward is a garden that you grew, not a score.

**Best Thoughtful Real-World Use.** Short paced-breathing breaks are a common way to wind down between tasks, and Breathgarden aims to make them easy to start and private by default. Design choices:

- Consent comes before the camera. A red **Camera on** badge and a live preview are visible the whole time.
- **Numbers are hidden by default.** Watching your pulse can be the opposite of relaxing, so you can opt in.
- The pace is adjustable, and the copy says "comfort comes first."
- Specific, kind framing guidance instead of error codes.
- Respects `prefers-reduced-motion`, and every screen is keyboard-operable.

## Consent and Data Handling

- **Camera consent:** the camera never starts until you tick an explicit consent box and press Begin, and that gate is enforced in code. The main process grants camera permission only to the app's own bundled page, and only for video (never the microphone). It blocks navigation and popups. The Camera-on badge and preview stay visible during a session.
- **Processing:** frames go from the window to the SmartSpectra engine in the app's own process on your computer. The app never uploads, records or screenshots video.
- **Storage and retention:** none. Signals live in memory for the current session only. **Forget this session** clears them, and quitting clears everything. No files, no localStorage, no analytics.
- **Sharing:** the SmartSpectra SDK authenticates the API key with Presage over TLS.
- **SDK telemetry:** **off by default**, with an opt-in checkbox on the consent screen. If enabled, the SDK sends session summaries and device readiness reports to Presage. These include the SDK version, device model and OS, frame-rate and performance counts, validation counts and error codes, and possibly technical free text. They contain **no video and no measured vitals**, but they can be linked to the API key's account. Retention follows Presage's policies ([details](https://smartspectra.presagetech.com/docs/telemetry-and-privacy)).
- **AI services:** none. LLM Insights is not used.
- **Not medical:** relaxation and wellness only. No diagnosis, treatment or medical decisions. The app asks you to use it only on yourself, and it pauses when it detects multiple faces.

## Agent Session

<!-- Optional: upload the Claude Code transcript at https://dev.to/agent_sessions/new, check it for keys, Make Public, embed here. -->
