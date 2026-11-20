// utilityProcess entry: loads native modules, runs OSN functional test.
const path = require('path');
const os = require('os');
const fs = require('fs');
const REPO = process.env.GATE_REPO;
const NM = path.join(REPO, 'node_modules');
const send = m => process.parentPort.postMessage(m);
const t = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const errStr = e => String((e && e.message) || e).split('\n')[0];

const loaded = {};
const MODS = require('./modules.js');
function loadAll() {
  const res = {};
  for (const [name, dir] of Object.entries(MODS)) {
    const t0 = t();
    try {
      loaded[name] = require(path.join(NM, dir));
      res[name] = { ok: true, ms: +(t() - t0).toFixed(1) };
    } catch (e) {
      res[name] = { ok: false, error: errStr(e), code: e.code };
    }
  }
  return res;
}

function safeCalls() {
  const out = {};
  const tryc = (k, f) => {
    try { out[k] = { ok: true, value: f() }; } catch (e) { out[k] = { ok: false, error: errStr(e) }; }
  };
  const keys = n => () => ({ keys: Object.keys(loaded[n]).slice(0, 12) });
  if (loaded['font-manager']) tryc('font-manager', () => {
    const fm = loaded['font-manager'];
    const f = fm.getAvailableFontsSync ? fm.getAvailableFontsSync() : null;
    return { keys: Object.keys(fm), count: f && f.length, sample: f && f[0] && f[0].family };
  });
  if (loaded['node-fontinfo']) tryc('node-fontinfo', () => {
    const fi = loaded['node-fontinfo'];
    return { keys: Object.keys(fi), info: fi.getFontInfo ? fi.getFontInfo('C:\\Windows\\Fonts\\arial.ttf') : null };
  });
  for (const n of ['color-picker', 'node-win32-np', 'node-libuiohook', 'game_overlay', 'crash-handler']) {
    if (loaded[n]) tryc(n, keys(n));
  }
  if (loaded['node-screenshots']) tryc('node-screenshots', () => {
    const m = loaded['node-screenshots'].Monitor.all();
    const img = m[0] && m[0].captureImageSync();
    return { monitors: m.length, pngBytes: img && img.toPngSync().length };
  });
  return out;
}

function realmTest() {
  const Realm = loaded['realm'];
  if (!Realm) return { ok: false, error: 'realm not loaded' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-realm-'));
  try {
    const realm = new Realm({
      path: path.join(dir, 't.realm'),
      schema: [{ name: 'Thing', primaryKey: 'id', properties: { id: 'int', name: 'string' } }],
    });
    realm.write(() => { realm.create('Thing', { id: 1, name: 'hello' }); });
    const o = realm.objectForPrimaryKey('Thing', 1);
    const val = o && o.name;
    realm.close();
    return { ok: val === 'hello', readBack: val };
  } catch (e) {
    return { ok: false, error: errStr(e) };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

let continueResolve;
const continuePromise = new Promise(r => { continueResolve = r; });

async function osnTest() {
  const steps = [];
  const step = (name, f) => {
    const t0 = t();
    try {
      const r = f();
      steps.push({ name, ok: true, ms: +(t() - t0).toFixed(1), result: r });
      return r;
    } catch (e) {
      steps.push({ name, ok: false, ms: +(t() - t0).toFixed(1), error: errStr(e) });
      throw e;
    }
  };
  let obs, hosted = false, inited = false;
  const appData = path.join(os.tmpdir(), `native-gate-${Date.now()}`);
  fs.mkdirSync(appData, { recursive: true });
  try {
    obs = loaded['obs-studio-node'];
    if (!obs) throw new Error('obs-studio-node not loaded');
    step('IPC.host', () => { obs.IPC.host(`slobs-gate-${Math.random().toString(36).slice(2)}`); hosted = true; });
    step('SetWorkingDirectory', () => obs.NodeObs.SetWorkingDirectory(path.join(NM, 'obs-studio-node')));
    const r = step('OBS_API_initAPI (expect 0=Success)', () =>
      obs.NodeObs.OBS_API_initAPI({ language: 'en-US', appDataPath: appData, version: '0.0.0-gate', crashServerUrl: '' }));
    inited = r === 0;
    if (!inited) throw new Error('initAPI returned ' + r);
    const scene = step('SceneFactory.create', () => obs.SceneFactory.create('gate-scene'));
    step('scene.name', () => scene.name);
    const src = step('InputFactory.create color_source', () =>
      obs.InputFactory.create('color_source', 'gate-color', { color: 4278190335, width: 320, height: 240 }));
    step('scene.add', () => ({ itemId: scene.add(src).id }));
    step('read back', () => ({
      scene: obs.SceneFactory.fromName('gate-scene').name,
      sourceName: src.name,
      settings: src.settings,
      items: scene.getItems().length,
    }));
    // let main measure memory while OSN is live
    send({ type: 'osn-ready' });
    await continuePromise;
    step('release', () => { src.release(); scene.release(); });
  } catch (e) { /* recorded in steps */ }
  try { if (inited) step('InitShutdownSequence', () => obs.NodeObs.InitShutdownSequence()); } catch (e) {}
  try { if (hosted) step('IPC.disconnect', () => obs.IPC.disconnect()); } catch (e) {}
  return { steps, appData };
}

process.parentPort.on('message', async ({ data }) => {
  if (data.cmd === 'continue') return continueResolve();
  if (data.cmd === 'run') {
    const out = { versions: process.versions, load: loadAll() };
    out.calls = safeCalls();
    out.realm = realmTest();
    out.osn = await osnTest();
    send({ type: 'done', out });
  }
});
