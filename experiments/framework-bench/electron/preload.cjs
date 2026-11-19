// Sandboxed preload: forwards the core MessagePort to the page and reports first paint.
const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('core-port', e => window.postMessage('core-port', '*', e.ports));
contextBridge.exposeInMainWorld('bench', {
  painted: () => ipcRenderer.send('painted', performance.now()),
});
