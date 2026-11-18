#!/usr/bin/env node
/**
 * What wakes the app up at idle? (hypothesis H16)
 *
 *   node scripts/bench/trace-idle.mjs [--fixture .bench/fixtures/typical] [--settle 60] [--sec 20] [--scenarios S2,S0]
 *   node scripts/bench/trace-idle.mjs --analyze .bench/runs/trace_idle   (re-analyze existing output)
 *
 * Per scenario: Electron contentTracing of all processes + JS CPU profiles of main/worker +
 * IPC message counts. Prints a summary and writes summary.txt next to the raw files.
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const runDir = path.resolve(repo, opt('analyze', path.join('.bench', 'runs', 'trace_idle')));
const outDir = path.join(runDir, 'out');

async function record() {
  const fixture = path.resolve(repo, opt('fixture', '.bench/fixtures/typical'));
  const settle = Number(opt('settle', 60));
  const sec = Number(opt('sec', 20));
  const scenarios = opt('scenarios', 'S2,S0').split(',');
  fs.rmSync(runDir, { recursive: true, force: true });
  const appData = path.join(runDir, 'appdata');
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(fixture, appData, { recursive: true });
  const app = spawn(path.join(repo, 'node_modules/electron/dist/electron.exe'), [repo, '--skip-update', '--local-bundles'], {
    cwd: repo,
    env: { ...process.env, NODE_ENV: 'production', SLOBS_CACHE_DIR: appData, SLOBS_BENCH_OUT: outDir, SLOBS_BENCH_SCENARIO: scenarios[0] },
    stdio: ['ignore', fs.openSync(path.join(runDir, 'stdout.log'), 'w'), fs.openSync(path.join(runDir, 'stderr.log'), 'w')],
  });
  let exited = false;
  app.on('exit', () => (exited = true));
  const events = () => {
    try {
      return fs.readFileSync(path.join(outDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    } catch (e) {
      return [];
    }
  };
  const control = c => fs.writeFileSync(path.join(outDir, 'control'), c);
  const wait = async (pred, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const all = events();
      const err = all.find(e => e.event === 'trace-error' || e.event === 'scenario-error');
      if (err) throw new Error(err.message);
      const hit = all.filter(pred);
      if (hit.length) return hit[hit.length - 1];
      if (exited) throw new Error('app exited');
      await sleep(250);
    }
    throw new Error(`timeout: ${what}`);
  };
  const traces = [];
  try {
    await wait(e => e.event === 'main-window-shown', 240_000, 'main window');
    for (let i = 0; i < scenarios.length; i++) {
      const sc = scenarios[i];
      const since = Date.now();
      if (i > 0) control(`scenario ${sc}`);
      await wait(e => e.event === 'scenario-applied' && e.scenario === sc && e.t >= since - (i ? 0 : 1e9), 60_000, sc);
      const s = i === 0 ? settle : 15;
      log(`${sc}: settling ${s}s`);
      await sleep(s * 1000);
      log(`${sc}: tracing ${sec}s`);
      const t = Date.now();
      control(`trace ${sec} main,worker`);
      const done = await wait(e => e.event === 'trace-done' && e.t >= t, (sec + 60) * 1000, 'trace');
      traces.push({ scenario: sc, ...done });
    }
  } catch (e) {
    log(`ERROR ${e.message}`);
  }
  fs.writeFileSync(path.join(runDir, 'traces.json'), JSON.stringify(traces, null, 1));
  control('quit');
  const end = Date.now() + 40_000;
  while (!exited && Date.now() < end) await sleep(250);
  if (!exited) {
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' });
    } catch (e) {}
  }
}

// ---------------- analysis ----------------
// Source-map resolution of bundle positions (renderer.js / vendors~renderer.js)
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const consumers = {};
function consumerFor(url) {
  const m = (url || '').match(/(vendors~renderer|renderer)\.js/);
  if (!m) return null;
  const key = m[1];
  if (consumers[key] !== undefined) return consumers[key];
  try {
    const { SourceMapConsumer } = require_('source-map');
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'bundles', 'manifest.json'), 'utf8'));
    const map = JSON.parse(fs.readFileSync(path.join(repo, 'bundles', manifest[`${key}.js.map`]), 'utf8'));
    consumers[key] = new SourceMapConsumer(map);
  } catch (e) {
    consumers[key] = null;
  }
  return consumers[key];
}
// line/col 1-based
function resolve(url, line, col, fn) {
  const c = consumerFor(url);
  if (!c || !line) return `${fn || '(anonymous)'} ${url ? path.basename(url.split('?')[0]) : ''}`.trim();
  const o = c.originalPositionFor({ line, column: Math.max(0, (col || 1) - 1) });
  if (!o.source) return `${fn || '(anonymous)'} ${path.basename(url)}:${line}:${col}`;
  const src = o.source.replace(/^webpack:\/\/[^/]*\//, '').replace(/^\.\//, '').replace(/^.*node_modules\//, 'npm:');
  return `${o.name || fn || '(anonymous)'} ${src}:${o.line}`;
}
function pidRoles() {
  const lines = fs.readFileSync(path.join(outDir, 'app-metrics.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const roles = new Map();
  for (const m of lines) {
    for (const a of m.appMetrics || []) roles.set(a.pid, a.type === 'Utility' ? `utility:${a.serviceName || a.name}` : a.type.toLowerCase());
    for (const w of m.webContents || []) if (w.pid) roles.set(w.pid, w.role);
    if (m.browserPid) roles.set(m.browserPid, 'main-process');
  }
  return roles;
}

const INTERESTING = new Set([
  'Paint', 'PaintImage', 'Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'UpdateLayerTree', 'Layerize',
  'TimerFire', 'FireAnimationFrame', 'FunctionCall', 'EventDispatch', 'v8.callFunction', 'v8.run',
  'HitTest', 'ScheduleStyleRecalculation', 'InvalidateLayout', 'CompositeLayers', 'MajorGC', 'MinorGC',
  'V8.GCScavenger', 'V8.GCFinalizeMC', 'ProxyMain::BeginMainFrame', 'Scheduler::BeginFrame', 'BeginFrame',
  'DrawFrame', 'Graphics.Pipeline', 'Display::DrawAndSwap', 'Animation', 'XHRReadyStateChange', 'ResourceSendRequest',
]);

function analyzeTrace(file, roles, sec) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const evs = Array.isArray(raw) ? raw : raw.traceEvents;
  const per = new Map(); // role -> {names: Map(name -> {n, dur}), timers: Map, funcs: Map}
  const get = pid => {
    const role = roles.get(pid) || `pid ${pid}`;
    if (!per.has(role)) per.set(role, { names: new Map(), funcs: new Map(), timers: new Map() });
    return per.get(role);
  };
  const installs = new Map(); // pid:timerId -> { site, timeout }
  const fires = new Map(); // role -> Map(site -> {n, dur, timeout})
  for (const e of evs) {
    if (e.name === 'TimerInstall' && e.args && e.args.data) {
      const d = e.args.data;
      const st = d.stackTrace || (e.args.beginData && e.args.beginData.stackTrace) || [];
      // first frame that resolves into app/ code, else the top frame
      let site = null;
      for (const f of st) {
        const r = resolve(f.url, f.lineNumber, f.columnNumber, f.functionName);
        if (!site) site = r;
        if (/ app\//.test(r)) {
          site = r;
          break;
        }
      }
      installs.set(`${e.pid}:${d.timerId}`, { site: site || '(no stack)', timeout: d.timeout, single: d.singleShot });
    }
  }
  for (const e of evs) {
    if (e.name === 'TimerFire' && e.ph === 'X' && e.args && e.args.data) {
      const role = roles.get(e.pid) || `pid ${e.pid}`;
      const inst = installs.get(`${e.pid}:${e.args.data.timerId}`) || { site: '(installed before trace)', timeout: '?' };
      const key = `${inst.site} [${inst.single ? 'setTimeout' : 'setInterval'} ${inst.timeout}ms]`;
      if (!fires.has(role)) fires.set(role, new Map());
      const m = fires.get(role);
      const f = m.get(key) || { n: 0, dur: 0 };
      f.n++;
      f.dur += e.dur || 0;
      m.set(key, f);
    }
  }
  for (const e of evs) {
    if (!e.name || e.pid == null) continue;
    if (!(e.ph === 'X' || e.ph === 'I' || e.ph === 'i' || e.ph === 'B' || e.ph === 'n')) continue;
    if (!INTERESTING.has(e.name)) continue;
    const r = get(e.pid);
    const s = r.names.get(e.name) || { n: 0, dur: 0 };
    s.n++;
    s.dur += e.dur || 0;
    r.names.set(e.name, s);
    const d = (e.args && e.args.data) || {};
    if (e.name === 'FunctionCall' || e.name === 'TimerFire' || e.name === 'FireAnimationFrame' || e.name === 'EventDispatch') {
      const key = `${e.name}: ${d.type || ''}${d.functionName || ''} ${d.url ? path.basename(d.url.split('?')[0]) + ':' + d.lineNumber : ''}`.trim();
      const f = r.funcs.get(key) || { n: 0, dur: 0 };
      f.n++;
      f.dur += e.dur || 0;
      r.funcs.set(key, f);
    }
  }
  const out = [];
  for (const [role, r] of [...per.entries()].sort()) {
    const names = [...r.names.entries()].sort((a, b) => b[1].dur - a[1].dur || b[1].n - a[1].n);
    if (!names.length) continue;
    out.push(`  [${role}]`);
    for (const [n, s] of names.slice(0, 14))
      out.push(`    ${(s.n / sec).toFixed(1).padStart(7)}/s  ${(s.dur / 1000 / sec).toFixed(2).padStart(7)} ms/s  ${n}`);
    const tf = fires.get(role);
    if (tf && tf.size) {
      out.push('    timers firing (by install site):');
      for (const [k, f] of [...tf.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12))
        out.push(`      ${(f.n / sec).toFixed(2).padStart(6)}/s ${(f.dur / 1000 / sec).toFixed(2).padStart(6)} ms/s  ${k}`);
    }
    const funcs = [...r.funcs.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10);
    if (funcs.length) {
      out.push('    top JS entry points (by count):');
      for (const [k, f] of funcs) out.push(`      ${(f.n / sec).toFixed(1).padStart(6)}/s ${(f.dur / 1000 / sec).toFixed(2).padStart(6)} ms/s  ${k}`);
    }
  }
  return out;
}

function analyzeProfile(file) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(p.nodes.map(n => [n.id, n]));
  const counts = new Map();
  for (const id of p.samples) counts.set(id, (counts.get(id) || 0) + 1);
  const dt = (p.endTime - p.startTime) / p.samples.length / 1000; // ms per sample
  const self = new Map();
  let total = 0;
  for (const [id, c] of counts) {
    const n = byId.get(id);
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anonymous)'} ${cf.url ? path.basename(cf.url.split('?')[0]) + ':' + (cf.lineNumber + 1) + ':' + (cf.columnNumber + 1) : ''}`.trim();
    self.set(key, (self.get(key) || 0) + c * dt);
    if (!['(idle)', '(program)'].includes(cf.functionName)) total += c * dt;
  }
  const sec = (p.endTime - p.startTime) / 1e6;
  const out = [`    busy (excl. idle/program): ${(total / sec).toFixed(1)} ms/s`];
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) out.push(`      ${(v / sec).toFixed(2).padStart(6)} ms/s  ${k}`);
  // inclusive time attributed to the nearest app/ frame on the stack (resolved via source maps)
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const resolved = new Map();
  const res = n => {
    if (!resolved.has(n.id)) {
      const cf = n.callFrame;
      resolved.set(n.id, cf.url ? resolve(cf.url, cf.lineNumber + 1, cf.columnNumber + 1, cf.functionName) : cf.functionName);
    }
    return resolved.get(n.id);
  };
  const byApp = new Map();
  for (const [id, c] of counts) {
    const leaf = byId.get(id);
    if (['(idle)', '(program)', '(garbage collector)'].includes(leaf.callFrame.functionName)) continue;
    let cur = id;
    let hit = null;
    while (cur != null) {
      const r = res(byId.get(cur));
      if (r && / app\//.test(r)) {
        hit = r;
        break;
      }
      cur = parent.get(cur);
    }
    const key = hit || `(no app frame) ${res(leaf)}`;
    byApp.set(key, (byApp.get(key) || 0) + c * dt);
  }
  out.push('    inclusive by nearest app/ frame:');
  for (const [k, v] of [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) out.push(`      ${(v / sec).toFixed(2).padStart(6)} ms/s  ${k}`);
  return out;
}

function analyzeIpc(file) {
  const { seconds, stats } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Object.entries(stats).sort((a, b) => b[1].count - a[1].count);
  const total = rows.reduce((s, [, v]) => s + v.count, 0);
  const out = [`    total ${(total / seconds).toFixed(1)} msg/s`];
  for (const [k, v] of rows.slice(0, 15)) out.push(`      ${(v.count / seconds).toFixed(2).padStart(6)}/s ${Math.round(v.bytes / seconds).toString().padStart(7)} B/s  ${k}`);
  return out;
}

function analyze() {
  const traces = JSON.parse(fs.readFileSync(path.join(runDir, 'traces.json'), 'utf8'));
  const roles = pidRoles();
  const lines = [];
  for (const t of traces) {
    lines.push(`\n===== ${t.scenario} (${t.sec}s) =====`);
    lines.push('-- timeline events per process --');
    lines.push(...analyzeTrace(t.tracePath, roles, t.sec));
    for (const r of t.roles) {
      const f = path.join(outDir, `profile-${r.role}-${t.stamp}.cpuprofile`);
      if (fs.existsSync(f)) {
        lines.push(`-- JS CPU profile: ${r.role} (self time) --`);
        lines.push(...analyzeProfile(f));
      }
    }
    const ipc = path.join(outDir, `ipc-${t.stamp}.json`);
    if (fs.existsSync(ipc)) {
      lines.push('-- IPC through the main process (channel | sender | key) --');
      lines.push(...analyzeIpc(ipc));
    }
  }
  const text = lines.join('\n');
  fs.writeFileSync(path.join(runDir, 'summary.txt'), text);
  console.log(text);
}

if (!argv.includes('--analyze')) await record();
analyze();
