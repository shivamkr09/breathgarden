# Breathgarden

A consent-first desktop app for a calm break. A glowing breath orb **moves with your real breathing**, measured from your webcam by the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/docs/nodejs). Breathe with the guide ring and a small garden grows. You can also **hear** it: an optional sound garden plays your breath, pulse and HRV as soft music. At the end you get a **breath-print postcard**, where the hills are drawn from your own breathing.

Built for the [DEV × Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04).

> Relaxation only. Breathgarden is **not a medical device** and makes no diagnosis, treatment or monitoring claims.

## The flow

1. **Welcome & consent.** Choose a guide pace (4.5–8 breaths/min) and a length (1, 3 or 5 min). Read three plain promises (camera only while you breathe, processed on device, nothing stored), then agree explicitly before the camera can turn on.
2. **What the camera sees.** This is a framing check. A draggable split compares your colour preview with a greyscale "camera view". The overlay shows where SmartSpectra looks: a face dot-grid that glows on each pulse beat, and chest lines that rise and fall with your live breath trace. A four-item checklist (face, framing, light, stillness) is driven by SmartSpectra's validation codes. The garden opens by itself once everything is ready.
3. **Session.** A four-card layout: the breath orb with a **closed-loop guide ring**; a breathing-rate chart against the guide's real path; an always-on **"What the camera sees"** panel (face dot-grid pulsing with your pulse, chest lines moving with your breath, a "Hide video" option) with your live breath trace beneath it; and tiles for pulse rate, breathing rate, HRV and time left. The guide starts at your own measured pace and eases toward your target. If you start **talking**, the garden waits for you. With **sound** on, you can close your eyes and breathe by ear.
4. **Summary.** Flowers grown, time in step, and start-to-end trends. A **breath-print postcard**: the hills follow your session's breathing pattern and each flower sits where you earned it. You can save it as a picture with no numbers in it. There's also **Forget session**.

## What responds to what

| Live SmartSpectra signal | What it does |
|---|---|
| **Chest breathing trace** (`breathing.upperTrace`) | Sets the orb's size sample by sample, draws the live trace and the breath lengths, and moves the chest lines in the camera view |
| **Breathing rate** (`breathing.rate`) | Sets where the **closed-loop guide** starts (your measured rate). It's also plotted as 5-second capsules against the guide's real path |
| **Breath-to-breath timing** (from the chest trace) | The breath lengths shown above the live trace |
| **Pulse rate** (`cardio.pulseRate`) | Pulse tile, plus the face dot-grid glowing on each beat in the camera view |
| **HRV** (`cardio.hrv[].rmssd`, `stable`) | HRV tile ("steady" or "settling") and the start-to-end trend |
| **Validation status** | Framing checklist and gentle hints ("Come a little closer"). The orb dims and flowers pause until the SDK reports `kOk` |
| **Talking** (`face.talking`) | The garden pauses ("The garden is listening…") while you speak, then picks up when you're quiet. If your API key isn't authorized for this signal, the app automatically restarts without it |
| **"In step"** | Correlation between the live chest trace and the guide ring over the last 15 s, allowing 0–4 s for your reaction time and SDK delay. Tuned on recorded live sessions: following scores about 0.5–0.9, free breathing rarely passes the threshold. Time in step grows flowers |
| **Closed-loop guide** | While you follow, the guide eases toward your target (3 breaths/min per minute). Partly following slows it down. If you stop following and breathe faster, it holds, then eases back up to meet you ("Eased back to 10.4 /min to match you") |

### Sound garden (optional, off by default)

| Signal | Sound |
|---|---|
| Chest trace | A soft pad that swells as you breathe in and falls as you breathe out |
| Pulse rate | A very quiet low "lub-dub" at your measured tempo |
| HRV | Harmony: steadier readings, relative to your own start, open warmer chord tones |
| In step | A gentle shimmer |
| Each flower | A small bell, walking up a pentatonic scale |

