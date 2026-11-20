import { app } from 'electron';
import path from 'node:path';
import { appRoot, nodeRequire } from './paths';
import { isProduction, pjson, releaseChannel } from './env';

/** Result of the bundle updater: which complete bundle set is active. */
export interface BundleSet {
  useLocal: boolean;
  /** Directory holding every file of `manifest` (app bundles dir or the completed hotfix cache). */
  setDir: string;
  /** Logical name -> file name (+ checksums). */
  manifest: Record<string, unknown>;
}

// updater/ is compiled by `tsc -p updater` (plain CJS) and shipped unbundled next to app.asar's root.
const updaterFile = (...p: string[]) => path.join(appRoot(), 'updater', ...p);
const load = (...p: string[]) => nodeRequire(updaterFile(...p));

/** Must run before app 'ready'. */
export function registerBundleScheme() {
  load('build', 'bundle-updater.js').registerSchemes();
}

export function runBundleUpdater(): Promise<BundleSet> {
  return load('build', 'bundle-updater.js')(appRoot());
}

/** Legacy flow: app update first (Windows: bootstrap, macOS: electron-updater), then startApp. */
export function updateThenStart(startApp: () => void) {
  const autoUpdate =
    !process.argv.includes('--skip-update') &&
    (isProduction || !!process.env.SLOBS_FORCE_AUTO_UPDATE);
  if (!autoUpdate) return startApp();

  if (process.platform === 'win32') {
    const updateInfo = {
      baseUrl: 'https://slobs-cdn.streamlabs.com',
      version: pjson.version,
      exec: process.argv,
      cwd: process.cwd(),
      waitPids: [process.pid],
      appDir: path.dirname(app.getPath('exe')),
      tempDir: path.join(app.getPath('temp'), 'slobs-updater'),
      cacheDir: app.getPath('userData'),
      versionFileName: `${releaseChannel}.json`,
    };
    load('build', 'bootstrap.js')(updateInfo, startApp, app.exit);
  } else {
    const { Updater } = load('mac', 'Updater.js');
    new Updater(startApp, releaseChannel).run();
  }
}
