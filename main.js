// main.js — Breathgarden main process.
//
// 1. Creates one locked-down window (contextIsolation + sandbox, no remote nav).
// 2. Binds the SmartSpectra IPC bridge so the renderer-side SDK can run the
//    native measurement engine in this process.
// 3. Grants camera access ONLY to our bundled page, ONLY for video (no mic),
//    and only after the user has given in-app consent (the renderer never calls
//    sdk.start() before the consent screen is accepted).
// 4. Hands the renderer a tiny config: whether an API key is available from the
//    environment, and whether demo mode was requested. The key itself is passed
//    on demand and never written to disk by this app.

'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, session, systemPreferences } = require('electron');

const DEMO = process.argv.includes('--demo');

// Optional `.env` support (SMARTSPECTRA_API_KEY=...), read once, never written.
function loadApiKey() {
  if (process.env.SMARTSPECTRA_API_KEY) return process.env.SMARTSPECTRA_API_KEY.trim();
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = raw.match(/^\s*SMARTSPECTRA_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1].trim();
  } catch { /* no .env — the user can paste a key in-app instead */ }
  return '';
}
const ENV_API_KEY = loadApiKey();

// Packaged builds ship the native runtime as an extra resource (see the
// Presage electron-quickstart). Must be set before requiring the binding.
if (app.isPackaged && !process.env.SMARTSPECTRA_CAPI_PATH) {
  const LIB = { darwin: 'libsmartspectra_capi.dylib', win32: 'smartspectra_capi.dll', linux: 'libsmartspectra_capi.so' }[process.platform];
  if (LIB) process.env.SMARTSPECTRA_CAPI_PATH = path.join(process.resourcesPath, 'smartspectra', LIB);
}

// In demo mode we never load the native SDK at all — no camera, no network.
const { bindSmartSpectraIpc } = DEMO ? { bindSmartSpectraIpc: null } : require('@smartspectra/node-sdk/main');

ipcMain.handle('breathgarden:config', () => ({
  demo: DEMO,
  hasEnvKey: Boolean(ENV_API_KEY),
  platform: process.platform,
}));
// The renderer asks for the env key only at the moment it builds the SDK.
ipcMain.handle('breathgarden:env-key', () => ENV_API_KEY);

// macOS camera permission (TCC) is separate from Chromium's permission check:
// if the OS denies it, getUserMedia can still "succeed" but deliver no frames.
// Called only after in-app consent, right before the session starts.
ipcMain.handle('breathgarden:camera-access', async () => {
  if (DEMO) return 'denied';
  if (process.platform !== 'darwin') return 'granted';
  let status = systemPreferences.getMediaAccessStatus('camera');
  if (status === 'not-determined') status = (await systemPreferences.askForMediaAccess('camera')) ? 'granted' : 'denied';
  return status;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b1020',
    title: 'Breathgarden',
    webPreferences: {
      preload: path.join(__dirname, 'dist', 'preload.bundle.js'),
      contextIsolation: true,
      sandbox: true, // preload is a single esbuild bundle that only requires 'electron'
      nodeIntegration: false,
    },
  });

  if (bindSmartSpectraIpc) bindSmartSpectraIpc(win);

  // Never open popups or navigate away: remote content must not inherit the camera grant.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.loadFile(path.join(__dirname, 'index.html'));
  if (process.env.SMARTSPECTRA_DIAGNOSTICS === '1') win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    const mediaTypes = (details && details.mediaTypes) || [];
    const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
    callback(!DEMO && permission === 'media' && cameraOnly && url.startsWith('file://'));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
