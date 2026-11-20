// Integration check of the collections code against real OBS (needs `npm run build` and the native
// OBS modules). For every fixture under `.bench/fixtures/` (or the names given as arguments):
//   1. copies ONLY its SceneCollections into a throw-away userData (scripts/fixtures/copy-collections.mjs)
//   2. launches the built app with SLOBS_SMOKE=1 + SLOBS_TEST_COLLECTIONS=1 (the smoke mechanism): core loads
//      the active collection in OBS, prints counts and timings, force-dirties every node and saves
//      (C4), then the app quits cleanly (final settings re-read + save)
//   3. compares every file in the temp dir with the original: paths and types of differences, never values
//   4. checks that no obs64 / crash-handler process was left behind
// Usage: node scripts/test-collections.mjs [fixture ...]
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyCollections, listFixtures, makeTempUserData } from './fixtures/copy-collections.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const maxDelta = new Map();
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Differences between two JSON values as `path (typeA>typeB)`; array indices are folded to `[]`. */
function diffPaths(a, b, base, out) {
  if (a === b) return;
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb || (ta !== 'object' && ta !== 'array')) {
    const key = `${base} (${ta}>${tb})`;
    out.set(key, (out.get(key) ?? 0) + 1);
    // magnitude only, never the values: how far numbers moved
    if (ta === 'number' && tb === 'number') {
      const d = Math.abs(a - b);
      maxDelta.set(key, Math.max(maxDelta.get(key) ?? 0, d));
    }
    return;
  }
  if (ta === 'array') {
    if (a.length !== b.length) {
      const key = `${base}.length (array length)`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i], b[i], `${base}[]`, out);
    return;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    if (!(k in a)) {
      const key = `${base}.${k} (added)`;
      out.set(key, (out.get(key) ?? 0) + 1);
    } else if (!(k in b)) {
      const key = `${base}.${k} (removed)`;
      out.set(key, (out.get(key) ?? 0) + 1);
    } else diffPaths(a[k], b[k], `${base}.${k}`, out);
  }
}

function keyOrderChanged(a, b) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (!Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length === kb.length && ka.every(k => k in b) && ka.join() !== kb.join()) return true;
  }
  const ks = Array.isArray(a) ? a.map((_, i) => i) : Object.keys(a);
  return ks.some(k => k in b && keyOrderChanged(a[k], b[k]));
}

function compareFiles(originals, dir) {
  const result = { identical: [], changed: [], added: [], byPath: {} };
  const dest = path.join(dir, 'SceneCollections');
  const now = new Set(fs.readdirSync(dest));
  for (const [name, text] of originals) {
    if (!now.has(name)) continue;
    const after = fs.readFileSync(path.join(dest, name), 'utf8');
    if (after === text) {
      result.identical.push(name);
      continue;
    }
    const entry = { file: name, bytes: [text.length, after.length] };
    try {
      const a = JSON.parse(text);
      const b = JSON.parse(after);
      const out = new Map();
      diffPaths(a, b, '$', out);
      entry.keyOrderChanged = keyOrderChanged(a, b);
      // .bak files are copies of what loaded: only the collection files themselves are compared by path
      if (!name.endsWith('.bak'))
        for (const [k, v] of out) result.byPath[k] = (result.byPath[k] ?? 0) + v;
      entry.paths = out.size;
    } catch {
      entry.note = 'not JSON';
    }
    result.changed.push(entry);
  }
  for (const f of now) if (!originals.has(f) && !f.endsWith('.tmp')) result.added.push(f);
  return result;
}

