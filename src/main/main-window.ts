import { BrowserWindow, ipcMain, shell } from 'electron';
import type { CoreProcess } from './core-process';
import fs from 'node:fs';
import path from 'node:path';
import { screen } from 'electron';
import { windowUrl } from './window-url';

/** Matches --background of the night theme (legacy @dark-3). */
export const WINDOW_BG = '#17242D';

export interface MainWindowHandle {
  win: BrowserWindow;
  /** ms from window creation to ready-to-show. */
  shown: Promise<number>;
}

interface SavedState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const stateFile = (dir: string) => path.join(dir, 'window-state.json');

function loadState(dir: string): SavedState | null {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')) as SavedState;
    if (!(s.width >= 200 && s.height >= 200)) return null;
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      // Drop the position when it is no longer on any display.
      const visible = screen.getAllDisplays().some(d => {
        const b = d.workArea;
        return (
          s.x! + 100 > b.x &&
          s.x! < b.x + b.width - 100 &&
          s.y! >= b.y - 10 &&
          s.y! < b.y + b.height - 50
        );
      });
      if (!visible) return { width: s.width, height: s.height, maximized: !!s.maximized };
    }
    return s;
  } catch {
    return null;
  }
}

function saveState(dir: string, win: BrowserWindow) {
  try {
    const b = win.getNormalBounds();
    const s: SavedState = { ...b, maximized: win.isMaximized() };
    fs.writeFileSync(stateFile(dir), JSON.stringify(s));
  } catch {
    // best effort
  }
}

export function createMainWindow(
  core: CoreProcess,
  preloadPath: string,
  userData: string,
): MainWindowHandle {
  const t0 = performance.now();
  const saved = loadState(userData);
  const win = new BrowserWindow({
    width: saved?.width ?? 1469,
    height: saved?.height ?? 870,
    ...(saved && typeof saved.x === 'number' && typeof saved.y === 'number'
      ? { x: saved.x, y: saved.y }
      : {}),
    minWidth: 800,
    minHeight: 600, // legacy main window
    show: false,
    frame: false, // custom title bar (src/windows/main/components/TitleBar.vue), as legacy
    titleBarStyle: 'hidden',
    backgroundColor: WINDOW_BG,
    title: 'Streamlabs Desktop',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  const shown = new Promise<number>(resolve => {
    win.once('ready-to-show', () => {
      if (saved?.maximized) win.maximize();
      win.show();
      resolve(Math.round(performance.now() - t0));
    });
  });

  const sendMax = (v: boolean) => !win.isDestroyed() && win.webContents.send('window:maximized', v);
  win.on('maximize', () => sendMax(true));
  win.on('unmaximize', () => sendMax(false));

  // Persist bounds on close (userData JSON, not localStorage).
  win.on('close', () => saveState(userData, win));

  // Fresh channel on every page load (also after a dev reload).
  win.webContents.on('dom-ready', () => core.connectWindow(win.id, win.webContents));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  const url = windowUrl('main');
  console.log(`[main] loading ${url}`);
  void win.loadURL(url);
  return { win, shown };
}

export function registerWindowControls() {
  const from = (e: { sender: Electron.WebContents }) => BrowserWindow.fromWebContents(e.sender);
  ipcMain.on('window:minimize', e => from(e)?.minimize());
  ipcMain.on('window:maximize', e => {
    const w = from(e);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('window:close', e => from(e)?.close());
  ipcMain.handle('window:isMaximized', e => from(e)?.isMaximized() ?? false);
}
