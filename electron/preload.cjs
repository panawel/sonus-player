const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  readFiles: () => ipcRenderer.invoke('fs:readFiles'),
  parseFiles: (filePaths) => ipcRenderer.invoke('fs:parseFiles', filePaths),
  // Electron's sandboxed preload doesn't expose Node's pathToFileURL, so build
  // the file:// URL manually, percent-encoding each path segment.
  getAudioSrc: (filePath) => 'file://' + filePath.split('/').map(encodeURIComponent).join('/'),
  writeTag: (filePath, tags) => ipcRenderer.invoke('fs:writeTag', filePath, tags),
  readArtwork: (filePath) => ipcRenderer.invoke('fs:readArtwork', filePath),
  revealInFolder: (filePath) => ipcRenderer.invoke('fs:revealInFolder', filePath),
  checkPaths: (paths) => ipcRenderer.invoke('fs:checkPaths', paths),
  loadLibraryState: () => ipcRenderer.invoke('library:load'),
  saveLibraryState: (state) => ipcRenderer.send('library:save', state),
  saveLibraryStateSync: (state) => ipcRenderer.sendSync('library:save-sync', state),
  // The session (electron/session.mjs): how the app was, restored on the next launch.
  saveSession: (state) => ipcRenderer.send('session:save', state),
  saveSessionSync: (state) => ipcRenderer.sendSync('session:save-sync', state),
  recordPlay: (filePath) => ipcRenderer.invoke('stats:recordPlay', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),
  writeClipboardImage: (dataUrl) => ipcRenderer.invoke('clipboard:writeImage', dataUrl),
  openExternalUrl: (url) => ipcRenderer.send('open-external-url', url),
  onOpenExternalFile: (callback) => subscribe('open-external-file', callback),
  onServiceAction: (callback) => subscribe('service-action', callback),
  onLibraryUpdated: (callback) => subscribe('library:updated', callback),
  onReindexProgress: (callback) => subscribe('reindex:progress', callback),
  onSelectAll: (callback) => subscribe('menu-select-all', callback),
  onFind: (callback) => subscribe('menu-find', callback),
  onMenuCommand: (callback) => subscribe('menu-command', callback),
  setMenuState: (state) => ipcRenderer.send('menu:set-state', state),
  openTagEditor: (track) => ipcRenderer.invoke('open-tag-editor', track),
  onTagEditorLoad: (callback) => subscribe('tag-editor:load', callback),
  onTagSaved: (callback) => subscribe('tag-editor:saved', callback),
  resizeTagEditor: (contentHeight) => ipcRenderer.send('tag-editor:resize', contentHeight),
  setMiniChromeTracking: (enabled) => ipcRenderer.send('window:mini-chrome-tracking', enabled),
  onPointerInside: (callback) => subscribe('window:pointer-inside', callback),
  restoreFromMini: (size) => ipcRenderer.send('window:restore-from-mini', size),
  setChillChromeTracking: (enabled) => ipcRenderer.send('window:chill-chrome-tracking', enabled),
  onPointerMoved: (callback) => subscribe('window:pointer-moved', callback),
  setWindowButtonsVisible: (visible) => ipcRenderer.send('window:set-buttons-visible', visible),
  dragWindow: (phase) => ipcRenderer.send('window:drag', phase),
  // Strip mode (main.js owns it): the slim player beside the Dock is its own window
  // (StripApp.jsx) while the main window is hidden and keeps playing. The main window is told
  // when it's on, reports what is playing; the strip window gets that and sends commands back.
  getStripMode: () => ipcRenderer.invoke('window:get-strip-mode'),
  onStripMode: (callback) => subscribe('window:strip-mode', callback),
  sendStripState: (state) => ipcRenderer.send('strip:state', state),
  onStripCommand: (callback) => subscribe('strip:command', callback),
  getStripState: () => ipcRenderer.invoke('strip:get-state'),
  onStripState: (callback) => subscribe('strip:state', callback),
  stripCommand: (cmd, value) => ipcRenderer.send('strip:command', { cmd, value }),
  exitStripMode: () => ipcRenderer.send('window:strip-exit'),
  // The top bar's Chill tab in a narrow window: fill the screen, then open Chill (File > Chill Mode)
  enterChillMode: () => ipcRenderer.send('window:enter-chill'),
});
