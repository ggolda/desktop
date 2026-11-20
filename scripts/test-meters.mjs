// Real-OBS check of the meters path (needs `npm run build` and the native OBS modules):
//   - writes a sine WAV and a throw-away collection with one looping ffmpeg_source (media source)
//   - launches the built app (throw-away userData, CDP port), reloads the page with a hook on the
//     window's core MessagePort that records every `meters` frame and every meters-on/off message
//   - meters ON (window focused): frames arrive at <= 15 Hz and the tone source has non-silent peaks
//   - meters OFF (window blurred): no frames are sent, core logs `meters.off` (volmeters removed)
//   - the app quits cleanly and no obs64 process of ours is left
// Usage: node scripts/test-meters.mjs
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slobs-meters-'));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

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

// --- fixtures: 440 Hz tone, 16-bit mono 48 kHz, 2 s, amplitude 0.5
const wav = path.join(dir, 'tone.wav');
{
  const rate = 48000;
  const n = rate * 2;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(
      Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)),
      44 + i * 2,
    );
  fs.writeFileSync(wav, buf);
}
const hk = { schemaVersion: 2, nodeType: 'HotkeysNode', items: [] };
const TONE = 'ffmpeg_source_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCENE = 'scene_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COLL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const collection = {
  schemaVersion: 5,
  nodeType: 'RootNode',
  sources: {
    schemaVersion: 5,
    nodeType: 'SourcesNode',
    items: [
      {
        hotkeys: hk,
        id: TONE,
        name: 'Tone',
        type: 'ffmpeg_source',
        settings: {
          local_file: wav,
          is_local_file: true,
          looping: true,
          close_when_inactive: false,
        },
        volume: 1,
        muted: false,
        deinterlaceMode: 0,
        deinterlaceFieldOrder: 0,
        filters: { items: [] },
        propertiesManager: 'default',
        propertiesManagerSettings: {},
        forceMono: false,
        syncOffset: { sec: 0, nsec: 0 },
        audioMixers: 255,
        monitoringType: 0,
        mixerHidden: false,
      },
    ],
  },
  scenes: {
    schemaVersion: 1,
    nodeType: 'ScenesNode',
    items: [
      {
        hotkeys: hk,
        filters: { schemaVersion: 1, nodeType: 'SceneFiltersNode', items: [] },
        sceneItems: {
          schemaVersion: 1,
          nodeType: 'SceneItemsNode',
          items: [
            {
              hotkeys: hk,
              id: 'item-0000-4000-8000-000000000001',
              sourceId: TONE,
              x: 0,
              y: 0,
              scaleX: 1,
              scaleY: 1,
              visible: true,
              crop: { left: 0, top: 0, right: 0, bottom: 0 },
              locked: false,
              rotation: 0,
              streamVisible: true,
              recordingVisible: true,
              scaleFilter: 0,
              blendingMode: 0,
              blendingMethod: 0,
              sceneNodeType: 'item',
              display: 'horizontal',
            },
          ],
        },
        id: SCENE,
        name: 'Scene',
        active: true,
      },
    ],
  },
  transitions: {
    schemaVersion: 2,
    nodeType: 'TransitionsNode',
    transitions: [
      {
        id: 'transition-0000-4000-8000-000000000007',
        name: 'Global Transition',
        type: 'cut_transition',
        duration: 300,
        settings: {},
        propertiesManagerSettings: {},
      },
    ],
    connections: [],
    defaultTransitionId: 'transition-0000-4000-8000-000000000007',
  },
  hotkeys: hk,
  guestCam: { schemaVersion: 1, nodeType: 'GuestCamNode', audioSourceId: '', videoSourceId: '' },
  relativeCoordinates: true,
  baseResolution: { baseWidth: 1920, baseHeight: 1080 },
  baseResolutions: {
    horizontal: { baseWidth: 1920, baseHeight: 1080 },
    vertical: { baseWidth: 720, baseHeight: 1280 },
  },
  selectiveRecording: false,
  dualOutputMode: false,
  operatingSystem: 'win32',
};
fs.mkdirSync(path.join(dir, 'SceneCollections'));
fs.writeFileSync(path.join(dir, 'SceneCollections', `${COLL}.json`), JSON.stringify(collection));
fs.writeFileSync(
  path.join(dir, 'SceneCollections', 'manifest.json'),
  JSON.stringify({
    activeId: COLL,
    collections: [
      {
        id: COLL,
        name: 'Meters test',
        modified: new Date().toISOString(),
        auto: false,
        operatingSystem: 'win32',
        deleted: false,
        needsRename: false,
      },
    ],
  }),
);

// --- launch
const port = 9300 + Math.floor(Math.random() * 500);
const logFile = path.join(dir, 'core.log');
const beforeObs = new Set(pidsOf('obs64.exe'));
const beforeCrash = new Set(pidsOf('crash-handler-process.exe'));
const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  cwd: root,
  env: { ...process.env, SLOBS_USERDATA_DIR: dir, SLOBS_CORE_LOG: logFile },
  stdio: 'ignore',
});
const exited = new Promise(r => child.on('exit', r));
const killer = setTimeout(() => child.kill(), 150_000);

