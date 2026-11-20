// Production build of everything: windows (multi-page), preload, core, main, + the updater (tsc).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

fs.rmSync('bundles', { recursive: true, force: true });
fs.rmSync('build', { recursive: true, force: true });
fs.rmSync('updater/build', { recursive: true, force: true });

for (const name of ['windows', 'preload', 'core', 'main']) {
  console.log(`[build] ${name}`);
  await build({ configFile: path.join(root, `vite.${name}.config.ts`), logLevel: 'warn' });
}

console.log('[build] updater');
execSync('npx tsc -p updater', { stdio: 'inherit' });
console.log('[build] done');
