const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { makeBridge } = require('./core/bridge');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('droid', {
  check: call('droid:check'),
  setupSdk: call('droid:setup-sdk'),
  task: call('droid:task'),
  answerLicense: call('droid:license'),
  images: call('droid:images'),
  installImage: call('droid:install-image'),
  removeImage: call('droid:remove-image'),
  meta: call('droid:meta'),
  avds: call('droid:avds'),
  createAvd: call('droid:create-avd'),
  deleteAvd: call('droid:delete-avd'),
  start: call('droid:start'),
  stop: call('droid:stop'),
  apps: call('droid:apps'),
  install: call('droid:install'),
  uninstall: call('droid:uninstall'),
  launch: call('droid:launch'),
  pickApk: call('droid:pick-apk'),
  pickSdk: call('droid:pick-sdk'),
  screenshot: call('droid:screenshot'),
  shortcut: call('droid:shortcut'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onChanged: (cb) => ipcRenderer.on('droid:changed', () => cb()),
  onTask: (cb) => ipcRenderer.on('droid:task', (e, t) => cb(t)),
  onLicense: (cb) => ipcRenderer.on('droid:license', (e, l) => cb(l)),
  onNotice: (cb) => ipcRenderer.on('droid:notice', (e, n) => cb(n)),
  quit: () => ipcRenderer.send('app-quit'),
});

// Pasek okna, ustawienia, folder danych i aktualizacje — wspólne z innymi aplikacjami (Pitaya Core)
contextBridge.exposeInMainWorld('pitayaBridge', makeBridge(ipcRenderer));