It's all synthesized with Web Audio in the app window. There are no audio files, no network, and the microphone is never used.

### Voice guide (optional, off by default)

A calm voice for eyes-closed sessions. It gives spoken framing tips from the validation codes, and counts "Breathe in… and out" for the first three breaths. It says when the closed-loop guide eases down, holds or eases back. It pauses when you talk ("I'll wait while you talk"), notes flower milestones and time (halfway, one minute left), and reads out the flower count at the end. It never speaks readings.

The phrases live in `src/phrases.js`. To give the voice a natural sound, generate the clips once with ElevenLabs:

```bash
echo "ELEVENLABS_API_KEY=..." >> .env   # optional: ELEVENLABS_VOICE_ID=...
npm run voice                           # writes assets/voice/en/*.mp3 + manifest.json (~1,700 characters)
```

Only those fixed phrases are sent to ElevenLabs, once, by you. The app then plays the local MP3s and **never calls ElevenLabs at runtime**. Without clips it falls back to the operating system's built-in voice, which also runs on-device.

When numbers are hidden (the default), every tile still shows that its signal is **live**, just without the value.

## Setup

Requirements: Node.js ≥ 20 (Node 24 LTS recommended). Supported platforms are macOS Apple Silicon, Windows x64, and Linux x64/arm64 (glibc ≥ 2.35). You also need a free API key from <https://physiology.presagetech.com/auth/register>.

```bash
git clone https://github.com/shivamkr09/breathgarden.git && cd breathgarden
npm install            # pulls @smartspectra/node-sdk + its prebuilt native runtime
cp .env.example .env   # then paste your key: SMARTSPECTRA_API_KEY=...
npm start              # builds the renderer/preload bundles and launches Electron
```

No `.env`? You can paste the key on the consent screen instead. It is kept in memory only.

On macOS you can also double-click **`start-breathgarden.command`**. It opens Terminal, installs dependencies if needed, and starts the app, so macOS asks Terminal for camera access.

### Tests

```bash
npm test   # 13 unit tests: follow score, closed-loop guide, breath detection, framing hints
```

### Trying it without an API key or camera

```bash
npm run demo       # Electron with the SDK and camera fully disabled (simulated signal)
npm run web-demo   # simulated version in a normal browser at http://localhost:5178
```

Simulated mode runs the whole flow, including the framing checklist, and is clearly labelled "Simulated · no camera" everywhere.

**Credits:** Presage's free trial is about 100 credits (roughly 50 live minutes). Explore in demo mode, and use live mode for real sessions.

Diagnostics: `SMARTSPECTRA_DIAGNOSTICS=1 npm start` opens DevTools and turns on the SDK's IPC logging. For tuning, `npx electron . --bg-debug` exposes a read-only `window.__bgDebug()` snapshot of the live numbers (guide, rates, correlation) for DevTools. It stores nothing.

### Troubleshooting: black preview / "No camera frames" on macOS

macOS decides camera permission based on the app that **launched** Breathgarden: Terminal, iTerm, VS Code, and so on. If that app isn't allowed, the camera opens but delivers no frames. The SDK then stalls at "Starting" and eventually reports `ProcessingFailed`. To fix it:

1. Run `npm start` from a terminal app you control. macOS should ask for camera access on the first session. Click Allow.
2. If you previously denied it, open **System Settings › Privacy & Security › Camera** and turn on that terminal app. Then quit and relaunch Breathgarden from it.

Breathgarden checks the macOS camera status before starting. If no frames arrive within 7 seconds, it shows this guidance instead of a generic error.

## How the SDK is integrated

This follows Presage's recommended Electron path (see their `electron-quickstart`):

