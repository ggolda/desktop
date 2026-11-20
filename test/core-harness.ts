// A whole core (runtime + domain services) on the fake backend, with a throw-away userData dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import type { CoreContract } from '@/shared/contracts';
import type { ServerMessage } from '@/shared/protocol';
import { type Core, createCore } from '@/core/core';
import { createMainRpc } from '@/core/main-rpc';
import { type FakeBackend, createFakeBackend } from '@/core/media/fake';
import { createPerf } from '@/core/perf';
import { createRuntime } from '@/core/runtime/runtime';
import { createClient, type CoreClient } from '@/ui/core/client';
import { coreTransport } from './helpers';

export interface Harness {
  dir: string;
  collectionsDir: string;
  rt: ReturnType<typeof createRuntime<CoreContract>>;
  backend: FakeBackend;
  core: Core;
  rpcCalls: { method: string; args: unknown[] }[];
  /** Overrides of main RPC results by method (default: a native handle). */
  rpcResults: Record<string, (args: unknown[]) => unknown>;
  /** A window connection with its own windowId. */
  connect(windowId?: number): { client: CoreClient<CoreContract>; close(): void };
  read(name: string): string | null;
  cleanup(): void;
}

export const realTick = () => new Promise<void>(r => setImmediate(r));

export async function until(cond: () => boolean, what = 'condition', ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await realTick();
  }
}

export function createHarness(
  files: Record<string, string> = {},
  opts: { start?: boolean } = {},
): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slobs-core-test-'));
  const collectionsDir = path.join(dir, 'SceneCollections');
  fs.mkdirSync(collectionsDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(collectionsDir, name), text);
  }
  const rt = createRuntime<CoreContract>();
  const backend = createFakeBackend();
  const rpcCalls: Harness['rpcCalls'] = [];
  const rpcResults: Harness['rpcResults'] = {};
  const mainRpc = createMainRpc(msg => {
    if (msg.type !== 'rpc') return;
    rpcCalls.push({ method: msg.method, args: msg.args });
    queueMicrotask(() => {
      try {
        const custom = rpcResults[msg.method];
        mainRpc.handleResult({
          type: 'rpc-result',
          id: msg.id,
          ok: true,
          value: custom ? custom(msg.args) : new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]),
        });
      } catch (e) {
        const err = e as { message?: string; code?: string };
        mainRpc.handleResult({
          type: 'rpc-result',
          id: msg.id,
          ok: false,
          error: { message: err.message ?? String(e), code: err.code },
        });
      }
    });
  });
  const core = createCore({
    rt,
    backend,
    userData: dir,
    mainRpc,
    perf: createPerf({ log: () => undefined }),
  });
  const h: Harness = {
    dir,
    collectionsDir,
    rt,
    backend,
    core,
    rpcCalls,
    rpcResults,
    connect(windowId = 1) {
      const { port1, port2 } = new MessageChannel();
      rt.attach(coreTransport(port1), { windowId });
      port1.unref();
      port2.unref();
      const client = createClient<CoreContract>({
        post: m => port2.postMessage(m),
        onMessage: cb => port2.on('message', (m: ServerMessage) => cb(m)),
        close: () => port2.close(),
      });
      return { client, close: () => port2.close() };
    },
    read: name => {
      const p = path.join(collectionsDir, name);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  if (opts.start !== false) {
    core.openInitial();
  }
  return h;
}

/** Backend init + startup collection load. */
export async function start(h: Harness) {
  await h.core.initBackend({ appDataPath: h.dir, version: 'test', installPath: '' });
  await h.core.loadInitial();
}

/** Snapshot of a slice through a client. */
export async function sliceOf<K extends keyof CoreContract['slices'] & string>(
  client: CoreClient<CoreContract>,
  name: K,
): Promise<CoreContract['slices'][K]> {
  const handle = client.slice(name);
  const off = handle.subscribe(() => undefined);
  await until(() => handle.state !== undefined, `slice ${name}`);
  const state = JSON.parse(JSON.stringify(handle.state)) as CoreContract['slices'][K];
  off();
  return state;
}
