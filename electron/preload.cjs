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
  openTagEditor: (track) => ipcRenderer.invoke('open-tag-editor', track),
  onTagEditorLoad: (callback) => subscribe('tag-editor:load', callback),
  onTagSaved: (callback) => subscribe('tag-editor:saved', callback),
  resizeTagEditor: (contentHeight) => ipcRenderer.send('tag-editor:resize', contentHeight)
});
