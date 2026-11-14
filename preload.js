// preload.js — bundled by esbuild into dist/preload.bundle.js.
//
// Loads the SmartSpectra preload bridge (exposes window.__smartspectraBridge
// for @smartspectra/node-sdk/renderer) and adds a tiny, read-only app bridge.

'use strict';

require('@smartspectra/node-sdk/preload');

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('breathgarden', {
  getConfig: () => ipcRenderer.invoke('breathgarden:config'),
  getEnvKey: () => ipcRenderer.invoke('breathgarden:env-key'),
});
