const { app, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const REPO = process.env.GATE_REPO || 'C:\\Users\\glebg\\Documents\\job\\rnd\\desktop';
process.env.GATE_REPO = REPO;
const NM = path.join(REPO, 'node_modules');
const MODS = require('./modules.js');
const OUT = process.env.GATE_OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const errStr = e => String((e && e.message) || e).split('\n')[0];
const mb = kb => +(kb / 1024).toFixed(1);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const obsPids = () => {
  try {
    return cp.execSync('tasklist /FI "IMAGENAME eq obs64.exe" /FO CSV /NH', { encoding: 'utf8' })
      .split('\n').map(l => l.split('","')[1]).filter(Boolean).map(Number);
  } catch { return []; }
};
const metrics = pid => {
  const m = app.getAppMetrics().find(x => x.pid === pid);
  return m ? { workingSetMB: mb(m.memory.workingSetSize), privateMB: mb(m.memory.privateBytes || 0) } : null;
};

function mainLoad() {
  const res = {};
  for (const [name, dir] of Object.entries(MODS)) {
    try { require(path.join(NM, dir)); res[name] = { ok: true }; }
    catch (e) { res[name] = { ok: false, error: errStr(e), code: e.code }; }
  }
  return res;
}

function runCore() {
  return new Promise(resolve => {
    const child = utilityProcess.fork(path.join(__dirname, 'core.js'), [], {
      serviceName: 'gate-core', env: { ...process.env, GATE_REPO: REPO },
    });
    const r = { pid: null };
    const t0 = Date.now();
    child.on('spawn', () => { r.pid = child.pid; child.postMessage({ cmd: 'run' }); });
    child.on('message', async m => {
      if (m.type === 'osn-ready') {
        await sleep(1000);
        r.memAfterOsnInit = metrics(child.pid);
        r.obsPidsDuringRun = obsPids();
        child.postMessage({ cmd: 'continue' });
      }
      if (m.type === 'done') { r.out = m.out; r.totalMs = Date.now() - t0; child.kill(); }
    });
    child.on('exit', code => { r.exitCode = code; resolve(r); });
    setTimeout(() => { if (r.exitCode === undefined) { r.timeout = true; child.kill(); } }, 90000);
  });
}

app.whenReady().then(async () => {
  const pidsBefore = obsPids();
  const result = { versions: process.versions, pidsBefore };
  try {
    result.mainLoad = mainLoad();
    const emptyChild = utilityProcess.fork(path.join(__dirname, 'empty.js'), [], { serviceName: 'gate-empty' });
    await new Promise(r => emptyChild.on('spawn', r));
    await sleep(1500);
    result.emptyUtilityMem = metrics(emptyChild.pid);
    emptyChild.kill();
    result.utility = await runCore();
  } catch (e) { result.harnessError = String(e.stack || e); }
  // obs64.exe should exit on its own once the host process is gone/disconnected; poll up to 15s
  const tw = Date.now();
  let after = obsPids();
  while (after.some(p => !pidsBefore.includes(p)) && Date.now() - tw < 15000) { await sleep(500); after = obsPids(); }
  result.obsExitWaitMs = Date.now() - tw;
  result.pidsAfter = after;
  result.obsLeftoversKilled = [];
  for (const p of after.filter(p => !pidsBefore.includes(p))) {
    try { process.kill(p); result.obsLeftoversKilled.push(p); } catch {}
  }
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  summary(result);
  app.exit(0);
});

function summary(r) {
  const L = [];
  L.push(`Electron ${r.versions.electron}  Node ${r.versions.node}  ABI ${r.versions.modules}  Chrome ${r.versions.chrome}`);
  if (r.harnessError) L.push('HARNESS ERROR: ' + r.harnessError);
  const u = r.utility && r.utility.out;
  L.push('\n' + 'module'.padEnd(20) + 'main'.padEnd(10) + 'utility');
  const f = x => (!x ? 'n/a' : x.ok ? 'OK' : 'FAIL: ' + x.error);
  for (const n of Object.keys(MODS)) {
    L.push(n.padEnd(20) + f(r.mainLoad && r.mainLoad[n]).padEnd(10) + f(u && u.load[n]));
  }
  if (u) {
    L.push('\nsafe calls (utility): ' + JSON.stringify(u.calls));
    L.push('realm write/read (utility): ' + JSON.stringify(u.realm));
    L.push('\nOSN steps:');
    for (const s of u.osn.steps) {
      L.push(`  ${s.ok ? 'OK  ' : 'FAIL'} ${s.name.padEnd(36)} ${String(s.ms).padStart(8)} ms  ${JSON.stringify(s.result !== undefined ? s.result : s.error)}`);
    }
  }
  L.push('\nmemory: empty utility ' + JSON.stringify(r.emptyUtilityMem));
  L.push('        core after OSN init+scene ' + JSON.stringify(r.utility && r.utility.memAfterOsnInit));
  L.push(`obs64 pids before ${JSON.stringify(r.pidsBefore)} during ${JSON.stringify(r.utility && r.utility.obsPidsDuringRun)} after ${JSON.stringify(r.pidsAfter)} (waited ${r.obsExitWaitMs}ms) killed ${JSON.stringify(r.obsLeftoversKilled)}`);
  console.log(L.join('\n'));
}