async function waitFor(f, what, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await f();
      if (v) return v;
    } catch {
      // not yet
    }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(300);
  }
}
const coreLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');

let ws;
let nextId = 1;
const waiters = new Map();
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiters.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async expr => {
  const r = await cdp('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

// Hook: records frames and meters-on/off posted by the window's core client.
const HOOK = `(() => {
  const w = (globalThis.__meters = { frames: [], out: [], t0: performance.now() });
  const parse = d => {
    const recs = [];
    let i = 3;
    for (let k = 0; k < d[2]; k++) {
      const ch = d[i++];
      const peak = ch ? d[i] : null;
      i += ch * 3;
      recs.push({ ch, peak });
    }
    return { rev: d[1], recs };
  };
  const desc = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', {
    configurable: true,
    get: desc.get,
    set(fn) {
      desc.set.call(this, fn && (e => {
        const m = e.data;
        if (m && m.type === 'meters') w.frames.push({ t: performance.now() - w.t0, ...parse(m.data) });
        return fn(e);
      }));
    },
  });
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (m && (m.type === 'meters-on' || m.type === 'meters-off')) w.out.push({ t: performance.now() - w.t0, type: m.type });
    return post.call(this, m, ...rest);
  };
})()`;

let exitCode = 1;
try {
  const target = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/json`);
    const j = await r.json();
    return j.find(t => t.type === 'page');
  }, 'CDP page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    const w = waiters.get(m.id);
    if (w) {
      waiters.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message));
      else w.resolve(m.result);
    }
  };
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await waitFor(() => coreLog().includes('[perf] mark ready'), 'core ready');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  await cdp('Page.reload');
  await waitFor(
    () => evaluate(`document.body && document.body.innerText.includes('Tone')`),
    'mixer row',
  );

  // ---- meters ON
  await sleep(500);
  await evaluate('__meters.frames.length = 0');
  await sleep(5000);
  const on = JSON.parse(
    await evaluate('JSON.stringify({frames: __meters.frames, out: __meters.out})'),
  );
  const fr = on.frames;
  check(
    on.out.some(o => o.type === 'meters-on'),
    'window sent meters-on',
  );
  check(fr.length >= 10, `frames arrive while on (${fr.length} in 5 s)`);
  let maxPerSec = 0;
  for (let i = 0; i < fr.length; i++) {
    const n = fr.filter(f => f.t >= fr[i].t && f.t < fr[i].t + 1000).length;
    maxPerSec = Math.max(maxPerSec, n);
  }
  check(maxPerSec <= 15, `at most 15 frames in any 1 s window (max ${maxPerSec})`);
  const peaks = fr.map(f => f.recs[0]?.peak).filter(p => p !== null && p !== undefined);
  const best = peaks.length ? Math.max(...peaks) : -Infinity;
  check(
    best > -30 && best < 0,
    `tone source has non-silent peaks (max ${best.toFixed(1)} dB, expect about -6)`,
  );

  // ---- meters OFF (window blurred)
  await evaluate(`document.hasFocus = () => false; window.dispatchEvent(new Event('blur'))`);
  await sleep(3500); // core keeps the volmeters for 2 s after the last window leaves
  await evaluate('__meters.frames.length = 0');
  await sleep(2500);
  const off = JSON.parse(
    await evaluate('JSON.stringify({frames: __meters.frames.length, out: __meters.out})'),
  );
  check(
    off.out.some(o => o.type === 'meters-off'),
    'window sent meters-off',
  );
  check(off.frames === 0, `no frames while off (${off.frames})`);
  check(coreLog().includes('[perf] mark meters.off'), 'core removed the volmeters (meters.off)');

  // ---- meters ON again
  await evaluate(`delete document.hasFocus; window.dispatchEvent(new Event('focus'))`);
  await sleep(2500);
  const again = await evaluate('__meters.frames.length');
  check(again > 5, `frames resume when focus returns (${again})`);

  cdp('Browser.close').catch(() => {}); // the socket closes with the app: never resolves
  await Promise.race([exited, sleep(60_000)]);
  let left = [];
  for (let i = 0; i < 60; i++) {
    left = pidsOf('obs64.exe').filter(p => !beforeObs.has(p));
    if (!left.length) break;
    await sleep(500);
  }
  check(left.length === 0, 'obs64 exited');
  exitCode = failures.length ? 1 : 0;
} catch (e) {
  console.error('test failed:', e.message);
  console.error(coreLog().split('\n').slice(-15).join('\n'));
} finally {
  clearTimeout(killer);
  if (child.exitCode === null) child.kill();
  for (const pid of pidsOf('crash-handler-process.exe').filter(p => !beforeCrash.has(p))) {
    try {
      process.kill(pid);
    } catch {
      // gone
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(exitCode === 0 ? 'meters test: OK' : `meters test: FAILED (${failures.join('; ')})`);
process.exit(exitCode);
