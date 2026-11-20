import { describe, expect, it, vi } from 'vitest';
import type { Contract } from '@/shared/contracts/types';
import { createRuntime } from '@/core/runtime/runtime';
import { MessageChannel } from 'node:worker_threads';
import { coreTransport } from '../helpers';
import { createClient } from '@/ui/core/client';
import type { ServerMessage } from '@/shared/protocol';

interface C extends Contract {
  slices: { s: { n: number } };
  commands: {
    who: { me(): { connId: number; windowId: number } | null; late(): Promise<unknown> };
  };
  events: Record<never, never>;
}

function connect(rt: ReturnType<typeof createRuntime<C>>, windowId?: number) {
  const { port1, port2 } = new MessageChannel();
  const conn = rt.attach(coreTransport(port1), windowId === undefined ? undefined : { windowId });
  port1.unref();
  port2.unref();
  const client = createClient<C>({
    post: m => port2.postMessage(m),
    onMessage: cb => port2.on('message', (m: ServerMessage) => cb(m)),
    close: () => port2.close(),
  });
  return { client, conn, port2 };
}

describe('runtime additions for M1', () => {
  it('caller() identifies the connection and window, only synchronously', async () => {
    const rt = createRuntime<C>();
    let afterAwait: unknown = 'unset';
    rt.registerCommands('who', {
      me: () => rt.caller(),
      async late() {
        await Promise.resolve();
        afterAwait = rt.caller();
        return afterAwait;
      },
    });
    const a = connect(rt, 11);
    const b = connect(rt, 22);
    const ra = await a.client.call.who.me();
    const rb = await b.client.call.who.me();
    expect(ra).toEqual({ connId: a.conn.connId, windowId: 11 });
    expect(rb).toEqual({ connId: b.conn.connId, windowId: 22 });
    expect(ra!.connId).not.toBe(rb!.connId);
    expect(await a.client.call.who.late()).toBeNull();
    expect(rt.caller()).toBeNull(); // outside a command
  });

  it('onDisconnect fires with the connection id, once, and can be disposed', async () => {
    const rt = createRuntime<C>();
    const seen: number[] = [];
    const off = rt.onDisconnect(id => seen.push(id));
    const a = connect(rt, 1);
    const b = connect(rt, 2);
    await a.client.ping();
    a.conn.close();
    a.conn.close();
    expect(seen).toEqual([a.conn.connId]);
    off();
    b.conn.close();
    expect(seen).toEqual([a.conn.connId]);
  });

  it('a throwing listener does not break the others', () => {
    const rt = createRuntime<C>();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const seen: number[] = [];
    rt.onDisconnect(() => {
      throw new Error('x');
    });
    rt.onDisconnect(id => seen.push(id));
    const a = connect(rt);
    a.conn.close();
    expect(seen).toHaveLength(1);
    spy.mockRestore();
  });

  it('meters onActiveChange fires on the edges only', async () => {
    const edges: boolean[] = [];
    const rt = createRuntime<C>({
      meters: { intervalMs: 5, sample: () => [1], onActiveChange: a => edges.push(a) },
    });
    const a = connect(rt);
    const b = connect(rt);
    const offA = a.client.meters(() => undefined);
    await new Promise(r => setTimeout(r, 20));
    expect(edges).toEqual([true]);
    const offB = b.client.meters(() => undefined);
    await new Promise(r => setTimeout(r, 20));
    expect(edges).toEqual([true]); // second window: no new edge
    offA();
    await new Promise(r => setTimeout(r, 20));
    expect(edges).toEqual([true]); // still one window
    offB();
    await new Promise(r => setTimeout(r, 20));
    expect(edges).toEqual([true, false]);
    expect(rt.stats().metersRunning).toBe(false);
  });

  it('meters turn off when the last window disconnects', async () => {
    const edges: boolean[] = [];
    const rt = createRuntime<C>({
      meters: { intervalMs: 5, sample: () => [1], onActiveChange: a => edges.push(a) },
    });
    const a = connect(rt);
    a.client.meters(() => undefined);
    await new Promise(r => setTimeout(r, 20));
    a.conn.close();
    expect(edges).toEqual([true, false]);
  });

  it('getSlice returns the tracked state while the slice exists', () => {
    const rt = createRuntime<C>();
    const s = rt.defineSlice('s', { n: 1 });
    expect(rt.getSlice('s')).toBe(s);
    expect(rt.getSlice('nope')).toBeUndefined();
  });
});
