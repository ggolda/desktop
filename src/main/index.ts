// Electron main process (thin; SPEC 2). Lives in app.asar, not hotfixable.
import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { CoreProcess } from './core-process';
import {
  registerCoreProcess,
  shutdownCrashHandler,
  startCrashHandler,
  unregisterCoreForShutdown,
} from './crash';
import './env';
import { registerMenuHandlers } from './menu';
import { closeAllDialogWindows, initDialogWindows } from './dialog-window';
import { createMainWindow, registerWindowControls } from './main-window';
import { resolveUserData } from './paths';
import { attachCore, deliverLinksFromArgv, initProtocolLinks } from './protocol-links';
import { runSmoke } from './smoke';
import { registerBundleScheme, runBundleUpdater, updateThenStart } from './updates';

const userData = resolveUserData();
app.setPath('userData', userData);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let core: CoreProcess | null = null;
  let shuttingDown = false;
  let shutdownDone = false;
  let corePid = 0;

  // Must be registered before 'ready' (ES modules over slbundle://).
  registerBundleScheme();
  initProtocolLinks();

  app.on('second-instance', (_e, argv) => {
    deliverLinksFromArgv(argv);
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('before-quit', e => {
    if (shutdownDone || !core) return;
    e.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void unregisterCoreForShutdown(corePid)
      .then(() => core!.shutdown())
      .then(r => {
        if (!r.ok) console.error(`[main] core shutdown: ${r.error}`);
        shutdownDone = true;
        void shutdownCrashHandler().then(() => {
          app.quit();
        });
      });
  });

  app.on('window-all-closed', () => app.quit());

  // scripts/dev.mjs asks for a graceful quit (so OBS shuts down) over the IPC channel.
  process.on('message', m => {
    if (m === 'slobs:quit') app.quit();
  });

  // Same flow as the legacy main.js: (app update) -> crash handler -> bundle updater -> windows.
  async function startApp() {
    // legacy has no application menu on Windows; mac keeps a minimal one for the copy/paste shortcuts
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
      );
    } else Menu.setApplicationMenu(null);
    startCrashHandler();
    const set = await runBundleUpdater();
    const file = (logical: string) => path.join(set.setDir, set.manifest[logical] as string);
    console.log(`[main] bundle set: ${set.useLocal ? 'local' : 'hotfix'} (${set.setDir})`);

    registerWindowControls();
    registerMenuHandlers();
    core = new CoreProcess({
      userData,
      appPath: app.getAppPath(),
      version: app.getVersion(),
      modulePath: file('core.js'),
    });
    void core.spawned.then(pid => {
      corePid = pid;
      registerCoreProcess(pid);
    });
    attachCore(core);
    const main = createMainWindow(core, file('preload.js'), userData);
    initDialogWindows({
      core,
      preloadPath: file('preload.js'),
      mainWindow: () => (main.win.isDestroyed() ? null : main.win),
    });
    main.win.on('closed', closeAllDialogWindows);
    if (process.env.SLOBS_SMOKE === '1')
      void runSmoke(core, main, {
        set: set.useLocal ? 'local' : 'hotfix',
        corePath: file('core.js'),
      });
  }

  void app.whenReady().then(() =>
    updateThenStart(() => {
      startApp().catch(e => {
        console.error('[main] startup failed', e);
        app.exit(1);
      });
    }),
  );
}
