// Build + electron-builder. Usage: node scripts/package.mjs [--nosign] [--poc] [--skip-build]
//   npm run package | package:nosign | package:poc
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
const env = { ...process.env };
if (args.includes('--nosign') || args.includes('--poc')) env.SLOBS_NO_SIGN = 'true';
const config = args.includes('--poc') ? 'poc' : 'base';

const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!args.includes('--skip-build')) run('node', ['scripts/build.mjs']);
fs.rmSync('dist', { recursive: true, force: true });
run('npx', [
  'electron-builder',
  'build',
  '-w',
  '--x64',
  '--config',
  `electron-builder/${config}.config.js`,
]);
