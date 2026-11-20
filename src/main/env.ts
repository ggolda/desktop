import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';

interface PackageJson {
  version: string;
  /** Set to 'production' by electron-builder (extraMetadata) in release builds. */
  env?: string;
  /** Set by electron-builder/poc.config.js. */
  poc?: boolean;
}

export const pjson: PackageJson = JSON.parse(
  fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'),
);

// Same environment contract as the legacy main.js: the updaters and crash handler read these.
if (pjson.env === 'production') process.env.NODE_ENV = 'production';
process.env.SLOBS_VERSION = pjson.version;
process.env.IPC_UUID = `slobs-${crypto.randomUUID()}`;

export const isProduction = process.env.NODE_ENV === 'production';
export const isDevMode = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

/** The channel is the first prerelease identifier of the version, otherwise `latest`. */
export const releaseChannel = ((): string => {
  const components = semver.prerelease(pjson.version);
  return components ? String(components[0]) : 'latest';
})();
