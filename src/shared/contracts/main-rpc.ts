import type { PathFilter } from './properties';

// Typed requests from core to the main process (SPEC 2 "main RPC"). Transport: `rpc` / `rpc-result`
// messages in src/shared/protocol.ts. Only Electron-only APIs belong here; M1 needs the native handle.

export interface MainRpcMethods {
  /**
   * Native window handle (HWND on Windows) of a BrowserWindow, as the bytes of
   * `getNativeWindowHandle()` (8 bytes on 64-bit Windows). `windowId` is the id main passed in the
   * `window-port` message. Fails with code ENOWINDOW when the window is gone.
   */
  'window.nativeHandle': { args: [windowId: number]; result: Uint8Array };

  /**
   * Creates the dialog window, or reuses the existing one (legacy has ONE child window, created on demand
   * and destroyed on close): then it behaves like `dialogWindow.replace`. Returns before the page loads;
   * the page connects through the normal `window-port` path. See docs m1-dialogs-design.md 3.
   */
  'dialogWindow.open': { args: [spec: DialogWindowSpec]; result: { windowId: number } };
  /** Swaps the content of an open dialog window (title, size, entry page). Fails with ENOWINDOW. */
  'dialogWindow.replace': { args: [windowId: number, spec: DialogWindowSpec]; result: void };
  /** Closes (destroys) a dialog window and focuses the main window. No error when it is gone. */
  'dialogWindow.close': { args: [windowId: number]; result: void };

  /** Native error box (legacy `dialog.showErrorBox`), parented to `windowId` when it exists. */
  'dialog.showError': { args: [windowId: number, title: string, message: string]; result: void };
  /** Native open dialog, parented to `windowId`. Cancel resolves with `canceled: true`. */
  'dialog.showOpen': {
    args: [windowId: number, options: NativeOpenOptions];
    result: { canceled: boolean; paths: string[] };
  };
  /** Native save dialog, parented to `windowId`. */
  'dialog.showSave': {
    args: [windowId: number, options: NativeSaveOptions];
    result: { canceled: boolean; path: string | null };
  };
}

/**
 * Everything main needs to show a dialog window. Sizes and titles come from core (hotfixable), so main
 * stays generic and never learns about dialog kinds.
 */
export interface DialogWindowSpec {
  /** Appended to the page URL as `?dialog=<dialogId>`. */
  dialogId: string;
  /** Window page name, as for `windowUrl(name)`: `dialog-<kind>`. */
  entry: string;
  /** Initial and OS (taskbar) title. */
  title: string;
  /** Outer size in DIP. Main clamps it to the work area of the display of the main window. */
  width: number;
  height: number;
  /** Legacy sets the minimum size to the opening size (the window can only grow). */
  minWidth: number;
  minHeight: number;
  /** `main`: centered on the main window's bounds. `keep`: do not move (used when the kind is unchanged). */
  position: 'main' | 'keep';
}

export interface NativeOpenOptions {
  properties: ('openFile' | 'openDirectory' | 'multiSelections')[];
  defaultPath?: string;
  filters?: PathFilter[];
}

export interface NativeSaveOptions {
  defaultPath?: string;
  filters?: PathFilter[];
}

export type MainRpcMethod = keyof MainRpcMethods;
