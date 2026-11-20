#!/usr/bin/env node
/**
 * Create (or edit) a benchmark user-data fixture by launching the app against it.
 *
 *   node scripts/bench/make-fixture.mjs [name]      (default name: default)
 *
 * In the app: log in, set up the S2 scene (display capture + 1 browser source +
 * 1 alert widget + mic), close any dialogs, then quit normally. The fixture lives in
 * .bench/fixtures/<name> — gitignored, because it contains auth tokens.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const name = process.argv[2] || 'default';
const dir = path.join(repo, '.bench', 'fixtures', name);
fs.mkdirSync(dir, { recursive: true });
console.log(`Fixture dir: ${dir}\nLog in, set up the scene, then quit the app.`);

const app = spawn(
  path.join(repo, 'node_modules/electron/dist/electron.exe'),
  [repo, '--skip-update', '--local-bundles'],
  {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', SLOBS_CACHE_DIR: dir },
  },
);
app.on('exit', code => {
  // drop caches/logs that only add noise or size to every copy
  for (const sub of [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'Crashpad',
  ]) {
    fs.rmSync(path.join(dir, 'slobs-client', sub), { recursive: true, force: true });
  }
  console.log(`App exited (${code}). Fixture saved.`);
});
