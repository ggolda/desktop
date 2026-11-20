import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Root of the app: the repo in dev, app.asar when packaged. */
export const appRoot = () => app.getAppPath();

/** Built bundle set: preload, core, windows. */
export const bundlesDir = () => path.join(appRoot(), 'bundles');

/** Native modules live outside the asar when packaged. */
export function unpacked(p: string): string {
  return p.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
}

export const osnDir = () => unpacked(path.join(appRoot(), 'node_modules', 'obs-studio-node'));

/**
 * Dev runs must never touch the real profile. Packaged builds keep the legacy path
 * (%APPDATA%/slobs-client) so user data stays compatible. Override with SLOBS_USERDATA_DIR.
 */
export function resolveUserData(): string {
  if (process.env.SLOBS_USERDATA_DIR) return path.resolve(process.env.SLOBS_USERDATA_DIR);
  if (!app.isPackaged) return path.join(app.getPath('appData'), 'slobs-client-reborn-dev');
  return path.join(app.getPath('appData'), 'slobs-client');
}

/** require() for runtime-resolved, never-bundled code (native modules, updater/ build output). */
export const nodeRequire = createRequire(path.join(app.getAppPath(), 'package.json'));
