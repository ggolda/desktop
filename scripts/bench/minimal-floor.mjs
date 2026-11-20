#!/usr/bin/env node
// Measures the minimal Electron app (scripts/bench/minimal-app) with the same sampler.
//   node scripts/bench/minimal-floor.mjs [--hidden] [--settle 20] [--sample 30]
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const settle = Number(opt('settle', 20)),
  sample = Number(opt('sample', 30));
const samples = [],
  cmds = new Map();
const sampler = spawn(
  'powershell',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(here, 'sampler.ps1'),
    '-Names',
    'electron',
  ],
  { stdio: ['ignore', 'pipe', 'ignore'] },
);
readline.createInterface({ input: sampler.stdout }).on('line', l => {
  try {
    const s = JSON.parse(l);
    const p = s.p == null ? [] : Array.isArray(s.p) ? s.p : [s.p];
    (s.cmd == null ? [] : Array.isArray(s.cmd) ? s.cmd : [s.cmd]).forEach(c =>
      cmds.set(c.pid, c.cmd),
    );
    samples.push({ t: s.t, p });
  } catch (e) {}
});
const env = { ...process.env };
if (argv.includes('--hidden')) env.FLOOR_HIDDEN = '1';
if (argv.includes('--content')) env.FLOOR_CONTENT = '1';
if (argv.includes('--pulse')) env.FLOOR_PULSE = '1';
const app = spawn(
  path.join(repo, 'node_modules/electron/dist/electron.exe'),
  [path.join(here, 'minimal-app')],
  { env, stdio: 'ignore' },
);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(settle * 1000);
const t0 = Date.now();
await sleep(sample * 1000);
const t1 = Date.now();
try {
  execFileSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' });
} catch (e) {}
sampler.kill();
// tree from root
const tree = new Set([app.pid]);
for (const s of samples) {
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of s.p)
      if (!tree.has(p.pid) && tree.has(p.ppid)) {
        tree.add(p.pid);
        grew = true;
      }
  }
}
const win = samples.filter(s => s.t >= t0 && s.t <= t1);
const cores = os.cpus().length,
  MB = 1048576;
const per = new Map();
let prev = new Map();
for (const s of samples) {
  for (const p of s.p) {
    if (!tree.has(p.pid)) continue;
    const pr = prev.get(p.pid);
    if (s.t >= t0 && s.t <= t1) {
      const e = per.get(p.pid) || { mem: [], priv: [], cpu: [] };
      e.mem.push(p.ws / MB);
      e.priv.push(p.pb / MB);
      if (pr && p.ts > pr.ts) e.cpu.push(((p.cpu - pr.cpu) / (p.ts - pr.ts) / cores) * 100);
      per.set(p.pid, e);
    }
  }
  prev = new Map(s.p.map(p => [p.pid, p]));
}
const med = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
let tw = 0,
  tp = 0,
  tc = 0;
const rows = [...per.entries()]
  .map(([pid, e]) => {
    const cmd = cmds.get(pid) || '';
    const type =
      pid === app.pid
        ? 'main-process'
        : ((cmd.match(/--type=([\w-]+)/) || [])[1] || '?') +
          ((cmd.match(/--utility-sub-type=([\w.]+)/) || [])[1]
            ? ':' + cmd.match(/--utility-sub-type=([\w.]+)/)[1]
            : '');
    const r = { type, ws: med(e.mem), priv: med(e.priv), cpu: avg(e.cpu) };
    tw += r.ws;
    tp += r.priv;
    tc += r.cpu;
    return r;
  })
  .sort((a, b) => b.ws - a.ws);
console.log(
  `minimal Electron ${argv.includes('--hidden') ? '(1 visible + 1 hidden window)' : '(1 window)'}${argv.includes('--content') ? ' with full-window content' : ''}${argv.includes('--pulse') ? ' + REC pulse animation' : ''}: total ${tw.toFixed(0)} MB WS / ${tp.toFixed(0)} MB private, CPU ${tc.toFixed(2)}%`,
);
for (const r of rows)
  console.log(
    `  ${r.ws.toFixed(1).padStart(6)} MB WS ${r.priv.toFixed(1).padStart(6)} MB priv ${r.cpu.toFixed(2).padStart(5)}%  ${r.type}`,
  );
