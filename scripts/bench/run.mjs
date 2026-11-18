#!/usr/bin/env node
/**
 * Benchmark runner — docs/rework/benchmarking.md
 *
 * Two modes:
 *   sequence (default, ~7 min): ONE launch, settle once, then walk through the
 *     scenarios S2 → S1u → S0 → S1 in the same session, each with a short
 *     transition settle and a sample segment.
 *       node scripts/bench/run.mjs --label baseline-e43-webpack
 *   single: one launch per scenario, long settle + sample (milestone baselines).
 *       node scripts/bench/run.mjs --mode single --scenario all --label baseline-e43-webpack
 *
 * Options:
 *   --mode        sequence|single                 (default sequence)
 *   --label       free text, used in file names    (required)
 *   --scenario    single mode: S0|S1|S1u|S2|all    (default all)
 *   --scenarios   sequence mode: comma list        (default S2,S1u,S0,S1)
 *   --runs        launches                         (default 1 sequence / 3 single)
 *   --fixture     user-data fixture dir            (default .bench/fixtures/default)
 *   --settle      s after the first scenario is applied   (default 90 sequence / 120 single)
 *   --transition  s after switching scenario (sequence)   (default 15)
 *   --sample      s of sampling per scenario       (default 60 sequence / 300 single)
 *   --exe         app executable                   (default node_modules/electron/dist/electron.exe)
 *   --no-record   don't write into docs/rework/benchmarks (smoke tests)
 *   --notes       free text stored in the result
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = name => argv.includes(`--${name}`);

const SCENARIOS = ['S0', 'S1', 'S1u', 'S2', 'S3', 'S5'];
const mode = opt('mode', 'sequence');
const seq = mode === 'sequence';
const label = opt('label');
const runs = Number(opt('runs', seq ? 1 : 3));
const fixture = path.resolve(repo, opt('fixture', '.bench/fixtures/default'));
const settleSec = Number(opt('settle', seq ? 90 : 120));
const transitionSec = seq ? Number(opt('transition', 15)) : 0;
const sampleSec = Number(opt('sample', seq ? 60 : 300));
const exe = path.resolve(repo, opt('exe', 'node_modules/electron/dist/electron.exe'));
const record = !flag('no-record');
const notes = opt('notes', '');
// --env KEY=VALUE (repeatable): extra environment for the app (experiment switches)
const extraEnv = {};
argv.forEach((a, i) => {
  if (a === '--env' && argv[i + 1]) {
    const [k, ...v] = argv[i + 1].split('=');
    extraEnv[k] = v.join('=');
  }
});
// --pre "<hook command>": sent once the main window is shown (e.g. "perfmode on")
const preCommand = opt('pre', '');
// --memtrace: memory-infra trace at the end → GPU process allocator breakdown + loaded DLLs
const memtrace = flag('memtrace');

let plans; // each plan = list of scenarios walked through in one launch
if (seq) {
  plans = [opt('scenarios', 'S2,S1u,S0,S1').split(',').map(s => s.trim())];
} else {
  const s = opt('scenario', 'all');
  plans = (s === 'all' ? SCENARIOS : [s]).map(x => [x]);
}

if (!['sequence', 'single'].includes(mode)) die(`unknown mode ${mode}`);
if (!label) die('--label is required');
if (!plans.flat().every(s => SCENARIOS.includes(s))) die('unknown scenario');
if (!fs.existsSync(path.join(fixture, 'slobs-client')))
  die(`fixture not found: ${fixture}\\slobs-client — create one with scripts/bench/make-fixture.mjs`);
if (!fs.existsSync(path.join(repo, 'bundles', 'manifest.json'))) die('no build in bundles/ — run yarn compile:production');

function die(msg) {
  console.error(`bench: ${msg}`);
  process.exit(1);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// ---------- environment info ----------
function ps(cmd) {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}
function machineInfo() {
  const gpu = ps('(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join "; "');
  const display = ps(
    '(Get-CimInstance Win32_VideoController | Where-Object CurrentHorizontalResolution | ForEach-Object { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)@$($_.CurrentRefreshRate)" }) -join "; "',
  );
  const ac = ps('(Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1).PowerOnline');
  const plan = ps('powercfg /getactivescheme');
  const build = ps('(Get-CimInstance Win32_OperatingSystem).BuildNumber');
  return {
    cpu: os.cpus()[0].model.trim(),
    logicalCores: os.cpus().length,
    ramGb: Math.round(os.totalmem() / 2 ** 30),
    gpu,
    display,
    os: `Windows ${os.release()} build ${build}`,
    onAcPower: ac === '' ? null : ac === 'True',
    powerPlan: plan.replace(/^.*\((.*)\)\s*$/, '$1'),
  };
}
function appInfo() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  let electron = '';
  try {
    electron = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules/electron/package.json'), 'utf8')).version;
  } catch (e) {}
  return { version: pkg.version, electron };
}
function gitInfo() {
  const g = args => {
    try {
      return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    } catch (e) {
      return '';
    }
  };
  return { commit: g(['rev-parse', 'HEAD']), dirty: g(['status', '--porcelain']).length > 0 };
}

// ---------- one launch ----------
async function runOnce(plan, n, machine) {
  const date = new Date().toISOString().slice(0, 10);
  const name = `${date}_${seq ? 'SEQ' : plan[0]}_${label}_${n}`;
  const runDir = path.join(repo, '.bench', 'runs', name);
  fs.rmSync(runDir, { recursive: true, force: true });
  const appData = path.join(runDir, 'appdata');
  const outDir = path.join(runDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  log(`${name}: copying fixture`);
  fs.cpSync(fixture, appData, { recursive: true });
  // Recordings (S3) go into the run folder, never the user's Videos folder.
  const ini = path.join(appData, 'slobs-client', 'basic.ini');
  if (fs.existsSync(ini)) {
    const recDir = path.join(runDir, 'recordings');
    fs.mkdirSync(recDir, { recursive: true });
    const esc = recDir.replace(/\\/g, '\\\\'); // ini files use doubled backslashes
    fs.writeFileSync(
      ini,
      fs.readFileSync(ini, 'utf8').replace(/^(FilePath|RecFilePath|FFFilePath)=[^\r\n]*/gm, (m, k) => `${k}=${esc}`),
    );
  }

  // sampler first, so startup is captured too
  const samples = [];
  const cmdlines = new Map();
  const sampler = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'sampler.ps1')],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  sampler.stderr.on('data', d => process.stderr.write(`[sampler] ${d}`));
  readline.createInterface({ input: sampler.stdout }).on('line', line => {
    try {
      const s = JSON.parse(line);
      const p = s.p == null ? [] : Array.isArray(s.p) ? s.p : [s.p];
      const c = s.cmd == null ? [] : Array.isArray(s.cmd) ? s.cmd : [s.cmd];
      c.forEach(x => cmdlines.set(x.pid, x.cmd));
      samples.push({ t: s.t, fg: s.fg, p });
    } catch (e) {}
  });

  const t0 = Date.now();
  const app = spawn(exe, [repo, '--skip-update', '--local-bundles'], {
    cwd: repo,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SLOBS_CACHE_DIR: appData,
      SLOBS_BENCH_OUT: outDir,
      SLOBS_BENCH_SCENARIO: plan[0],
      ...extraEnv,
    },
    stdio: ['ignore', fs.openSync(path.join(runDir, 'stdout.log'), 'w'), fs.openSync(path.join(runDir, 'stderr.log'), 'w')],
  });
  const rootPid = app.pid;
  let exited = false;
  let exitAt = null;
  app.on('exit', () => {
    exited = true;
    exitAt = Date.now();
  });
  app.on('error', e => {
    exited = true;
    exitAt = Date.now();
    log(`failed to launch app: ${e.message}`);
  });

  const control = cmd => fs.writeFileSync(path.join(outDir, 'control'), cmd);
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
  const waitEvent = async (match, timeoutMs, desc) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const all = events();
      const e = all.find(match);
      if (e) return e;
      if (exited) throw new Error(`app exited while waiting for ${desc}`);
      const err = all.find(x => x.event === 'scenario-error');
      if (err) throw new Error(`scenario error: ${err.message}`);
      await sleep(500);
    }
    throw new Error(`timeout waiting for ${desc}`);
  };

  const phases = { launch: t0 };
  const segments = [];
  let error = null;
  try {
    const shown = await waitEvent(e => e.event === 'main-window-shown', 240_000, 'main window');
    phases.mainWindowShown = shown.t;
    if (preCommand) {
      await sleep(2000);
      control(preCommand);
    }
    log(`${name}: main window shown after ${((shown.t - t0) / 1000).toFixed(1)}s`);

    for (let i = 0; i < plan.length; i++) {
      const sc = plan[i];
      const since = Date.now();
      if (i > 0) control(`scenario ${sc}`);
      const applied = await waitEvent(
        e => e.event === 'scenario-applied' && e.scenario === sc && (i === 0 || e.t >= since),
        60_000,
        `scenario ${sc}`,
      );
      const wait = i === 0 ? settleSec : transitionSec;
      log(`${name}: ${sc} applied, settling ${wait}s`);
      await sleep(wait * 1000);
      const sampleStart = Date.now();
      log(`${name}: ${sc} sampling ${sampleSec}s`);
      await sleep(sampleSec * 1000);
      segments.push({ scenario: sc, applied: applied.t, sampleStart, sampleEnd: Date.now() });
    }
  } catch (e) {
    error = String(e.message || e);
    log(`${name}: ERROR ${error}`);
  }
  // DLLs loaded in the GPU process (graphics drivers can be large) — while it is still alive
  let gpuModules = null;
  if (memtrace) {
    const gpuPid = (() => {
      const lines = (() => {
        try {
          return fs.readFileSync(path.join(outDir, 'app-metrics.jsonl'), 'utf8').trim().split('\n');
        } catch (e) {
          return [];
        }
      })();
      const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
      const g = last && (last.appMetrics || []).find(a => a.type === 'GPU');
      return g ? g.pid : null;
    })();
    if (gpuPid) {
      const out = ps(
        `(Get-Process -Id ${gpuPid}).Modules | Sort-Object ModuleMemorySize -Descending | Select-Object -First 20 | ForEach-Object { "$($_.ModuleName)=$([math]::Round($_.ModuleMemorySize/1MB,1))" }`,
      );
      gpuModules = out.split(/\s+/).filter(Boolean).map(x => {
        const [n, mb] = x.split('=');
        return { module: n, imageMB: Number(mb) };
      });
    }
  }

  let memory = null;
  if (memtrace && !error) {
    try {
      const t = Date.now();
      control('trace 12 main mem');
      const done = await waitEvent(e => e.event === 'trace-done' && e.t >= t, 90_000, 'memtrace');
      memory = { tracePath: done.tracePath };
    } catch (e) {
      log(`${name}: memtrace failed: ${e.message}`);
    }
  }
  const gpuInfoEvent = events().find(e => e.event === 'gpu-info');

  // clean shutdown
  const quitAt = Date.now();
  control('quit');
  const quitDeadline = Date.now() + 40_000;
  while (!exited && Date.now() < quitDeadline) await sleep(250);
  const cleanExit = exited;
  await sleep(3000); // let children finish
  sampler.kill();

  // tree membership and leftovers
  const tree = treeMembers(samples, rootPid);
  const leftovers = alivePids([...tree.keys()]);
  if (!cleanExit || leftovers.length) {
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(rootPid)], { stdio: 'ignore' });
    } catch (e) {}
    leftovers.forEach(pid => {
      try {
        execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      } catch (e) {}
    });
  }

  const quitEvent = events().find(x => x.event === 'app-quit');
  const shutdown = {
    // clean = the process exited on its own within 40 s
    clean: cleanExit,
    durationMs: cleanExit ? exitAt - quitAt : null,
    // Electron 'quit' event reached (logical shutdown done); if clean=false the process hung after it
    quitEventMs: quitEvent ? quitEvent.t - quitAt : null,
    leftoverProcesses: leftovers.map(pid => tree.get(pid)?.name || String(pid)),
  };

  const result = buildResult({ name, machine, samples, cmdlines, tree, rootPid, outDir, phases, segments, shutdown, error });
  result.env = extraEnv;
  result.preCommand = preCommand;
  result.gpuInfo = gpuInfoEvent || null;
  if (memory) result.memoryBreakdown = analyzeMemoryTrace(memory.tracePath, result.processes);
  if (gpuModules) result.gpuModules = gpuModules;
  return result;
}

