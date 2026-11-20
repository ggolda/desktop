// Native context menus for windows (legacy uses Electron menus too: a native OBS display child window
// would cover any DOM menu, and the native look matches legacy). Windows send plain data
// (NativeMenuItem[]); main builds the menu, pops it up at the cursor and returns the chosen id.
import {
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  type MenuItemConstructorOptions,
} from 'electron';
import type { NativeMenuItem } from '../shared/preload-api';

const MAX_ITEMS = 200;
const MAX_DEPTH = 4;

function toTemplate(
  items: unknown,
  choose: (id: string) => void,
  depth = 0,
): MenuItemConstructorOptions[] {
  if (!Array.isArray(items) || depth > MAX_DEPTH) return [];
  return items.slice(0, MAX_ITEMS).flatMap((raw): MenuItemConstructorOptions[] => {
    const it = (raw ?? {}) as NativeMenuItem;
    if (it.type === 'separator') return [{ type: 'separator' }];
    const label = typeof it.label === 'string' ? it.label : '';
    const enabled = it.enabled !== false;
    if (Array.isArray(it.submenu)) {
      return [{ label, enabled, submenu: toTemplate(it.submenu, choose, depth + 1) }];
    }
    const id = typeof it.id === 'string' ? it.id : undefined;
    return [
      {
        label,
        enabled: enabled && id !== undefined,
        // display only: the shortcut itself is handled by the page
        ...(typeof it.accelerator === 'string'
          ? { accelerator: it.accelerator, registerAccelerator: false }
          : {}),
        click: () => id !== undefined && choose(id),
      },
    ];
  });
}

export function registerMenuHandlers() {
  // legacy menus are dark (night theme); Windows native menus follow the app theme source
  nativeTheme.themeSource = 'dark';
  ipcMain.handle('menu:popup', (e, items: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    return new Promise<string | null>(resolve => {
      let chosen: string | null = null;
      const menu = Menu.buildFromTemplate(toTemplate(items, id => (chosen = id)));
      menu.popup({
        window: win,
        // 'click' runs after the popup callback on some platforms: resolve on the next tick
        callback: () => setTimeout(() => resolve(chosen), 0),
      });
    });
  });
}
