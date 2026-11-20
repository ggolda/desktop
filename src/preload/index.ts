// The single sandboxed preload for every window. Exposes only connectCore() + window controls.
import { contextBridge, ipcRenderer } from 'electron';
import type { RebornBridge } from '../shared/preload-api';
import { CORE_PORT_MESSAGE } from '../shared/protocol';

let port: MessagePort | null = null;
let wanted = false;

function deliver() {
  if (port && wanted) {
    // contextBridge cannot carry MessagePorts, so hand it over with window.postMessage.
    window.postMessage(CORE_PORT_MESSAGE, '*', [port]);
    port = null;
    wanted = false;
  }
}

ipcRenderer.on('core-port', e => {
  port = e.ports[0] ?? null;
  deliver();
});

const bridge: RebornBridge = {
  connectCore() {
    wanted = true;
    deliver();
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
    onMaximizedChange(cb) {
      const handler = (_e: unknown, v: boolean) => cb(v);
      ipcRenderer.on('window:maximized', handler);
      return () => void ipcRenderer.removeListener('window:maximized', handler);
    },
  },
  menu: {
    popup: items => ipcRenderer.invoke('menu:popup', items) as Promise<string | null>,
  },
};

contextBridge.exposeInMainWorld('reborn', bridge);
