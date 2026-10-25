const { app, BrowserWindow, ipcMain, dialog, nativeImage, Tray, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Pitaya Core: dane w ~/.config/Pitayas/Droid, ustawienia, logi, aktualizacje
const core = require('./core').create({
  id: 'droid',
  folder: 'Droid',
  name: 'Pitaya Droid',
  repo: 'Pitayas-Team/Pitayas-Droid',
  appDir: __dirname,
  defaults: { gpu: 'auto', audio: true, stopHeadlessOnClose: true, appWindow: '', lastAvd: null },
});
const { createAndroid } = require('./android');
const android = createAndroid({ dataDir: core.paths.data, log: core.log, settings: core.settings });

let mainWindow = null;
let tray = null;
let isQuitting = false;
let pollTimer = null;

// Skróty z pulpitu: --droid-run=<urządzenie>:<pakiet> (sama aplikacja) i --droid-system=<urządzenie>
function argAction(argv) {
  for (const a of argv) {
    let m = a.match(/^--droid-run=([^:]+):(.+)$/);
    if (m) return { kind: 'app', avd: m[1], pkg: m[2] };
    m = a.match(/^--droid-system=(.+)$/);
    if (m) return { kind: 'system', avd: m[1] };
  }
  return null;
}
async function runAction(action) {
  try {
    if (action.kind === 'app') await android.launchApp(action.avd, action.pkg, { mode: 'window' });
    else await android.start(action.avd, { headless: false });
  } catch (err) {
    core.log.error('Skrót:', err.message);
    send('droid:notice', { type: 'error', text: err.message });
    if (!mainWindow || !mainWindow.isVisible()) dialog.showErrorBox('Pitaya Droid', err.message);
  }
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quit() {
  isQuitting = true;
  app.quit();
}

function appIcon() {
  const p = path.join(__dirname, 'icon.png');
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : null;
}

async function publishStatus() {
  try {
    const avds = await android.listAvds();
    const on = avds.filter((a) => a.state !== 'off');
    core.setStatus({ devices: avds.length, running: on.map((a) => ({ name: a.name, state: a.state, headless: a.headless, apps: a.apps })) });
    if (tray) tray.setToolTip(on.length ? `Pitaya Droid — działa: ${on.map((a) => a.displayName).join(', ')}` : 'Pitaya Droid');
    send('droid:changed');
  } catch {}
}

function createWindow({ hidden = false } = {}) {
  const icon = appIcon();
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    show: !hidden,
    title: 'Pitaya Droid',
    backgroundColor: '#121116',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload wczytuje core/bridge.js
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (!tray && icon) {
    tray = new Tray(icon.resize({ width: 22, height: 22 }));
    tray.setToolTip('Pitaya Droid');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Otwórz Pitaya Droid', click: showWindow },
      { type: 'separator' },
      { label: 'Zamknij aplikację całkowicie', click: quit },
    ]));
    tray.on('click', () => (mainWindow.isVisible() ? mainWindow.hide() : showWindow()));
  }
}

if (core.singleInstance(() => {})) {
  core.registerIpc({ beforeRestart: () => { isQuitting = true; android.stopAllHeadless(); } });

  // Drugie uruchomienie: ze skrótu → uruchom aplikację Androida, bez skrótu → pokaż okno
  app.on('second-instance', (event, argv) => {
    const action = argAction(argv);
    if (action) runAction(action);
    else showWindow();
  });

  app.whenReady().then(async () => {
    const action = argAction(process.argv);
    createWindow({ hidden: Boolean(action) });
    if (action) runAction(action);
    android.events.on('changed', publishStatus);
    android.events.on('task', (t) => send('droid:task', t));
    android.events.on('license', (l) => { showWindow(); send('droid:license', l); });
    android.events.on('notice', (n) => send('droid:notice', n));
    // Emulatory uruchomione poza aplikacją (Android Studio, terminal) też widać na liście
    pollTimer = setInterval(async () => { await android.refreshForeign(); publishStatus(); }, 5000);
    publishStatus();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    clearInterval(pollTimer);
    // Emulatory w tle nie mają okna — bez aplikacji nie dałoby się ich zamknąć
    android.stopAllHeadless();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  // Polecenia dla huba i innych aplikacji Pitayas
  core.control.handle('devices', () => android.listAvds());
  core.control.handle('start', (a) => android.start(a.avd, { headless: Boolean(a.headless) }).then(() => true));
  core.control.handle('stop', (a) => android.stop(a.avd).then(() => true));
  core.control.handle('install', (a) => android.install(a.avd, a.path));
  core.control.handle('apps', (a) => android.listApps(a.avd));
  core.control.handle('run-app', (a) => android.launchApp(a.avd, a.pkg, { mode: a.mode || 'window' }));
}

// ───── Okno ─────
ipcMain.on('pitaya:win-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('pitaya:win-maximize', () => mainWindow && (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));
ipcMain.on('pitaya:win-close', () => mainWindow && mainWindow.hide());
ipcMain.on('app-quit', quit);

// Błędy wracają do okna jako { ok:false, error }, żeby renderer mógł pokazać komunikat
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { return { ok: true, result: await fn(...args) }; } catch (err) {
      core.log.warn(channel, err.message);
      return { ok: false, error: err.message };
    }
  });
}

