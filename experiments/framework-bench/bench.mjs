#!/usr/bin/env node
/**
 * Framework micro-benchmark runner (docs/rework/chapter2).
 *   node bench.mjs --fw vanilla,svelte --runs 3 [--settle 10] [--sample 20] [--label x] [--smoke]
 * For each framework: editor (idle, busy), settings (static), rename (static).
 * Measures the page's renderer process (WS/private/CPU), GPU process, whole tree, cold open ms,
 * and bundle sizes (raw + gzip) from dist/<fw>.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const smoke = argv.includes('--smoke');
const fws = opt('fw', 'vanilla').split(',');
const runs = Number(opt('runs', smoke ? 1 : 3));
const settleSec = Number(opt('settle', smoke ? 2 : 10));
const sampleSec = Number(opt('sample', smoke ? 3 : 20));
const label = opt('label', 'run');
const CASES = (opt('cases', '') || 'editor:idle,editor:busy,settings:static,rename:static')
  .split(',')
  .map(c => c.split(':'));
const exe = path.join(repo, 'node_modules/electron/dist/electron.exe');
const sampler = path.join(repo, 'scripts/bench/sampler.ps1');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MB = 1048576;
const cores = os.cpus().length;

function bundleSizes(fw) {
  const dir = path.join(here, 'dist', fw, 'assets');
  if (!fs.existsSync(dir)) return null;
  let js = 0, jsGz = 0, css = 0, cssGz = 0;
  for (const f of fs.readdirSync(dir)) {
    const buf = fs.readFileSync(path.join(dir, f));
    const gz = zlib.gzipSync(buf).length;
    if (f.endsWith('.js')) { js += buf.length; jsGz += gz; }
    if (f.endsWith('.css')) { css += buf.length; cssGz += gz; }
  }
  return { jsKB: +(js / 1024).toFixed(1), jsGzKB: +(jsGz / 1024).toFixed(1), cssKB: +(css / 1024).toFixed(1), cssGzKB: +(cssGz / 1024).toFixed(1) };
}

async function runOnce(fw, page, scenario) {
  const samples = [];
  const cmds = new Map();
  const sp = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', sampler, '-Names', 'electron'], { stdio: ['ignore', 'pipe', 'ignore'] });
  readline.createInterface({ input: sp.stdout }).on('line', l => {
    try {
      const s = JSON.parse(l);
      const p = s.p == null ? [] : Array.isArray(s.p) ? s.p : [s.p];
      (s.cmd == null ? [] : Array.isArray(s.cmd) ? s.cmd : [s.cmd]).forEach(c => cmds.set(c.pid, c.cmd));
      samples.push({ t: s.t, p });
    } catch (e) {}
  });
  await sleep(1500); // sampler warm-up
  const app = spawn(exe, [path.join(here, 'electron', 'main.cjs'), '--fw', fw, '--page', page], {
    env: { ...process.env, BENCH_SCENARIO: scenario, BENCH_ON_TOP: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = null;
  let stderr = '';
  app.stderr.on('data', d => (stderr += d));
  readline.createInterface({ input: app.stdout }).on('line', l => {
    try {
      const j = JSON.parse(l);
      if (j.event === 'ready') ready = j;
    } catch (e) {}
  });
  const end = Date.now() + 30000;
  while (!ready && Date.now() < end) await sleep(100);
  if (!ready) {
    try { execFileSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' }); } catch (e) {}
    sp.kill();
    return { fw, page, scenario, error: 'no ready event', stderr: stderr.slice(-500) };
  }
  await sleep(settleSec * 1000);
  const t0 = Date.now();
  await sleep(sampleSec * 1000);
  const t1 = Date.now();
  try { execFileSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' }); } catch (e) {}
  sp.kill();

  // tree membership from the launched pid
  const tree = new Set([app.pid]);
  for (const s of samples) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of s.p) if (!tree.has(p.pid) && tree.has(p.ppid)) { tree.add(p.pid); grew = true; }
    }
  }
  const gpuPid = [...tree].find(pid => /--type=gpu-process/.test(cmds.get(pid) || ''));
  const per = new Map();
  let prev = new Map();
  for (const s of samples) {
    for (const p of s.p) {
      if (!tree.has(p.pid)) continue;
      const pr = prev.get(p.pid);
      if (s.t >= t0 && s.t <= t1) {
        const e = per.get(p.pid) || { ws: [], pb: [], cpu: [] };
        e.ws.push(p.ws / MB);
        e.pb.push(p.pb / MB);
        if (pr && p.ts > pr.ts) e.cpu.push(((p.cpu - pr.cpu) / (p.ts - pr.ts) / cores) * 100);
        per.set(p.pid, e);
      }
    }
    prev = new Map(s.p.map(p => [p.pid, p]));
  }
  const med = a => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.floor(x.length / 2)] : 0; };
  const avg = a => (a.length ? a.reduce((m, n) => m + n, 0) / a.length : 0);
  const pick = pid => { const e = per.get(pid); return e ? { ws: +med(e.ws).toFixed(1), priv: +med(e.pb).toFixed(1), cpu: +avg(e.cpu).toFixed(3) } : null; };
  let totalWs = 0, totalCpu = 0;
  for (const [, e] of per) { totalWs += med(e.ws); totalCpu += avg(e.cpu); }
  return {
    fw, page, scenario,
    coldOpenMs: ready.coldOpenMs,
    renderer: pick(ready.rendererPid),
    gpu: pick(gpuPid),
    total: { ws: +totalWs.toFixed(1), cpu: +totalCpu.toFixed(3) },
  };
}

const results = [];
for (const fw of fws) {
  if (!fs.existsSync(path.join(here, 'dist', fw))) { console.log(`skip ${fw}: no dist/${fw}`); continue; }
  for (const [page, scenario] of CASES) {
    for (let n = 0; n < runs; n++) {
      const r = await runOnce(fw, page, scenario);
      results.push(r);
      console.log(r.error ? `${fw} ${page}/${scenario} #${n + 1}: ERROR ${r.error} ${r.stderr || ''}` :
        `${fw.padEnd(10)} ${`${page}/${scenario}`.padEnd(16)} #${n + 1}: open ${String(r.coldOpenMs).padStart(4)} ms | renderer ${r.renderer?.ws} MB ws / ${r.renderer?.priv} priv, ${r.renderer?.cpu}% | gpu ${r.gpu?.ws} MB, ${r.gpu?.cpu}% | total ${r.total.ws} MB, ${r.total.cpu}%`);
      await sleep(1500);
    }
  }
}

// aggregate: median across runs
const med = a => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.floor(x.length / 2)] : null; };
const summary = [];
for (const fw of fws) {
  for (const [page, scenario] of CASES) {
    const rs = results.filter(r => r.fw === fw && r.page === page && r.scenario === scenario && !r.error);
    if (!rs.length) continue;
    summary.push({
      fw, case: `${page}/${scenario}`,
      coldOpenMs: med(rs.map(r => r.coldOpenMs)),
      rendererWs: med(rs.map(r => r.renderer?.ws)),
      rendererPriv: med(rs.map(r => r.renderer?.priv)),
      rendererCpu: med(rs.map(r => r.renderer?.cpu)),
      gpuCpu: med(rs.map(r => r.gpu?.cpu)),
      totalWs: med(rs.map(r => r.total.ws)),
      totalCpu: med(rs.map(r => r.total.cpu)),
    });
  }
}
const sizes = Object.fromEntries(fws.map(fw => [fw, bundleSizes(fw)]));
console.log('\n=== median of runs ===');
console.table(summary);
console.log('bundle sizes (all 3 pages, KB):');
console.table(sizes);
if (!smoke) {
  fs.mkdirSync(path.join(here, 'results'), { recursive: true });
  const file = path.join(here, 'results', `${new Date().toISOString().slice(0, 10)}-${label}.json`);
  fs.writeFileSync(file, JSON.stringify({ machine: { cpu: os.cpus()[0].model, cores }, runs, settleSec, sampleSec, results, summary, sizes }, null, 1));
  console.log('written', path.relative(here, file));
}