function treeMembers(samples, rootPid) {
  // sticky membership: once a pid is a descendant of root, it stays a member
  const members = new Map();
  members.set(rootPid, { name: 'electron' });
  for (const s of samples) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of s.p) {
        if (!members.has(p.pid) && members.has(p.ppid)) {
          members.set(p.pid, { name: p.name });
          grew = true;
        }
      }
    }
    for (const p of s.p) if (members.has(p.pid)) members.get(p.pid).name = p.name;
  }
  return members;
}

function alivePids(pids) {
  if (!pids.length) return [];
  const out = ps(`Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }`);
  return out.split(/\s+/).filter(Boolean).map(Number);
}

// ---------- labelling ----------
function loadAppMetrics(outDir) {
  try {
    return fs
      .readFileSync(path.join(outDir, 'app-metrics.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
  } catch (e) {
    return [];
  }
}

// Native OBS side (obs64 + its helpers, e.g. CEF obs-browser-page for browser sources/widgets).
// Reported separately from the Electron target.
const isNativeName = name => name.startsWith('obs64') || name.startsWith('obs-') || name.startsWith('win-streamlabs');

function cmdSummary(cmd) {
  // exe name + flag names (+ value of --type / --utility-sub-type), no paths, tokens or URLs
  if (!cmd) return '';
  const exe = (cmd.match(/^"?([^"]+?\.exe)/i) || [])[1] || '';
  const flags = [...cmd.matchAll(/--([\w-]+)(?:=("[^"]*"|\S*))?/g)].map(m =>
    ['type', 'utility-sub-type'].includes(m[1]) ? `--${m[1]}=${m[2]}` : `--${m[1]}`,
  );
  return [path.basename(exe), ...[...new Set(flags)].slice(0, 12)].join(' ');
}

function labelFor(pid, name, rootPid, metrics, cmdlines) {
  if (isNativeName(name)) {
    const type = (cmdlines.get(pid) || '').match(/--type=([\w-]+)/);
    return type ? `${name}:${type[1]}` : name;
  }
  if (pid === rootPid) return 'electron:main-process';
  // latest snapshot that mentions the pid wins
  for (let i = metrics.length - 1; i >= 0; i--) {
    const m = metrics[i];
    const wcs = (m.webContents || []).filter(w => w.pid === pid);
    if (wcs.length) {
      const roles = [...new Set(wcs.map(w => w.role))].sort();
      return `renderer:${roles.join('+')}`;
    }
    const am = (m.appMetrics || []).find(a => a.pid === pid);
    if (am) {
      if (am.type === 'Utility') return `utility:${am.serviceName || am.name || 'unknown'}`;
      return am.type.toLowerCase();
    }
  }
  const cmd = cmdlines.get(pid) || '';
  const type = cmd.match(/--type=([\w-]+)/);
  if (type) {
    const sub = cmd.match(/--utility-sub-type=([\w.-]+)/);
    return sub ? `utility:${sub[1]}` : type[1];
  }
  return name;
}

// ---------- stats ----------
const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
const MB = 1024 * 1024;

function buildResult({ name, machine, samples, cmdlines, tree, rootPid, outDir, phases, segments, shutdown, error }) {
  const cores = os.cpus().length;
  // names of outside processes that held the foreground (explains failed focus checks)
  const otherFg = [...new Set(samples.map(s => s.fg).filter(pid => pid && !tree.has(pid)))];
  const fgNames = new Map();
  if (otherFg.length) {
    ps(`Get-Process -Id ${otherFg.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)=$($_.ProcessName)" }`)
      .split(/\s+/)
      .filter(Boolean)
      .forEach(x => {
        const [pid, n] = x.split('=');
        fgNames.set(Number(pid), n);
      });
  }
  const metrics = loadAppMetrics(outDir);
  const labels = new Map();
  for (const [pid, info] of tree) labels.set(pid, labelFor(pid, info.name, rootPid, metrics, cmdlines));
  const counts = {};
  for (const l of labels.values()) counts[l] = (counts[l] || 0) + 1;
  for (const [pid, l] of labels) if (counts[l] > 1) labels.set(pid, `${l}#${pid}`);
  const isObs = pid => isNativeName(tree.get(pid)?.name || '');

  // per-tick per-pid mem and cpu%
  const ticks = [];
  let prev = new Map();
  for (const s of samples) {
    const tick = { t: s.t, fg: s.fg, procs: new Map() };
    for (const p of s.p) {
      if (!tree.has(p.pid)) continue;
      const pr = prev.get(p.pid);
      const cpuPct = pr && p.ts > pr.ts ? ((p.cpu - pr.cpu) / (p.ts - pr.ts) / cores) * 100 : null;
      tick.procs.set(p.pid, { memMB: p.ws / MB, privMB: p.pb / MB, cpuPct });
    }
    prev = new Map(s.p.map(p => [p.pid, p]));
    ticks.push(tick);
  }

  const summarize = seg => {
    const win = ticks.filter(t => t.t >= seg.sampleStart && t.t <= seg.sampleEnd);
    const series = (filter, field) =>
      win.map(t => {
        let sum = 0;
        for (const [pid, v] of t.procs) if (filter(pid) && v[field] != null) sum += v[field];
        return sum;
      });
    const totals = filter => {
      const mem = series(filter, 'memMB');
      const priv = series(filter, 'privMB');
      const cpu = series(filter, 'cpuPct').slice(1);
      return {
        memMB: { median: r1(median(mem)), p95: r1(pct(mem, 0.95)), max: r1(mem.length ? Math.max(...mem) : null) },
        privateMB: { median: r1(median(priv)) },
        cpuPct: { avg: r2(avg(cpu)), p95: r2(pct(cpu, 0.95)), max: r2(cpu.length ? Math.max(...cpu) : null) },
      };
    };
    const byProcess = [...tree.keys()]
      .map(pid => {
        const mem = win.map(t => t.procs.get(pid)?.memMB).filter(x => x != null);
        const priv = win.map(t => t.procs.get(pid)?.privMB).filter(x => x != null);
        const cpu = win.map(t => t.procs.get(pid)?.cpuPct).filter(x => x != null);
        return {
          label: labels.get(pid),
          pid,
          memMB: r1(median(mem)),
          privateMB: r1(median(priv)),
          cpuPctAvg: r2(avg(cpu)),
          cpuPctP95: r2(pct(cpu, 0.95)),
          presentTicks: mem.length,
        };
      })
      .filter(p => p.presentTicks > 0)
      .sort((a, b) => b.memMB - a.memMB);

    const states = metrics
      .filter(m => m.t >= seg.sampleStart && m.t <= seg.sampleEnd)
      .map(m => m.mainWindow)
      .filter(Boolean);
    // Focus = the foreground window belongs to any process of the app (the OBS preview
    // is a native child window owned by obs64). Visibility/minimized from the hook.
    const frac = f => (states.length ? r2(states.filter(f).length / states.length) : null);
    const fgOwn = win.length ? r2(win.filter(t => tree.has(t.fg)).length / win.length) : null;
    const fgOwners = [...new Set(win.map(t => (tree.has(t.fg) ? labels.get(t.fg) : `other-app:${fgNames.get(t.fg) || t.fg}`)))];
    const notMin = frac(w => !w.minimized);
    const okFrac = {
      S0: frac(w => w.minimized),
      S1: Math.min(fgOwn ?? 0, notMin ?? 0),
      S2: Math.min(fgOwn ?? 0, notMin ?? 0),
      S3: Math.min(fgOwn ?? 0, notMin ?? 0),
      S5: Math.min(fgOwn ?? 0, notMin ?? 0),
      // S1u: main window visible but not focused (whatever else holds the foreground)
      S1u: frac(w => !w.focused && w.visible && !w.minimized),
    }[seg.scenario];
    const ok = okFrac == null ? null : okFrac >= 0.9;

    return {
      scenario: seg.scenario,
      phases: { scenarioApplied: seg.applied, sampleStart: seg.sampleStart, sampleEnd: seg.sampleEnd },
      electron: totals(pid => !isObs(pid)),
      native: totals(isObs),
      all: totals(() => true),
      byProcess,
      scenarioCheck: ok,
      scenarioCheckFraction: okFrac,
      foregroundOwners: fgOwners,
    };
  };

  const timeline = {
    t0: samples.length ? samples[0].t : null,
    t: ticks.map(t => t.t - (samples[0]?.t || 0)),
    procs: Object.fromEntries(
      [...tree.keys()].map(pid => [
        labels.get(pid),
        {
          memMB: ticks.map(t => (t.procs.has(pid) ? r1(t.procs.get(pid).memMB) : null)),
          cpuPct: ticks.map(t => (t.procs.has(pid) ? r2(t.procs.get(pid).cpuPct) : null)),
        },
      ]),
    ),
  };

  const last = metrics[metrics.length - 1];
  return {
    schema: 2,
    name,
    label,
    mode,
    build: 'production (NODE_ENV=production, --skip-update, --local-bundles, unpackaged)',
    fixture: path.relative(repo, fixture),
    git: gitInfo(),
    app: appInfo(),
    machine,
    settleSec,
    transitionSec,
    sampleSec,
    intervalMs: 1000,
    phases,
    startup: { mainWindowShownMs: phases.mainWindowShown ? phases.mainWindowShown - phases.launch : null },
    segments: segments.map(summarize),
    processes: [...tree.keys()].map(pid => ({ pid, label: labels.get(pid), cmd: cmdSummary(cmdlines.get(pid)) })),
    webContentsAtEnd: last ? last.webContents : [],
    shutdown,
    error,
    notes,
    timeline,
  };
}

// ---------- memory-infra trace analysis ----------
// Chromium periodic memory dumps (ph 'v'): per process, allocator sizes. We take the last
// dump per process and report top-level allocators + selected 2nd-level ones.
export function analyzeMemoryTrace(tracePath, processes) {
  try {
    const raw = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
    const evs = Array.isArray(raw) ? raw : raw.traceEvents;
    const labelByPid = new Map((processes || []).map(p => [p.pid, p.label]));
    // A dump is split over several 'v' events (allocators in one, process_totals in another):
    // merge per pid, keeping the latest allocator set and the latest totals.
    const lastDump = new Map();
    for (const e of evs) {
      if (e.ph !== 'v' || !e.args || !e.args.dumps) continue;
      const cur = lastDump.get(e.pid) || {};
      if (e.args.dumps.allocators) cur.allocators = e.args.dumps.allocators;
      if (e.args.dumps.process_totals) cur.process_totals = e.args.dumps.process_totals;
      lastDump.set(e.pid, cur);
    }
    const hexMB = v => (v ? Math.round((parseInt(v, 16) / 1048576) * 10) / 10 : 0);
    const out = {};
    for (const [pid, d] of lastDump) {
      const label = labelByPid.get(pid) || `pid ${pid}`;
      const alloc = d.allocators || {};
      const sizes = {};
      for (const [name, a] of Object.entries(alloc)) {
        const depth = name.split('/').length;
        const top = name.split('/')[0];
        const keep = depth === 1 || (depth === 2 && ['gpu', 'skia', 'shared_memory', 'partition_alloc', 'malloc', 'discardable', 'shared_image', 'cc'].includes(top));
        if (!keep || !a.attrs || !a.attrs.size) continue;
        const mb = hexMB(a.attrs.size.value);
        if (mb >= 0.5) sizes[name] = mb;
      }
      const totals = d.process_totals || {};
      out[label] = {
        residentMB: hexMB(totals.resident_set_bytes),
        privateFootprintMB: hexMB(totals.private_footprint_bytes),
        allocatorsMB: Object.fromEntries(Object.entries(sizes).sort((a, b) => b[1] - a[1])),
      };
    }
    return out;
  } catch (e) {
    return { error: String(e.message) };
  }
}

// ---------- output ----------
function writeResult(result) {
  const runFile = path.join(repo, '.bench', 'runs', result.name, 'result.json');
  fs.writeFileSync(runFile, JSON.stringify(result, null, 1));
  if (!record) return runFile;
  const dir = path.join(repo, 'docs', 'rework', 'benchmarks');
  const file = path.join(dir, `${result.name}.json`);
  fs.writeFileSync(file, JSON.stringify(result));
  for (const s of result.segments) {
    const top = s.byProcess
      .slice(0, 4)
      .map(p => `${p.label} ${Math.round(p.memMB)}`)
      .join(', ');
    const flags = [result.error && `ERROR: ${result.error}`, s.scenarioCheck === false && 'scenario-check-failed']
      .filter(Boolean)
      .join('; ');
    const row = `| [${result.name}](${result.name}.json) | ${result.name.slice(0, 10)} | ${result.label} | ${s.scenario} | ${s.electron.memMB.median} | ${s.electron.privateMB.median} | ${s.electron.cpuPct.avg} | ${s.native.memMB.median} / ${s.native.cpuPct.avg} | ${top} | ${flags} |\n`;
    fs.appendFileSync(path.join(dir, 'SUMMARY.md'), row);
  }
  return file;
}

function printResult(r) {
  console.log(`\n=== ${r.name} (${r.mode}) ===`);
  console.log(
    `startup: main window shown ${r.startup.mainWindowShownMs} ms; shutdown clean=${r.shutdown.clean} ${r.shutdown.durationMs} ms (quit event ${r.shutdown.quitEventMs} ms); leftovers=${r.shutdown.leftoverProcesses.join(',') || 'none'}`,
  );
  if (r.error) console.log(`ERROR: ${r.error}`);
  if (r.gpuInfo) console.log(`gpu: ${JSON.stringify({ renderer: r.gpuInfo.glRenderer, devices: r.gpuInfo.devices, gl: r.gpuInfo.glImplementationParts })}`);
  if (r.gpuModules) console.log(`gpu DLLs (image MB): ${r.gpuModules.slice(0, 10).map(m => `${m.module} ${m.imageMB}`).join(', ')}`);
  if (r.memoryBreakdown && r.memoryBreakdown.gpu) {
    const g = r.memoryBreakdown.gpu;
    console.log(`gpu memory-infra: resident ${g.residentMB} MB, private footprint ${g.privateFootprintMB} MB`);
    for (const [k, v] of Object.entries(g.allocatorsMB).slice(0, 15)) console.log(`    ${String(v).padStart(7)} MB  ${k}`);
  }
  for (const s of r.segments) {
    const e = s.electron;
    const o = s.native;
    console.log(
      `--- ${s.scenario} (check ${s.scenarioCheck} ${s.scenarioCheckFraction}, foreground: ${s.foregroundOwners.join('/')}) Electron: ${e.memMB.median} MB ws / ${e.privateMB.median} MB private, CPU avg ${e.cpuPct.avg}% (p95 ${e.cpuPct.p95}%) | native OBS: ${o.memMB.median} MB, CPU ${o.cpuPct.avg}%`,
    );
    for (const p of s.byProcess.slice(0, 8))
      console.log(`  ${String(p.memMB).padStart(7)} MB  ${String(p.cpuPctAvg).padStart(6)} %  ${p.label}`);
  }
}

// ---------- main ----------
const machine = machineInfo();
log(`machine: ${JSON.stringify(machine)}`);
if (machine.onAcPower === false) log('WARNING: running on battery — results not comparable');
let first = true;
for (const plan of plans) {
  for (let n = 1; n <= runs; n++) {
    if (!first) await sleep(10_000); // cool-down between launches
    first = false;
    const result = await runOnce(plan, n, machine);
    const file = writeResult(result);
    printResult(result);
    log(`written ${path.relative(repo, file)}`);
  }
}
