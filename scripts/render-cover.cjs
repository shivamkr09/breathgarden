// Renders docs/cover.html to docs/cover.png (1000x420, DEV's cover size): npx electron scripts/render-cover.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 420, show: false, useContentSize: true, webPreferences: { offscreen: false } });
  await win.loadFile(path.join(__dirname, '..', 'docs', 'cover.html'));
  await new Promise((r) => setTimeout(r, 800));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'cover.png'), img.resize({ width: 1000, height: 420 }).toPNG());
  console.log('wrote docs/cover.png'); app.quit();
});
