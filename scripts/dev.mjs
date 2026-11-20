// Dev loop: Vite dev server (HMR) for windows + rebuild-on-change for main/preload/core.
// Electron is restarted gracefully (OBS shut down) when main, preload or core rebuild.
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const electronPath = createRequire(import.meta.url)('electron');
const cfg = name => path.join(root, `vite.${name}.config.ts`);

// The bundle updater / bootstrap are plain tsc output that main loads at runtime.
execSync('npx tsc -p updater', { stdio: 'inherit' });

const server = await createServer({ configFile: cfg('windows') });
await server.listen();
const devUrl = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
console.log(`[dev] windows served at ${devUrl}`);

let electron = null;
let restartTimer = null;
let stopping = false;

function stopElectron() {
  const proc = electron;
  if (!proc || proc.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const hard = setTimeout(() => proc.kill(), 15_000);
    proc.once('exit', () => {
      clearTimeout(hard);
      resolve();
    });
    if (proc.connected) proc.send('slobs:quit');
    else proc.kill();
  });
}

async function startElectron() {
  await stopElectron();
  if (stopping) return;
  console.log('[dev] starting electron');
  const proc = spawn(electronPath, ['.'], {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  electron = proc;
  proc.on('exit', () => {
    // The user closed the window (not a restart): shut the dev loop down.
    if (electron === proc && !stopping && !restarting) void shutdown();
  });
}

let restarting = false;
function scheduleRestart(reason) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    console.log(`[dev] ${reason} rebuilt, restarting electron`);
    restarting = true;
    await startElectron();
    restarting = false;
  }, 300);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stopElectron();
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Watch-build the Node side. First END of every watcher => start electron.
const names = ['main', 'preload', 'core'];
const ready = new Set();
for (const name of names) {
  const watcher = await build({
    configFile: cfg(name),
    logLevel: 'warn',
    mode: 'development',
    build: { watch: {}, minify: false },
  });
  watcher.on('event', e => {
    if (e.code === 'ERROR') console.error(`[dev] ${name} build error:`, e.error.message);
    if (e.code !== 'END') return;
    if (ready.size < names.length) {
      ready.add(name);
      if (ready.size === names.length) void startElectron();
    } else {
      scheduleRestart(name);
    }
  });
}
