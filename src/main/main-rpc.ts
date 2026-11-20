// Main-side handlers for core `rpc` requests (contracts/main-rpc.ts). Only Electron-only APIs.
import { BrowserWindow } from 'electron';
import type { MainRpcMethods } from '../shared/contracts/main-rpc';
import {
  WindowError,
  closeDialogWindow,
  openDialogWindow,
  replaceDialogWindow,
  showError,
  showOpen,
  showSave,
} from './dialog-window';
import type { CoreToMainMessage, MainToCoreMessage } from '../shared/protocol';

type Handlers = {
  [M in keyof MainRpcMethods]: (
    ...args: MainRpcMethods[M]['args']
  ) => MainRpcMethods[M]['result'] | Promise<MainRpcMethods[M]['result']>;
};

const RpcError = WindowError;

export const handlers: Handlers = {
  'window.nativeHandle': windowId => {
    const win = typeof windowId === 'number' ? BrowserWindow.fromId(windowId) : null;
    if (!win || win.isDestroyed()) throw new RpcError(`window ${windowId} not found`, 'ENOWINDOW');
    const h = win.getNativeWindowHandle();
    // Fresh, exactly-sized Uint8Array (a Buffer may be a view into a shared pool).
    const out = new Uint8Array(h.byteLength);
    out.set(h);
    return out;
  },
  // Dialog windows: contract in contracts/main-rpc.ts, design in docs/rework/chapter2/m1-dialogs-design.md.
  'dialogWindow.open': spec => openDialogWindow(spec),
  'dialogWindow.replace': (windowId, spec) => replaceDialogWindow(windowId, spec),
  'dialogWindow.close': windowId => closeDialogWindow(windowId),
  'dialog.showOpen': (windowId, options) => showOpen(windowId, options),
  'dialog.showSave': (windowId, options) => showSave(windowId, options),
  'dialog.showError': (windowId, title, message) => showError(windowId, title, message),
};

/** Runs one request; errors become results, never exceptions. */
export async function handleRpc(
  msg: Extract<CoreToMainMessage, { type: 'rpc' }>,
): Promise<Extract<MainToCoreMessage, { type: 'rpc-result' }>> {
  const fn = (handlers as Record<string, ((...a: unknown[]) => unknown) | undefined>)[msg.method];
  if (!fn || !Object.prototype.hasOwnProperty.call(handlers, msg.method)) {
    return {
      type: 'rpc-result',
      id: msg.id,
      ok: false,
      error: { message: `unknown main rpc method ${msg.method}`, code: 'ENOMETHOD' },
    };
  }
  try {
    const value = await fn(...(Array.isArray(msg.args) ? msg.args : []));
    return { type: 'rpc-result', id: msg.id, ok: true, value };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return {
      type: 'rpc-result',
      id: msg.id,
      ok: false,
      error: { message: err?.message ?? String(e), ...(err?.code ? { code: err.code } : {}) },
    };
  }
}