async function runFixture(arg) {
  // `fixture` or `fixture:<id prefix>` (starts that collection of the fixture instead of the active one)
  const [name, prefix] = arg.split(':');
  const userData = makeTempUserData('slobs-collections-');
  const { copied } = copyCollections(name, userData);
  if (prefix) {
    const mp = path.join(userData, 'SceneCollections', 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    const hit = m.collections.find(c => c.id.startsWith(prefix));
    if (!hit) throw new Error(`no collection starts with ${prefix}`);
    m.activeId = hit.id;
    fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  }
  const originals = new Map(
    copied.map(f => [f, fs.readFileSync(path.join(userData, 'SceneCollections', f), 'utf8')]),
  );
  const manifest = JSON.parse(originals.get('manifest.json') ?? '{}');
  const beforeObs = new Set(pidsOf('obs64.exe'));
  const beforeCrash = new Set(pidsOf('crash-handler-process.exe'));
  const logFile = path.join(os.tmpdir(), `slobs-core-log-${Date.now()}.txt`);
  const t0 = Date.now();
  const child = spawn(electron, ['.'], {
    cwd: root,
    env: {
      ...process.env,
      SLOBS_SMOKE: '1',
      SLOBS_TEST_COLLECTIONS: '1',
      SLOBS_USERDATA_DIR: userData,
      // the utility process stdout does not reach us: core appends its log lines to this file
      SLOBS_CORE_LOG: logFile,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let report = null;
  let shutdown = null;
  let smoke = null;
  const slow = [];
  const marks = [];
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    const ls = buf.split('\n');
    buf = ls.pop();
    for (const l of ls) if (l.startsWith('{"ok"')) smoke = JSON.parse(l);
  });
  const killer = setTimeout(() => child.kill(), 120_000);
  const code = await new Promise(resolve => child.on('exit', resolve));
  clearTimeout(killer);

  const errors = [];
  if (fs.existsSync(logFile)) {
    for (const l of fs.readFileSync(logFile, 'utf8').split('\n')) {
      if (l.startsWith('{"collectionsReport"')) report = JSON.parse(l).collectionsReport;
      else if (l.startsWith('{"collectionsShutdown"')) shutdown = JSON.parse(l).collectionsShutdown;
      else if (l.startsWith('[perf] slow ')) slow.push(l.slice('[perf] slow '.length).trim());
      else if (l.startsWith('[perf] mark ')) marks.push(l.slice('[perf] mark '.length).trim());
      else if (l.startsWith('[error]')) errors.push(l.slice(0, 160)); // first line only: no values
    }
    fs.rmSync(logFile, { force: true });
  }

  let leakedObs = [];
  for (let i = 0; i < 30; i++) {
    leakedObs = pidsOf('obs64.exe').filter(p => !beforeObs.has(p));
    if (!leakedObs.length) break;
    await sleep(500);
  }
  let leakedCrash = [];
  for (let i = 0; i < 20; i++) {
    leakedCrash = pidsOf('crash-handler-process.exe').filter(p => !beforeCrash.has(p));
    if (!leakedCrash.length) break;
    await sleep(500);
  }
  for (const pid of leakedCrash) {
    try {
      process.kill(pid);
    } catch {
      // gone
    }
  }
  await sleep(500);

  const files = compareFiles(originals, userData);
  try {
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    console.error(`could not remove ${userData}`);
  }
  const activeId = manifest.activeId ?? null;
  return {
    fixture: arg,
    ok:
      !!report && !report.error && code === 0 && leakedObs.length === 0 && leakedCrash.length === 0,
    exit: code,
    wallMs: Date.now() - t0,
    activeCollection: activeId ? activeId.slice(0, 8) : null,
    collectionFiles: copied.length,
    smokeOk: smoke?.ok ?? null,
    report: report && {
      ...report,
      perf: undefined,
      marks: report.perf?.marks,
      maxStall: `${report.perf?.maxStallMs}ms ${report.perf?.maxStallMethod}`,
    },
    slowCalls: slow,
    marks,
    errors,
    backendCalls: report?.perf
      ? Object.fromEntries(
          Object.entries(report.perf.backend)
            .sort((a, b) => b[1].totalMs - a[1].totalMs)
            .slice(0, 8)
            .map(([k, v]) => [k, `${v.count}x total ${v.totalMs}ms max ${v.maxMs}ms`]),
        )
      : null,
    rereadChangedTypes: shutdown?.rereadChangedTypes ?? null,
    files: {
      identical: files.identical.length,
      changed: files.changed,
      added: files.added,
    },
    diffPaths: Object.entries(files.byPath)
      .sort()
      .map(
        ([k, v]) =>
          `${k} x${v}${maxDelta.has(k) ? ` maxAbsDelta ${maxDelta.get(k).toExponential(2)}` : ''}`,
      ),
    leaked: { obs64: leakedObs, crashHandler: leakedCrash },
  };
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : listFixtures();
if (!names.length) {
  console.log('no fixtures under .bench/fixtures: nothing to do');
  process.exit(0);
}
let failed = false;
for (const name of names) {
  const r = await runFixture(name);
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) failed = true;
}
process.exit(failed ? 1 : 0);
