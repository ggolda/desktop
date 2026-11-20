// Launches the built app with SLOBS_SMOKE=1 and verifies: OBS init, window shown, one ping round
// trip, clean quit, and that the obs64 process we started is gone within 15 s.
// Prerequisite: `npm run build`. Uses a throw-away userData dir.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'slobs-smoke-'));

const obsPids = () => pidsOf('obs64.exe');
function pidsOf(image) {
  if (process.platform !== 'win32') return [];
  try {
    return execSync(`tasklist /FI "IMAGENAME eq ${image}" /FO CSV /NH`, { encoding: 'utf8' })
      .split('\n')
      .map(l => l.split('","')[1])
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// crash-handler-process outlives the app by design (legacy tests kill it too): clean up ours.
const crashPids = () => pidsOf('crash-handler-process.exe');
const beforeCrash = new Set(crashPids());
const before = new Set(obsPids());
const child = spawn(electron, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    SLOBS_SMOKE: '1',
    SLOBS_USERDATA_DIR: userData,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

let result = null;
let buf = '';
child.stdout.on('data', d => {
  buf += d;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const l of lines) {
    if (l.startsWith('{"ok"')) result = JSON.parse(l);
    else process.stderr.write(`[app] ${l}\n`);
  }
});

const killer = setTimeout(() => child.kill(), 90_000);
const code = await new Promise(resolve => child.on('exit', resolve));
clearTimeout(killer);

let leaked = [];
for (let i = 0; i < 30; i++) {
  leaked = obsPids().filter(p => !before.has(p));
  if (!leaked.length) break;
  await sleep(500);
}
// crash-handler-process must terminate on its own after a clean quit (checked for up to 10 s)
let crashLeft = [];
for (let i = 0; i < 20; i++) {
  crashLeft = crashPids().filter(p => !beforeCrash.has(p));
  if (!crashLeft.length) break;
  await sleep(500);
}
for (const pid of crashLeft) {
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
}
await sleep(500);
// crash-handler-process may still hold its log for a moment after the app quit
try {
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch {
  console.error(`smoke: could not remove ${userData} (crash handler still running?)`);
}

const ok = !!result?.ok && code === 0 && leaked.length === 0 && crashLeft.length === 0;
console.log(JSON.stringify(result ?? { ok: false, error: 'no result line' }));
if (!ok) {
  console.error(
    `smoke failed: exit=${code} leakedObs64=${leaked.join(',') || 'none'} leakedCrashHandler=${crashLeft.join(',') || 'none'}`,
  );
  process.exit(1);
}
