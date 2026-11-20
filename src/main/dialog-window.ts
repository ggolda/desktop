// The dialog window (legacy "child window", m1-dialogs-design 3): at most ONE visible, created on demand,
// replaced in place by the next dialog, destroyed on close. Main is generic: entry page, title and
// sizes come from core (DialogWindowSpec), main knows no dialog kinds. Unparented and non-modal, as
// legacy: the main window stays interactive and can cover it.
//
// A dialog window is never shown empty: it is created hidden at its final size and position, the page
// renders (data, fonts, layout) and signals `dialog:ready`, only then main shows it. A replacement is a
// NEW hidden window; it is shown and, two frames later, the old one destroyed (no reload flash).
import { BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
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
/** The visible dialog window (at most one). */
let win: BrowserWindow | null = null;
/** Windows that are created and loading but not shown yet (a replacement, or the first window). */
const pending = new Set<BrowserWindow>();
/** Windows closed because the next dialog took their place: closing them must not focus the main window. */
const replaced = new WeakSet<BrowserWindow>();
/** `webContents.id` -> resolves the window's readiness (the page's `dialog:ready` signal). */
const readyHandlers = new Map<number, () => void>();

/** No page signal within this time after the page loaded: show the window anyway (never stay hidden). */
const READY_FALLBACK_MS = 300;
/** Upper bound from window creation (the page failed to load at all). */
const READY_HARD_MS = 3000;

/** `SLOBS_TRACE_DIALOG=1`: epoch-ms timeline of the dialog window lifecycle on stdout (diagnosis, bench). */
const trace = (event: string, id?: number) => {
  if (process.env.SLOBS_TRACE_DIALOG) {
    console.log(`[dialog-trace] ${Date.now()} ${event} ${id ?? ''}`);
  }
};

export function initDialogWindows(e: Env) {
  env = e;
  // The page signals once its first complete render (data, fonts, layout) is painted (ui/dialog/ready.ts).
  ipcMain.on('dialog:ready', ev => readyHandlers.get(ev.sender.id)?.());
}

const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed();

/** Outer bounds of the new window: size clamped to the work area, centered on the main window or at `keepAt`. */
function geometry(spec: DialogWindowSpec, keepAt?: { x: number; y: number }) {
  const main = env?.mainWindow();
  const parent = alive(main ?? null) ? main!.getBounds() : null;
  const display = parent ? screen.getDisplayMatching(parent) : screen.getPrimaryDisplay();
  const g = placeDialog(spec, parent, display.workArea, spec.position === 'main' || !keepAt);
  if (spec.position === 'keep' && keepAt) return { ...g, x: keepAt.x, y: keepAt.y };
  return g;
}

const urlOf = (spec: DialogWindowSpec) => windowUrl(spec.entry, { dialog: spec.dialogId });

/**
 * Creates the window HIDDEN at its final size and position (nothing moves or resizes after it is shown),
 * starts loading the page and returns it with a promise that resolves when the page is ready to be seen:
 * the page's `dialog:ready` signal, or the fallback timers. Showing is the caller's job.
 */
function create(spec: DialogWindowSpec, g: ReturnType<typeof geometry>) {
  if (!env) throw new WindowError('dialog windows are not initialized', 'ENOTREADY');
  const w = new BrowserWindow({
    ...g,
    minWidth: Math.min(spec.minWidth, g.width),
    minHeight: Math.min(spec.minHeight, g.height),
    show: false,
    paintWhenInitiallyHidden: true, // the page renders (and signals ready) while the window is hidden
    frame: false, // custom title bar in the page, as the legacy child window
    titleBarStyle: 'hidden',
    fullscreenable: false,
    backgroundColor: WINDOW_BG, // = the dialog page background: no flash before the first paint
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
  const wcId = w.webContents.id;
  trace('created', w.id);
  pending.add(w);

  const ready = new Promise<void>(resolve => {
    let soft: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(soft);
      clearTimeout(hard);
      readyHandlers.delete(wcId);
      resolve();
    };
    const hard = setTimeout(done, READY_HARD_MS);
    readyHandlers.set(wcId, () => {
      trace('page-ready', w.id);
      done();
    });
    w.webContents.once('did-finish-load', () => {
      soft = setTimeout(done, READY_FALLBACK_MS);
    });
    w.once('closed', done);
  });

  w.webContents.on('dom-ready', () => {
    trace('dom-ready', w.id);
    // Fresh channel on every page load (also on the title bar's reload button).
    core.connectWindow(w.id, w.webContents);
  });
  w.webContents.on('did-finish-load', () => trace('did-finish-load', w.id));
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
    pending.delete(w);
    readyHandlers.delete(wcId);
    if (win === w) win = null;
    core.sendWindowClosed(id);
    const m = main();
    // legacy: closing a dialog focuses the main window (not when the next dialog replaced it)
    if (!replaced.has(w) && alive(m)) m.focus();
  });
  void w.loadURL(urlOf(spec));
  return { w, ready };
}

