// Core process entry (utilityProcess). No DOM, no UI imports.
import type { MessagePortMain } from 'electron';
import fs from 'node:fs';
import type { CoreContract } from '../shared/contracts';
import type { CoreStatus, CoreToMainMessage, MainToCoreMessage } from '../shared/protocol';
import { type Core, createCore } from './core';
import { registerAppDemo } from './demo/app';
import { createMainRpc } from './main-rpc';
import { createObsBackend } from './media/obs/adapter';
import { findObsPid } from './media/obs/osn';
import { createPerf } from './perf';
import { createRuntime } from './runtime/runtime';
import { electronTransport } from './runtime/transport';

const parentPort = process.parentPort;

/**
 * SLOBS_CORE_LOG=<file>: also append every core log line to that file (dev and test diagnostics; the
 * utility process stdout does not always reach the terminal).
 */
const logFile = process.env.SLOBS_CORE_LOG;
function log(line: string) {
  console.log(line);
  if (logFile) {
    try {
      fs.appendFileSync(
        logFile,
        `${line}
`,
      );
    } catch {
      // diagnostics only
    }
  }
}
if (logFile) {
  const err = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    err(...args);
    log(
      `[error] ${args.map(a => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' ')}`,
    );
  };
}
const perf = createPerf({ log });
perf.mark('core.start');

let core: Core | null = null;
const noFrame = new Float32Array([1, 0, 0]);
const runtime = createRuntime<CoreContract>({
  meters: {
    sample: () => core?.services.audio.meters.sample() ?? noFrame,
    onActiveChange: active => core?.services.audio.meters.onActiveChange(active),
  },
});

let status: CoreStatus = {
  obsInit: 'pending',
  code: null,
  initMs: null,
  versions: {
    app: '',
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
};

function toMain(msg: CoreToMainMessage) {
  parentPort.postMessage(msg);
}

const mainRpc = createMainRpc(toMain);
const app = registerAppDemo(runtime, status, () => perf.stats());

function broadcastStatus() {
  app.obs = status;
  runtime.broadcast({ type: 'status', status });
  toMain({ type: 'status', status });
}

let firstWindowId: number | null = null;

function addWindowPort(port: MessagePortMain, windowId: number) {
  firstWindowId ??= windowId;
  const conn = runtime.attach(electronTransport(port), { windowId });
  conn.send({ type: 'status', status });
}

/**
 * SLOBS_TEST_COLLECTIONS=1 (scripts/test-collections.mjs): the status broadcast waits until the
 * collection is loaded and force-saved, so the smoke flow (which quits after the status) runs the
 * whole check. Prints counts and timings, never values.
 */
const testMode = process.env.SLOBS_TEST_COLLECTIONS === '1';

/** Test mode: the real display path (native handle from main, create, move/resize, region, destroy). */
async function displayReport(c: Core) {
  const t0 = Date.now();
  while (firstWindowId === null && Date.now() - t0 < 10_000) {
    await new Promise(r => setTimeout(r, 50));
  }
  if (firstWindowId === null) return { error: 'no window connected' };
  const out: Record<string, unknown> = {};
  const b = c.ctx.backend;
  try {
    const handle = await mainRpc.call('window.nativeHandle', firstWindowId);
    out.handleBytes = handle.length;
    await b.displays.create({
      id: 'test-display',
      handle,
      canvas: 'horizontal',
      mode: 'main',
      drawUi: true,
    });
    await b.displays.moveResize('test-display', { x: 10, y: 10, width: 640, height: 360 });
    const r = await b.displays.getOutputRegion('test-display');
    out.region = { width: r.width, height: r.height };
    await b.displays.moveResize('test-display', { x: 10, y: 10, width: 0, height: 0 });
    out.hiddenRegion = await b.displays.getOutputRegion('test-display');
    await b.displays.destroy('test-display');
    out.ok = true;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

async function collectionsReport(c: Core) {
  const doc = c.ctx.doc;
  if (!doc) return;
  let items = 0;
  let hiddenItems = 0;
  let folders = 0;
  for (const s of doc.scenes) {
    for (const n of s.nodes) {
      if (n.kind === 'folder') folders++;
      else if (n.hidden) hiddenItems++;
      else items++;
    }
  }
  const types: Record<string, number> = {};
  for (const s of doc.sources) types[s.type] = (types[s.type] ?? 0) + 1;
  const sources = doc.sources.length;
  const unavailable = doc.sources.filter(s => s.status === 'unavailable').length;
  const failed = doc.sources.filter(s => s.status === 'failed').length;
  // C4: force every node to be re-emitted from live state and save
  doc.touchAll();
  const t0 = performance.now();
  const wrote = await c.services.collections.saver.flush();
  log(
    JSON.stringify({
      collectionsReport: {
        scenes: doc.scenes.length,
        sources,
        sourceTypes: types,
        items,
        hiddenItems,
        folders,
        unavailable,
        failed,
        schemaVersion: doc.schemaVersion,
        migrated: doc.needsMigration,
        blocked: c.ctx.saveBlocked,
        forcedSaveMs: Math.round(performance.now() - t0),
        wrote,
        display: await displayReport(c),
        perf: perf.stats(),
      },
    }),
  );
}

parentPort.on('message', e => {
  const msg = e.data as MainToCoreMessage;
  switch (msg.type) {
    case 'init': {
      status = { ...status, versions: { ...status.versions, app: msg.version } };
      app.obs = status;
      const c = (core = createCore({
        rt: runtime,
        backend: createObsBackend(),
        userData: msg.userData,
        appPath: msg.appPath,
        mainRpc,
        perf,
      }));
      try {
        c.openInitial(); // phase A: JSON only, before the first blocking OSN call
      } catch (err) {
        console.error('[core] could not open the collection', err);
      }
      // Initialize OBS off the message-handler stack so windows can connect meanwhile.
      setImmediate(async () => {
        const t0 = performance.now();
        let error: string | undefined;
        try {
          await c.initBackend({
            appDataPath: msg.userData,
            version: msg.version,
            installPath: msg.osnPath,
          });
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        perf.mark('obs.init');
        status = {
          ...status,
          obsInit: error ? 'error' : 'ok',
          code: error ? -1 : 0,
          initMs: Math.round(performance.now() - t0),
          error,
        };
        if (!testMode || error) broadcastStatus();
        if (error) return;
        void findObsPid().then(pid => pid > 0 && toMain({ type: 'obs-pid', pid }));
        try {
          await c.loadInitial();
          if (testMode) await collectionsReport(c);
        } catch (err) {
          console.error('[core] collection load failed', err);
          if (testMode) log(JSON.stringify({ collectionsReport: { error: String(err) } }));
        }
        if (testMode) broadcastStatus();
      });
      break;
    }
    case 'window-port': {
      const port = e.ports[0];
      if (port) addWindowPort(port, msg.windowId);
      break;
    }
    case 'rpc-result':
      mainRpc.handleResult(msg);
      break;
    case 'window-closed':
      core?.services.dialogs.windowClosed(msg.windowId);
      break;
    case 'protocol-link':
      break; // accepted, not used yet
    case 'shutdown': {
      void (async () => {
        try {
          await core?.shutdown();
          if (testMode && core) {
            log(
              JSON.stringify({
                collectionsShutdown: {
                  rereadChangedTypes: core.services.collections.saver.lastRereadChanged(),
                  perf: perf.stats(),
                },
              }),
            );
          }
          toMain({ type: 'shutdown-done', ok: true });
        } catch (err) {
          toMain({
            type: 'shutdown-done',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      break;
    }
  }
});
