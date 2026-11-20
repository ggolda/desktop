// Hotfix bundle test (SPEC 8.3). Prerequisite: `npm run build`.
// Derives a "hotfix" set from the built bundles/ (new core + main js + patched html, new hashes,
// rewritten manifest), serves it from a local HTTP server and launches the built app in
// production mode (SLOBS_BUNDLE_CDN -> server, --skip-update, throw-away userData):
//   (a) good hotfix        -> hotfix set active, core + page come from the cache set
//   (b) corrupted file     -> bad md5 is rejected, falls back to the local set, app still starts
//   (c) offline after (a)  -> cached set is used
import { execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const MARK = 'HOTFIXED';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

function pidsOf(image) {
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

// ---- 1. build the hotfix variant set ---------------------------------------------------------
const local = path.join(root, 'bundles');
const manifest = JSON.parse(fs.readFileSync(path.join(local, 'manifest.json'), 'utf8'));
const variant = fs.mkdtempSync(path.join(os.tmpdir(), 'slobs-hotfix-set-'));
for (const f of fs.readdirSync(local)) {
  if (!f.endsWith('.map')) fs.copyFileSync(path.join(local, f), path.join(variant, f));
}
const vm = { ...manifest, checksums: { ...manifest.checksums } };
for (const k of Object.keys(vm)) if (k.endsWith('.map')) delete vm[k];

function patch(logical, newName, edit) {
  const old = vm[logical];
  const next = edit(fs.readFileSync(path.join(variant, old), 'utf8'));
  fs.rmSync(path.join(variant, old));
  fs.writeFileSync(path.join(variant, newName), next);
  delete vm.checksums[old];
  vm[logical] = newName;
  vm.checksums[newName] = md5(next);
  return { old, newName };
}
const mainJs = patch('main.js', 'main.HOTFIX01.js', s => `${s}\n/* hotfix */`);
patch('core.js', 'core.HOTFIX01.js', s => `${s}\n/* hotfix */`);
// html keeps its (unhashed) name: exercises the checksum rule for same-name files
patch('main.html', 'main.html', s =>
  s.replace(mainJs.old, mainJs.newName).replace(/<title>.*<\/title>/, `<title>${MARK}</title>`),
);
fs.writeFileSync(path.join(variant, 'manifest.json'), JSON.stringify(vm, null, 2));

// ---- 2. local "CDN" -------------------------------------------------------------------------
let corrupt = null; // file name served with wrong bytes
let hits = [];
const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\//, ''));
  hits.push(name);
  const file = path.join(variant, name);
  if (!name || name.includes('..') || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  let data = fs.readFileSync(file);
  if (name === corrupt) data = Buffer.concat([data, Buffer.from('/* tampered */')]);
  res.writeHead(200).end(data);
});
let port = 0;
const listen = () =>
  new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
port = await listen();
const closeServer = () => new Promise(resolve => server.close(resolve));

// ---- 3. run the app --------------------------------------------------------------------------
async function runApp(userData, cdnPort) {
  const beforeObs = new Set(pidsOf('obs64.exe'));
  const beforeCrash = new Set(pidsOf('crash-handler-process.exe'));
  const child = spawn(electron, ['.', '--skip-update'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SLOBS_SMOKE: '1',
      SLOBS_USERDATA_DIR: userData,
      SLOBS_BUNDLE_CDN: `http://127.0.0.1:${cdnPort}/`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let result = null;
  let log = '';
  let buf = '';
  child.stderr.on('data', d => (log += d));
  child.stdout.on('data', d => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) {
      if (l.startsWith('{"ok"')) result = JSON.parse(l);
      else log += `${l}\n`;
    }
  });
  const killer = setTimeout(() => child.kill(), 90_000);
  await new Promise(resolve => child.on('exit', resolve));
  clearTimeout(killer);
  for (let i = 0; i < 30; i++) {
    if (!pidsOf('obs64.exe').some(p => !beforeObs.has(p))) break;
    await sleep(500);
  }
  for (const pid of pidsOf('crash-handler-process.exe').filter(p => !beforeCrash.has(p))) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
  await sleep(500);
  return { result, log };
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
}
const cacheDir = ud => path.join(ud, 'bundles', version);
const tmpUd = () => fs.mkdtempSync(path.join(os.tmpdir(), 'slobs-hotfix-ud-'));

try {
  // (a) good hotfix, then (c) offline with the same userData
  const udA = tmpUd();
  const a = await runApp(udA, port);
  const ra = a.result ?? {};
  check('(a) app started', ra.ok, JSON.stringify(ra) + a.log.slice(-500));
  check('(a) hotfix set active', ra.bundleSet === 'hotfix', ra.bundleSet);
  check('(a) page text is the hotfixed one', ra.htmlTitle === MARK, ra.htmlTitle);
  check(
    '(a) hotfixed script served',
    (ra.scripts ?? []).includes(`./${mainJs.newName}`),
    ra.scripts,
  );
  check(
    '(a) core loaded from the cache set',
    ra.corePath === path.join(cacheDir(udA), 'core.HOTFIX01.js'),
    ra.corePath,
  );
  check(
    '(a) cache dir holds the complete set',
    Object.values(vm)
      .filter(v => typeof v === 'string')
      .every(f => fs.existsSync(path.join(cacheDir(udA), f))),
    fs.readdirSync(cacheDir(udA)).join(','),
  );
  check(
    '(a) unchanged files were not downloaded',
    !hits.includes(vm['preload.js']) &&
      hits.includes('main.html') &&
      hits.includes('core.HOTFIX01.js'),
    hits.join(','),
  );

  await closeServer();
  const c = await runApp(udA, port);
  const rc = c.result ?? {};
  check('(c) offline: app started', rc.ok, JSON.stringify(rc) + c.log.slice(-500));
  check(
    '(c) offline: cached set used',
    rc.bundleSet === 'hotfix' && rc.htmlTitle === MARK,
    rc.bundleSet,
  );
  check(
    '(c) offline: core from cache',
    rc.corePath === path.join(cacheDir(udA), 'core.HOTFIX01.js'),
    rc.corePath,
  );

  // (b) corrupted file on the server, fresh userData
  port = await listen();
  corrupt = 'main.HOTFIX01.js';
  const udB = tmpUd();
  const b = await runApp(udB, port);
  const rb = b.result ?? {};
  check('(b) corrupt file: app still started', rb.ok, JSON.stringify(rb) + b.log.slice(-500));
  check(
    '(b) fell back to the local set',
    rb.bundleSet === 'local' && rb.htmlTitle !== MARK,
    JSON.stringify(rb),
  );
  check(
    '(b) corrupt download removed, manifest not cached',
    !fs.existsSync(path.join(cacheDir(udB), 'manifest.json')) &&
      !fs.existsSync(path.join(cacheDir(udB), 'main.HOTFIX01.js')),
    fs.existsSync(cacheDir(udB)) ? fs.readdirSync(cacheDir(udB)).join(',') : 'no cache dir',
  );
  for (const ud of [udA, udB])
    fs.rmSync(ud, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} finally {
  server.close();
  fs.rmSync(variant, { recursive: true, force: true });
}

const failed = results.filter(r => !r.ok);
console.log(
  JSON.stringify({
    ok: failed.length === 0,
    passed: results.length - failed.length,
    failed: failed.length,
  }),
);
process.exit(failed.length ? 1 : 0);
