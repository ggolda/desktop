import { app, ipcMain } from 'electron';
import { isDevMode } from './env';
import { nodeRequire } from './paths';

// crash-handler is an untyped prebuilt native module.
interface CrashHandler {
  startCrashHandler(
    appPath: string,
    version: string,
    isDevMode: string,
    logPath: string,
    ipcUuid: string,
  ): void;
  registerProcess(pid: number, critical: boolean): void;
  unregisterProcess(pid: number): void;
  terminateCrashHandler(pid: number): void;
}

let crashHandler: CrashHandler | null = null;

/** Same as legacy startApp(): start the handler for the main process, let processes register. */
/** SLOBS_NO_CRASH_HANDLER=1 skips it (the native module makes the process exit code 1 on quit). */
export function startCrashHandler() {
  if (process.env.SLOBS_NO_CRASH_HANDLER === '1') return;
  try {
    crashHandler = nodeRequire('crash-handler') as CrashHandler;
    crashHandler.startCrashHandler(
      app.getAppPath(),
      process.env.SLOBS_VERSION!,
      isDevMode.toString(),
      app.getPath('userData'),
      process.env.IPC_UUID!,
    );
    crashHandler.registerProcess(process.pid, false);
  } catch (e) {
    crashHandler = null;
    console.error('[main] crash handler failed to start', e);
    return;
  }

  ipcMain.on('register-in-crash-handler', (_e, arg: { pid: number; critical: boolean }) => {
    crashHandler?.registerProcess(arg.pid, arg.critical);
  });
  ipcMain.on('unregister-in-crash-handler', (_e, arg: { pid: number }) => {
    crashHandler?.unregisterProcess(arg.pid);
  });
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Clean quit, step 1 (before core is told to shut down): the handler treats any registered process
 * that goes away as a crash and terminates the app, so core must be unregistered first. The
 * handler is told over a named pipe, hence the short wait for delivery.
 */
export async function unregisterCoreForShutdown(corePid: number): Promise<void> {
  if (!crashHandler || !corePid) return;
  crashHandler.unregisterProcess(corePid);
  await wait(300);
}

/**
 * Clean quit, step 2 (core is gone): ask the handler to terminate. Main is deliberately NOT
 * unregistered: with main unregistered the process hangs on exit (observed, crash-handler.node).
 */
export async function shutdownCrashHandler(): Promise<void> {
  if (!crashHandler) return;
  crashHandler.terminateCrashHandler(process.pid);
  await wait(300);
}

/** Legacy registered its worker renderer as non-critical; the core process takes that role. */
export function registerCoreProcess(pid: number) {
  if (pid) crashHandler?.registerProcess(pid, false);
}