- **`main.js`** calls `bindSmartSpectraIpc(win)` from `@smartspectra/node-sdk/main`, which runs the native engine (through koffi FFI) in the main process. It grants the camera only to the bundled `file://` page, and only for video-only requests (never the microphone). It blocks navigation and popups, and checks macOS camera permission.
- **`preload.js`** loads `@smartspectra/node-sdk/preload`, plus a small app bridge. esbuild bundles it so the window can keep `sandbox: true`.
- **`src/signals.js`** creates `SmartSpectraSDK` from `@smartspectra/node-sdk/renderer` with `requestedMetrics: [...breathingMetrics, PULSE_RATE, HRV]` and `enableTelemetry` set from the consent screen. It decodes each `metrics` event with `decodeMetrics`. Each event only carries the samples produced since the previous one, so the app keeps its own rolling window. It also maps validation codes to checklist groups. A `SimulatedSource` emits the same normalized events.
- **`src/core.js`** holds the pure live-loop logic (follow score, closed-loop guide, pacer), which is unit-tested in `test/`. **`src/voice.js`** and **`src/phrases.js`** make up the voice guide, and **`src/sound.js`** the sound garden.
- **`src/camview.js`** draws the "What the camera sees" view. **`src/viz.js`** draws the orb, charts, trace and postcard. **`src/renderer.js`** runs the consent → framing check → session → summary flow.

The UI font (Figtree) is bundled from npm, so the app makes no font requests. The CSP is `default-src 'self'`, with no inline styles or remote scripts.

## Consent and data handling

- **Consent before camera:** the camera can only start after you tick the consent box and press **Continue**. The live path is hard-gated in code (`beginSession` returns if consent wasn't given). While the camera is on, a red **Camera on** badge is always visible, along with a preview: the large compare view during the framing check, and a thumbnail in the session that you can collapse.
- **Local processing:** frames go from the renderer to the SmartSpectra engine in the app's own main process, through a private MessagePort. Breathgarden never uploads or records video.
- **Storage:** none by default. The breathing trace, rates, pulse and HRV are held in memory for the current session only. No `localStorage`, no database, no analytics. **Forget session** clears it, and quitting the app clears everything.
- **Postcard (optional, user-initiated):** **Save postcard** writes one PNG to a location you choose. It contains the garden picture, where the hill shapes follow your breathing pattern, plus the date, the minutes and the flower count. It contains no numbers or readings.
- **Talking signal:** used only to pause the garden. No audio is captured, and the microphone is never requested.
- **Sound garden:** synthesized locally from your signals. Nothing is recorded or sent.
- **API key:** read from `.env` or the environment by the main process, or pasted in-app (memory only). It is never written anywhere by the app.
- **Network / SDK:** the SDK authenticates the API key with Presage over TLS. The app itself makes no other network requests.
- **SDK telemetry:** **off by default.** An optional switch on the consent screen turns it on (`enableTelemetry`). If you enable it, the SDK sends measurement-session summaries and device readiness reports to Presage. These include the SDK version, device model and OS, frame-rate and performance counts, validation-state counts and error codes. Readiness reports can include technical free text. They contain **no video frames and no measured vitals**, but authenticated requests can be linked to the API key's account. Retention follows Presage's policies. See [SDK Telemetry & Privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy).
- **AI services:** the optional voice guide uses clips **generated once, ahead of time, with ElevenLabs text-to-speech** from fixed phrases (no personal data). At runtime the app plays local files only (or the OS voice) and calls no AI service. LLM Insights (`requestInsight`) is not used.
- **Not for monitoring others:** consent includes "I'm only measuring myself". Multiple faces trigger the SDK's `kMultipleFacesFound` hint, and flowers pause.

## Accessibility and comfort

- Numbers are **hidden by default**, because watching vitals can make it harder to relax. Turn them on with the switch on the consent screen.
- Pace and length are adjustable, using real buttons with labels.
- The compare split is a keyboard slider (arrow keys).
- Respects `prefers-reduced-motion`. `Esc` ends a session.

## License

MIT for Breathgarden's code. `@smartspectra/node-sdk` is © Presage Technologies and ships under its own license. Figtree is under the SIL Open Font License. Voice guide clips (`assets/voice/`) were generated with [ElevenLabs](https://elevenlabs.io) text-to-speech (voice: Sarah).
