// The dialog window (legacy "child window", m1-dialogs-design 3): at most ONE, created on demand,
// replaced in place by the next dialog, destroyed on close. Main is generic: entry page, title and
// sizes come from core (DialogWindowSpec), main knows no dialog kinds. Unparented and non-modal, as
// legacy: the main window stays interactive and can cover it.
import { BrowserWindow, dialog, screen, shell } from 'electron';
import type { DialogWindowSpec, NativeOpenOptions, NativeSaveOptions } from '../shared/contracts';
import type { CoreProcess } from './core-process';
import { placeDialog } from './dialog-geometry';
import { WINDOW_BG } from './main-window';
import { windowUrl } from './window-url';

export class WindowError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

interface Env {
  core: Pick<CoreProcess, 'connectWindow' | 'sendWindowClosed'>;
  preloadPath: string;
  /** The main window, for centering, display lookup and focus on close. */
  mainWindow: () => BrowserWindow | null;
}

let env: Env | null = null;
let win: BrowserWindow | null = null;

export function initDialogWindows(e: Env) {
  env = e;
}

const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed();

function geometry(spec: DialogWindowSpec) {
  const main = env?.mainWindow();
  const parent = alive(main ?? null) ? main!.getBounds() : null;
  const display = parent ? screen.getDisplayMatching(parent) : screen.getPrimaryDisplay();
  return placeDialog(spec, parent, display.workArea, spec.position === 'main');
}

const urlOf = (spec: DialogWindowSpec) => windowUrl(spec.entry, { dialog: spec.dialogId });

function create(spec: DialogWindowSpec): BrowserWindow {
  if (!env) throw new WindowError('dialog windows are not initialized', 'ENOTREADY');
  const g = geometry(spec);
  const w = new BrowserWindow({
    ...g,
    minWidth: Math.min(spec.minWidth, g.width),
    minHeight: Math.min(spec.minHeight, g.height),
    show: false,
    frame: false, // custom title bar in the page, as the legacy child window
    titleBarStyle: 'hidden',
    fullscreenable: false,
    backgroundColor: WINDOW_BG,
    title: spec.title,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: env.preloadPath,
    },
  });
  const core = env.core;
  const main = env.mainWindow;
  w.once('ready-to-show', () => w.show());
  // Fresh channel on every page load (also on replace and on the title bar's reload button).
  w.webContents.on('dom-ready', () => core.connectWindow(w.id, w.webContents));
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) e.preventDefault();
  });
  const id = w.id;
  w.on('maximize', () => !w.isDestroyed() && w.webContents.send('window:maximized', true));
  w.on('unmaximize', () => !w.isDestroyed() && w.webContents.send('window:maximized', false));
  w.on('closed', () => {
    if (win === w) win = null;
    core.sendWindowClosed(id);
    const m = main();
    if (alive(m)) m.focus(); // legacy: closing a dialog focuses the main window
  });
  return w;
}

export function openDialogWindow(spec: DialogWindowSpec): { windowId: number } {
  if (alive(win)) {
    replaceDialogWindow(win.id, spec);
    return { windowId: win.id };
  }
  win = create(spec);
  void win.loadURL(urlOf(spec));
  return { windowId: win.id };
}

export function replaceDialogWindow(windowId: number, spec: DialogWindowSpec) {
  const w = BrowserWindow.fromId(windowId);
  if (!alive(w) || w !== win) {
    throw new WindowError(`dialog window ${windowId} not found`, 'ENOWINDOW');
  }
  const g = geometry(spec);
  w.setTitle(spec.title);
  if (w.isMaximized()) w.unmaximize();
  // legacy: the minimum size is the opening size (the window can only grow)
  w.setMinimumSize(1, 1);
  w.setSize(g.width, g.height);
  if (g.x !== undefined && g.y !== undefined) w.setPosition(g.x, g.y);
  w.setMinimumSize(Math.min(spec.minWidth, g.width), Math.min(spec.minHeight, g.height));
  void w.loadURL(urlOf(spec));
}

export function closeDialogWindow(windowId: number) {
  const w = BrowserWindow.fromId(windowId);
  if (alive(w) && w === win) w.destroy();
}

/** Main window closed: no dialog outlives it. */
export function closeAllDialogWindows() {
  if (alive(win)) win.destroy();
}

// ---- native dialogs -----------------------------------------------------------------------

const parentOf = (windowId: number) => {
  const w = BrowserWindow.fromId(windowId);
  return alive(w) ? w : undefined;
};

export async function showOpen(windowId: number, o: NativeOpenOptions) {
  const opts: Electron.OpenDialogOptions = {
    properties: o.properties,
    ...(o.defaultPath ? { defaultPath: o.defaultPath } : {}),
    ...(o.filters?.length ? { filters: o.filters } : {}),
  };
  const parent = parentOf(windowId);
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return { canceled: r.canceled, paths: r.filePaths };
}

export async function showSave(windowId: number, o: NativeSaveOptions) {
  const opts: Electron.SaveDialogOptions = {
    ...(o.defaultPath ? { defaultPath: o.defaultPath } : {}),
    ...(o.filters?.length ? { filters: o.filters } : {}),
  };
  const parent = parentOf(windowId);
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  return { canceled: r.canceled, path: r.filePath ?? null };
}

export async function showError(windowId: number, title: string, message: string) {
  const opts: Electron.MessageBoxOptions = { type: 'error', title, message, buttons: ['OK'] };
  const parent = parentOf(windowId);
  if (parent) await dialog.showMessageBox(parent, opts);
  else await dialog.showMessageBox(opts);
}
