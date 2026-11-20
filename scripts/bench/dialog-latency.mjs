#!/usr/bin/env node
/**
 * Dialog open latency: warm (pre-created, hidden) vs on-demand child window.
 *
 *   node scripts/bench/dialog-latency.mjs [--fixture .bench/fixtures/typical] [--reps 5] [--modes warm,ondemand]
 *
 * For each mode: launch, settle, then open+close each dialog `reps` times through the
 * real services. Timings (ms from the service call):
 *   visible = child window shown, title = dialog component mounted, painted = +2 frames.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const fixture = path.resolve(repo, opt('fixture', '.bench/fixtures/typical'));
const reps = Number(opt('reps', 5));
const settleSec = Number(opt('settle', 45));
const modes = opt('modes', 'warm,ondemand').split(',');
const dialogs = opt('dialogs', 'Settings,AddSource').split(',');
const exe = path.join(repo, 'node_modules/electron/dist/electron.exe');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function runMode(mode) {
  const runDir = path.join(repo, '.bench', 'runs', `dialogs_${mode}`);
  fs.rmSync(runDir, { recursive: true, force: true });
  const appData = path.join(runDir, 'appdata');
  const outDir = path.join(runDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(fixture, appData, { recursive: true });

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SLOBS_CACHE_DIR: appData,
    SLOBS_BENCH_OUT: outDir,
    SLOBS_BENCH_SCENARIO: 'S2',
  };
  if (mode === 'warm') env.SLOBS_WARM_CHILD = '1';
  else delete env.SLOBS_WARM_CHILD;
  const app = spawn(exe, [repo, '--skip-update', '--local-bundles'], {
    cwd: repo,
    env,
    stdio: [
      'ignore',
      fs.openSync(path.join(runDir, 'stdout.log'), 'w'),
      fs.openSync(path.join(runDir, 'stderr.log'), 'w'),
    ],
  });
  let exited = false;
  app.on('exit', () => (exited = true));

  const events = () => {
    try {
      return fs
        .readFileSync(path.join(outDir, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l));
    } catch (e) {
      return [];
    }
  };
  const control = c => fs.writeFileSync(path.join(outDir, 'control'), c);
  const waitCount = async (ev, n, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const all = events();
      const err = all.find(e => e.event === 'dialog-error');
      if (err) throw new Error(err.message);
      const list = all.filter(e => e.event === ev);
      if (list.length >= n) return list;
      if (exited) throw new Error('app exited');
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${ev} #${n}`);
  };

  const results = [];
  try {
    await waitCount('main-window-shown', 1, 240_000);
    log(`${mode}: settling ${settleSec}s`);
    await sleep(settleSec * 1000);
    let n = 0;
    for (let r = 0; r < reps; r++) {
      for (const d of dialogs) {
        n++;
        control(`dialog ${d}`);
        const [timing] = (await waitCount('dialog-timing', n, 30_000)).slice(-1);
        const [closed] = (await waitCount('dialog-closed', n, 30_000)).slice(-1);
        results.push({ ...timing, closeMs: closed.ms, destroyed: closed.destroyed });
        log(
          `${mode} ${d} #${r + 1}: visible ${timing.visibleMs} ms, title ${timing.titleMs} ms, painted ${timing.paintedMs} ms (created=${timing.created}, destroyed on close=${closed.destroyed})`,
        );
        await sleep(3000);
      }
    }
  } catch (e) {
    log(`${mode}: ERROR ${e.message}`);
  }
  control('quit');
  const end = Date.now() + 40_000;
  while (!exited && Date.now() < end) await sleep(250);
  if (!exited) {
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' });
    } catch (e) {}
  }
  return results;
}

const median = a => {
  const s = a.filter(x => x != null).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const all = {};
for (const m of modes) {
  all[m] = await runMode(m);
  await sleep(5000);
}
console.log('\nmedian ms (visible / title / painted), first open excluded in parentheses');
for (const m of modes) {
  for (const d of dialogs) {
    const rs = all[m].filter(r => r.name === d);
    const rest = rs.slice(1);
    const f = list =>
      `${median(list.map(r => r.visibleMs))} / ${median(list.map(r => r.titleMs))} / ${median(list.map(r => r.paintedMs))}`;
    console.log(
      `${m.padEnd(9)} ${d.padEnd(10)} all: ${f(rs)}   (repeat: ${f(rest)})   first open painted: ${rs[0]?.paintedMs}`,
    );
  }
}
const outFile = path.join(
  repo,
  '.bench',
  'runs',
  `dialogs_${new Date().toISOString().slice(0, 10)}.json`,
);
fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
log(`raw: ${path.relative(repo, outFile)}`);
