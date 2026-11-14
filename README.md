# Breathgarden

A consent-first desktop app for a calm break. A night garden that **moves with your real breathing**, measured from your webcam by the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/docs/nodejs). Breathe slowly with the guide ring, and flowers grow.

Built for the [DEV × Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04).

> Relaxation only. Breathgarden is **not a medical device** and makes no diagnosis, treatment or monitoring claims.

## What responds to what

| Live SmartSpectra signal | What it does in the garden |
|---|---|
| **Chest breathing trace** (`breathing.upperTrace`) | The glowing bloom expands and contracts with your chest, sample by sample. The grass and flower petals sway with it. Also shown as the live sparkline. |
| **Breathing rate** (`breathing.rate`) | Compared with the guide pace (4.5–8 breaths/min). The closer you are, the fuller the "in step" meter. Time spent in step grows flowers. |
| **Pulse rate** (`cardio.pulseRate`) | Fireflies blink on the pulse tempo. Each new flower's colour comes from your pulse at the moment it blooms: violet when calmer, pink when livelier. |
| **HRV** (`cardio.hrv[].rmssd`) | Optional number readout, plus a start-to-end trend on the summary screen. |
| **Validation status** | Friendly, specific guidance ("Come a little closer", "It's a bit dark…"). The garden dims and stops growing flowers until it can see you clearly. |

## Setup

Requirements: Node.js ≥ 20 (Node 24 LTS recommended). Supported platforms are macOS Apple Silicon, Windows x64, and Linux x64/arm64 (glibc ≥ 2.35). You also need a free API key from <https://physiology.presagetech.com/auth/register>.

```bash
git clone https://github.com/shivamkr09/breathgarden.git && cd breathgarden
npm install            # pulls @smartspectra/node-sdk + its prebuilt native runtime
cp .env.example .env   # then paste your key: SMARTSPECTRA_API_KEY=...
npm start              # builds the renderer/preload bundles and launches Electron
```

No `.env`? You can paste the key on the setup screen instead. It is kept in memory only.

Other modes:

```bash
npm run demo       # Electron with the SDK and camera fully disabled (simulated signal)
npm run web-demo   # simulated garden in a normal browser at http://localhost:5178
```

Diagnostics: `SMARTSPECTRA_DIAGNOSTICS=1 npm start` opens DevTools and turns on the SDK's IPC logging.

## How the SDK is integrated

This follows Presage's recommended Electron path (see their `electron-quickstart`):

- **`main.js`** calls `bindSmartSpectraIpc(win)` from `@smartspectra/node-sdk/main`, which runs the native engine (through koffi FFI) in the main process. It grants the camera only to the bundled `file://` page, and only for video-only requests (never the microphone). It also blocks navigation and popups.
- **`preload.js`** loads `@smartspectra/node-sdk/preload`, plus a two-method app bridge. esbuild bundles it so the window can keep `sandbox: true`.
- **`src/signals.js`** creates `SmartSpectraSDK` from `@smartspectra/node-sdk/renderer` with `requestedMetrics: [...breathingMetrics, PULSE_RATE, HRV]` and `enableTelemetry` set from the consent screen. It decodes each `metrics` event with `decodeMetrics`. Each event only carries the samples produced since the previous one, so the app keeps its own rolling 15-second window. A `SimulatedSource` emits the same normalized events, so you can try the UI without a camera. It is always labelled "Simulated".
- **`src/garden.js`** draws the garden on a canvas. **`src/renderer.js`** runs the consent → setup → session → summary flow.

## Consent and data handling

- **Consent before camera:** the camera can only start after you tick the consent box and press **Begin**. The live path is hard-gated in code (`beginSession` returns if consent wasn't given). While the camera is on, you always see a red **Camera on** badge and your preview. You can collapse the preview, but the badge stays.
- **Local processing:** frames go from the renderer to the SmartSpectra engine in the app's own main process, through a private MessagePort. Breathgarden never uploads, records or screenshots video.
- **No storage:** the breathing trace, rates, pulse and HRV are held in memory for the current session only, for the live view and the summary. No files, no `localStorage`, no database, no analytics. **Forget this session** clears it, and quitting the app clears everything.
- **API key:** read from `.env` or the environment by the main process, or pasted in-app (memory only). It is never written anywhere by the app.
- **Network / SDK:** the SDK authenticates the API key with Presage over TLS.
- **SDK telemetry:** **off by default.** An optional checkbox on the consent screen turns it on (`enableTelemetry`). If you enable it, the SDK sends measurement-session summaries and device readiness reports to Presage. These include the SDK version, device model and OS, frame-rate and performance counts, validation-state counts and error codes. Readiness reports can include technical free text. They contain **no video frames and no measured vitals**, but authenticated requests can be linked to the API key's account. Retention follows Presage's policies. See [SDK Telemetry & Privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy).
- **AI services:** none. LLM Insights (`requestInsight`) is not used.
- **Not for monitoring others:** the copy asks you to use it only on yourself. Multiple faces trigger the SDK's `kMultipleFacesFound` hint, and the garden pauses.

## Accessibility and comfort

- Numbers are **hidden by default**, because watching vitals can make it harder to relax. Turn them on in setup.
- The pace is adjustable, and the copy says plainly that comfort comes first.
- Respects `prefers-reduced-motion`.
- Keyboard: Tab/Enter through every screen, and `Esc` ends a session.

## License

MIT for Breathgarden's code. `@smartspectra/node-sdk` is © Presage Technologies and ships under its own license.