handle('droid:check', () => android.check());
handle('droid:setup-sdk', () => android.setupSdk());
handle('droid:task', () => android.getTask());
handle('droid:license', (yes) => android.answerLicense(Boolean(yes)));
handle('droid:images', (opts) => android.listImages(opts || {}));
handle('droid:install-image', (pkg) => android.installImage(pkg));
handle('droid:remove-image', (pkg) => android.removeImage(pkg));
handle('droid:meta', () => ({ devices: android.DEVICES, abi: android.HOST_ABI }));
handle('droid:avds', () => android.listAvds());
handle('droid:create-avd', async (opts) => { const n = await android.createAvd(opts); publishStatus(); return n; });
handle('droid:delete-avd', async (name) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Anuluj', 'Usuń'], defaultId: 0, cancelId: 0,
    message: 'Usunąć urządzenie?', detail: 'Wszystkie dane, zainstalowane aplikacje i pliki w tym urządzeniu zostaną usunięte na zawsze.',
  });
  if (response !== 1) return false;
  await android.deleteAvd(name);
  publishStatus();
  return true;
});
handle('droid:start', (name, opts) => android.start(name, opts || {}).then(() => { core.settings.set('lastAvd', name); return true; }));
handle('droid:stop', (name) => android.stop(name));
handle('droid:apps', (name) => android.listApps(name));
handle('droid:install', (name, file) => android.install(name, file));
handle('droid:uninstall', (name, pkg) => android.uninstall(name, pkg));
handle('droid:launch', (name, pkg, mode) => android.launchApp(name, pkg, { mode }));
handle('droid:pick-apk', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Wybierz aplikację Androida', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Aplikacje Androida', extensions: ['apk', 'xapk', 'apks', 'apkm'] }],
  });
  return r.canceled ? [] : r.filePaths;
});
handle('droid:screenshot', async (name) => {
  const dir = app.getPath('pictures') || os.homedir();
  const file = path.join(dir, `Pitaya-Droid-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`);
  await android.screenshot(name, file);
  shell.showItemInFolder(file);
  return file;
});
handle('droid:pick-sdk', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Folder Android SDK', properties: ['openDirectory'] });
  if (r.canceled) return null;
  core.settings.set('sdkPath', r.filePaths[0]);
  return r.filePaths[0];
});

// Skrót na pulpicie / w menu: jedno kliknięcie otwiera aplikację Androida w osobnym oknie
handle('droid:shortcut', async (name, pkg, label, icon) => {
  if (process.platform !== 'linux') throw new Error('Skróty są na razie tylko dla Linuksa');
  const launch = process.env.APPIMAGE ? [process.env.APPIMAGE]
    : app.isPackaged ? [process.execPath] : [process.execPath, '--no-sandbox', __dirname];
  const quote = (s) => (/[\s"'\\$`]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s);
  const exec = [...launch, `--droid-run=${name}:${pkg}`].map(quote).join(' ');
  const safe = `pitaya-droid-${name}-${pkg}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const body = [
    '[Desktop Entry]', 'Type=Application', `Name=${label}`, `Comment=Android: ${pkg} (Pitaya Droid)`,
    `Exec=${exec}`, `Icon=${icon || path.join(__dirname, 'icon.png')}`, 'Terminal=false', 'Categories=Utility;',
    `StartupWMClass=${label}`, '',
  ].join('\n');
  const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(appsDir, { recursive: true });
  const file = path.join(appsDir, `${safe}.desktop`);
  fs.writeFileSync(file, body, { mode: 0o755 });
  let desktop = null;
  try { desktop = app.getPath('desktop'); } catch {}
  if (desktop && fs.existsSync(desktop)) {
    const d = path.join(desktop, `${safe}.desktop`);
    fs.writeFileSync(d, body, { mode: 0o755 });
  }
  return file;
});