/** Resolves after the page produced `n` frames (guarded: never waits more than 100 ms). */
function pageFrames(w: BrowserWindow, n: number) {
  const raf = Array.from({ length: n }, () => 'await new Promise(r => requestAnimationFrame(r));');
  return Promise.race([
    w.webContents.executeJavaScript(`(async () => { ${raf.join(' ')} })()`).catch(() => undefined),
    new Promise(r => setTimeout(r, 100)),
  ]);
}

/**
 * Shows `w` once its page is ready; throws when it was closed meanwhile. A window that is shown starts
 * with the empty background for a frame or two (DWM composes it before the page's frame is presented),
 * which reads as a flash. So it is shown fully transparent first, and made opaque only after the page
 * produced frames while visible: the first frame the user sees is the complete one.
 */
async function showWhenReady(w: BrowserWindow, ready: Promise<void>) {
  await ready;
  if (!alive(w)) throw new WindowError('dialog window closed while opening', 'ENOWINDOW');
  pending.delete(w);
  w.setOpacity(0);
  w.show(); // also focuses
  trace('shown (transparent)', w.id);
  await pageFrames(w, 3);
  if (!alive(w)) throw new WindowError('dialog window closed while opening', 'ENOWINDOW');
  w.setOpacity(1);
  trace('revealed', w.id);
}

export async function openDialogWindow(spec: DialogWindowSpec): Promise<{ windowId: number }> {
  if (alive(win)) return replaceDialogWindow(win.id, spec);
  const { w, ready } = create(spec, geometry(spec));
  await showWhenReady(w, ready);
  win = w;
  return { windowId: w.id };
}

/**
 * Replaces the dialog in place WITHOUT a visible reload: the next dialog's window is created hidden at
 * its final geometry (the old window's position is kept unless the kind changed, as legacy), and only
 * when its page is ready it is shown and, two frames later, the old window destroyed.
 */
export async function replaceDialogWindow(
  windowId: number,
  spec: DialogWindowSpec,
): Promise<{ windowId: number }> {
  const old = BrowserWindow.fromId(windowId);
  if (!alive(old) || old !== win) {
    throw new WindowError(`dialog window ${windowId} not found`, 'ENOWINDOW');
  }
  trace('replace', old.id);
  const b = old.isMaximized() ? old.getNormalBounds() : old.getBounds();
  const { w, ready } = create(spec, geometry(spec, { x: b.x, y: b.y }));
  await showWhenReady(w, ready);
  win = w;
  await pageFrames(w, 1); // the old window goes away once the new one is on screen
  if (alive(old)) {
    replaced.add(old);
    old.destroy();
  }
  return { windowId: w.id };
}

export function closeDialogWindow(windowId: number) {
  const w = BrowserWindow.fromId(windowId);
  if (alive(w) && (w === win || pending.has(w))) w.destroy();
}

/** Main window closed: no dialog outlives it. */
export function closeAllDialogWindows() {
  for (const w of [win, ...pending]) if (alive(w)) w.destroy();
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
