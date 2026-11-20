import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, reactive, shallowRef, watchEffect } from 'vue';
import type { Contract } from '@/shared/contracts/types';
import { applyOps } from '@/shared/patch';
import type { PatchOp, ServerMessage } from '@/shared/protocol';
import type { CoreClient } from '@/ui/core/client';
import { createCoreComposables } from '@/ui/core/composables';
import { connectClient, runtimeOf, tick, wire } from './helpers';

interface Row {
  id: number;
  name: string;
}
interface S {
  n: number;
  list: Row[];
  deep: { a: { b: number[] } };
  extra?: Record<string, number>;
}
interface TC extends Contract {
  slices: { s: S; [k: `note:${string}`]: { text: string } };
  commands: {
    math: { add(a: number, b: number): number; boom(): void; slow(): number; throwString(): void };
  };
  events: { ping: { n: number } };
}
type Patch = Extract<ServerMessage, { type: 'patch' }>;

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function setup() {
  const rt = runtimeOf<TC>({ meters: { intervalMs: 5, sample: () => [1, 2] } });
  const s = rt.defineSlice('s', { n: 0, list: [], deep: { a: { b: [1, 2, 3] } } });
  rt.registerCommands('math', {
    add: (a, b) => a + b,
    boom() {
      throw Object.assign(new Error('kaboom'), { code: 'EBOOM' });
    },
    slow: async () => {
      await tick();
      return 7;
    },
    throwString() {
      throw 'plain';
    },
  });
  return { rt, s };
}

describe('commands', () => {
  it('ok, async, error with code, unknown target/method, non-Error throw', async () => {
    const { rt } = setup();
    const { client } = connectClient(rt);
    expect(await client.call.math.add(2, 3)).toBe(5);
    expect(await client.call.math.slow()).toBe(7);
    await expect(client.call.math.boom()).rejects.toMatchObject({
      message: 'kaboom',
      code: 'EBOOM',
    });
    await expect(client.call.math.throwString()).rejects.toMatchObject({ message: 'plain' });
    const raw = client.call as unknown as Record<string, Record<string, () => Promise<unknown>>>;
    await expect(raw.nope.x()).rejects.toMatchObject({ code: 'ENOTARGET' });
    await expect(raw.math.missing()).rejects.toMatchObject({ code: 'ENOMETHOD' });
    await expect(raw.math.toString()).rejects.toMatchObject({ code: 'ENOMETHOD' });
    expect(await client.call.math.add(1, 1)).toBe(2); // core is still alive
  });

  it('ping/pong still works', async () => {
    const { rt } = setup();
    const { client } = connectClient(rt);
    expect(await client.ping()).toBeGreaterThanOrEqual(0);
  });
});

describe('slices', () => {
  it('snapshot then patches: nested set, push/splice/shift, delete, length', async () => {
    const { rt, s } = setup();
    const { client } = connectClient(rt);
    const seen: S[] = [];
    client.subscribe('s', st => seen.push(plain(st)));
    await client.ping();
    expect(seen[0]).toEqual({ n: 0, list: [], deep: { a: { b: [1, 2, 3] } } });

    s.n = 5;
    s.deep.a.b.push(4, 5);
    s.deep.a.b[0] = 10;
    s.list.push({ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' });
    await client.ping();
    expect(seen.at(-1)).toEqual(plain(s));

    s.list.splice(1, 1);
    s.list[0].name = 'A';
    s.list.shift();
    s.list.unshift({ id: 9, name: 'z' });
    s.extra = { x: 1 };
    s.extra.y = 2;
    delete s.extra.x;
    s.deep.a.b.length = 1;
    await client.ping();
    expect(seen.at(-1)).toEqual(plain(s));
    expect(seen.at(-1)!.extra).toEqual({ y: 2 });
    expect(seen.at(-1)!.deep.a.b).toEqual([10]);
  });

  it('fuzz: client mirror always equals core state', async () => {
    const { rt, s } = setup();
    const { client } = connectClient(rt);
    let mirror: S | undefined;
    client.subscribe('s', st => (mirror = st));
    await client.ping();
    let seed = 42;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let round = 0; round < 40; round++) {
      for (let i = 0; i < 25; i++) {
        switch (rnd(9)) {
          case 0:
            s.list.push({ id: rnd(1000), name: 'p' + i });
            break;
          case 1:
            s.list.splice(rnd(s.list.length + 1), rnd(3), { id: i, name: 'sp' });
            break;
          case 2:
            s.list.shift();
            break;
          case 3:
            s.list.pop();
            break;
          case 4:
            if (s.list.length) s.list[rnd(s.list.length)].name = 'r' + i;
            break;
          case 5:
            s.list.unshift({ id: -i - 1, name: 'u' });
            break;
          case 6:
            s.list.sort((a, b) => a.id - b.id);
            break;
          case 7:
            s.deep.a.b = [rnd(5), rnd(5)];
            s.deep.a.b.push(i);
            break;
          case 8:
            s.n = rnd(3);
            if (s.list.length > 30) s.list.length = 10;
            break;
        }
      }
      await client.ping();
      expect(mirror).toEqual(plain(s));
    }
  });

  it('stale references after array shifts still produce the right path', async () => {
    const { rt, s } = setup();
    const { client } = connectClient(rt);
    let mirror: S | undefined;
    client.subscribe('s', st => (mirror = st));
    s.list.push({ id: 1, name: 'a' }, { id: 2, name: 'b' });
    await client.ping();
    const second = s.list[1];
    s.list.shift();
    second.name = 'B';
    await client.ping();
    expect(mirror!.list).toEqual([{ id: 2, name: 'B' }]);
    const removed = s.list[0];
    s.list.shift();
    removed.name = 'ghost'; // detached: must not produce an op
    await client.ping();
    expect(mirror!.list).toEqual([]);
  });

  it('batches N mutations of one tick into one patch message', async () => {
    const { rt, s } = setup();
    const { wire: w } = wire(rt);
    w.window.postMessage({ type: 'sub', sid: 1, slice: 's' });
    await tick();
    const before = w.fromCore.length;
    for (let i = 0; i < 100; i++) s.list.push({ id: i, name: 'x' });
    for (let i = 0; i < 100; i++) s.n++;
    await tick();
    const patches = w.fromCore.slice(before).filter(m => m.type === 'patch') as Patch[];
    expect(patches).toHaveLength(1);
    expect(patches[0].rev).toBe(1);
    expect(patches[0].ops).toHaveLength(101); // 100 pushes + the counter coalesced into one op
    s.n++;
    await tick();
    expect((w.fromCore.filter(m => m.type === 'patch') as Patch[]).at(-1)!.rev).toBe(2);
  });

  it('sends nothing when nothing changes or nobody listens', async () => {
    const { rt, s } = setup();
    const { wire: w } = wire(rt);
    s.n = 3; // nobody subscribed: no ops recorded
    w.window.postMessage({ type: 'sub', sid: 1, slice: 's' });
    await tick();
    expect(w.fromCore).toHaveLength(1);
    expect(w.fromCore[0]).toMatchObject({ type: 'snapshot', rev: 0, value: { n: 3 } });
    s.n = 3; // same value
    s.deep.a.b[0] = 1; // same value
    await tick();
    expect(w.fromCore).toHaveLength(1);
  });

  it('patches go only to ports subscribed to that slice', async () => {
    const { rt, s } = setup();
    const a = wire(rt);
    const b = wire(rt);
    a.wire.window.postMessage({ type: 'sub', sid: 1, slice: 's' });
    await tick();
    s.n = 1;
    await tick();
    expect(a.wire.fromCore.map(m => m.type)).toEqual(['snapshot', 'patch']);
    expect(b.wire.fromCore).toEqual([]);
  });

  it('a gap in rev triggers a resubscribe with a fresh snapshot', async () => {
    const { rt, s } = setup();
    let dropped = false;
    const { client } = connectClient(rt, {
      tap: m => {
        if (m.type === 'patch' && !dropped) {
          dropped = true; // lose the first patch
          return false;
        }
        return true;
      },
    });
    let mirror: S | undefined;
    client.subscribe('s', st => (mirror = st));
    await client.ping();
    s.n = 1; // patch rev 1 is lost
    await client.ping();
    s.n = 2; // patch rev 2 -> gap detected
    await client.ping();
    await client.ping();
    expect(client.stats().resubscribes).toBe(1);
    expect(mirror!.n).toBe(2);
    s.n = 3;
    await client.ping();
    expect(mirror!.n).toBe(3);
  });

  it('unknown slice reports sub-error; closing the port drops all subscriptions', async () => {
    const { rt } = setup();
    rt.defineSliceFactory('note', { create: () => ({ text: '' }) });
    const { wire: w, corePort } = wire(rt);
    w.window.postMessage({ type: 'sub', sid: 1, slice: 'nope' });
    w.window.postMessage({ type: 'sub', sid: 2, slice: 's' });
    w.window.postMessage({ type: 'sub', sid: 3, slice: 'note:a' });
    w.window.postMessage({ type: 'on', event: 'ping' });
    w.window.postMessage({ type: 'meters-on' });
    await tick();
    expect(w.fromCore.find(m => m.type === 'sub-error')).toMatchObject({ sid: 1 });
    expect(rt.stats()).toMatchObject({ subscribers: 2, busForwarders: 1, metersRunning: true });
    w.window.close();
    await tick();
    corePort.close();
    expect(rt.stats()).toEqual({
      connections: 0,
      slices: 1, // note:a was disposed with its last subscriber
      subscribers: 0,
      metersRunning: false,
      busForwarders: 0,
    });
  });

  it('lazy slice factory: created on first sub, shared, disposed on last unsub', async () => {
    const { rt } = setup();
    const created: string[] = [];
    const disposed: string[] = [];
    rt.defineSliceFactory('note', {
      create: key => {
        created.push(key);
        return { text: 'hi ' + key };
      },
      dispose: key => void disposed.push(key),
    });
    const a = connectClient(rt);
    const b = connectClient(rt);
    expect(created).toEqual([]);
    let va: { text: string } | undefined;
    const unA = a.client.subscribe('note:x', st => (va = st));
    const unB = b.client.subscribe('note:x', () => {});
    await a.client.ping();
    await b.client.ping();
    expect(created).toEqual(['x']);
    expect(va).toEqual({ text: 'hi x' });
    unA();
    await a.client.ping();
    expect(disposed).toEqual([]);
    unB();
    await b.client.ping();
    expect(disposed).toEqual(['x']);
    expect(rt.stats().slices).toBe(1);
    b.client.subscribe('note:x', () => {}); // resubscribing recreates it
    await b.client.ping();
    expect(created).toEqual(['x', 'x']);
  });
});

describe('events and meters', () => {
  it('forwards only events a window subscribed to; off stops forwarding', async () => {
    const { rt } = setup();
    const a = connectClient(rt);
    const got: number[] = [];
    const off = a.client.on('ping', p => got.push(p.n));
    await a.client.ping();
    expect(rt.stats().busForwarders).toBe(1);
    rt.bus.emit('ping', { n: 1 });
    await tick();
    expect(got).toEqual([1]);
    off();
    await a.client.ping();
    expect(rt.stats().busForwarders).toBe(0);
    rt.bus.emit('ping', { n: 2 });
    await tick();
    expect(got).toEqual([1]);
  });

  it('bus.on returns a disposer', () => {
    const { rt } = setup();
    const got: number[] = [];
    const off = rt.bus.on('ping', p => got.push(p.n));
    rt.bus.emit('ping', { n: 1 });
    off();
    rt.bus.emit('ping', { n: 2 });
    expect(got).toEqual([1]);
  });

  it('meters sampler runs only while subscribed', async () => {
    const { rt } = setup();
    const { client } = connectClient(rt);
    expect(rt.stats().metersRunning).toBe(false);
    const frames: unknown[] = [];
    const off = client.meters(d => frames.push(d));
    await client.ping();
    expect(rt.stats().metersRunning).toBe(true);
    await tick();
    await tick();
    expect(frames.length).toBeGreaterThan(0);
    off();
    await client.ping();
    expect(rt.stats().metersRunning).toBe(false);
    const n = frames.length;
    await tick();
    expect(frames.length).toBe(n);
  });
});

describe('useSlice (vue)', () => {
  it('ref-counts one subscription across scopes, applies patches reactively', async () => {
    const { rt, s } = setup();
    const { client, sent } = connectClient(rt, { makeState: reactive });
    const { useSlice } = createCoreComposables<TC>(shallowRef<CoreClient<TC> | undefined>(client));
    const count = (t: string) => sent.filter(m => m.type === t).length;

    const sc1 = effectScope();
    const sc2 = effectScope();
    const v1 = sc1.run(() => useSlice('s'))!;
    const v2 = sc2.run(() => useSlice('s'))!;
    expect(count('sub')).toBe(1);
    await client.ping();
    expect(v1.value?.n).toBe(0);
    expect(v2.value).toBe(v1.value);

    s.list.push({ id: 1, name: 'a' });
    await client.ping();
    expect(v2.value?.list).toEqual([{ id: 1, name: 'a' }]);

    sc1.stop();
    expect(count('unsub')).toBe(0);
    expect(v1.value).toBeUndefined();
    sc2.stop();
    expect(count('unsub')).toBe(1);

    s.n = 99; // nobody listens any more
    await client.ping();
    expect(rt.stats().subscribers).toBe(0);
    const sc3 = effectScope();
    const v3 = sc3.run(() => useSlice('s'))!;
    await client.ping();
    expect(v3.value?.n).toBe(99);
    sc3.stop();
  });

  it('subscribes once the client becomes available', async () => {
    const { rt } = setup();
    const { client } = connectClient(rt, { makeState: reactive });
    const clientRef = shallowRef<CoreClient<TC> | undefined>();
    const { useSlice } = createCoreComposables<TC>(clientRef);
    const sc = effectScope();
    const v = sc.run(() => useSlice('s'))!;
    expect(v.value).toBeUndefined();
    clientRef.value = client;
    await client.ping();
    expect(v.value?.n).toBe(0);
    sc.stop();
  });

  it('fine-grained: a rename does not re-run readers of other fields', async () => {
    const { rt, s } = setup();
    const { client } = connectClient(rt, { makeState: reactive });
    const { useSlice } = createCoreComposables<TC>(shallowRef<CoreClient<TC> | undefined>(client));
    const sc = effectScope();
    const v = sc.run(() => useSlice('s'))!;
    s.list.push({ id: 1, name: 'a' });
    await client.ping();
    let runs = 0;
    let lastN = -1;
    sc.run(() =>
      watchEffect(() => {
        runs++;
        lastN = v.value!.n;
      }),
    );
    await nextTick();
    const base = runs;
    s.list[0].name = 'b';
    await client.ping();
    await nextTick();
    expect(runs).toBe(base);
    s.n = 4;
    await client.ping();
    await nextTick();
    expect(lastN).toBe(4);
    sc.stop();
  });
});

describe('performance', () => {
  it('10 000 mutations in one tick -> one patch message', async () => {
    const { rt, s } = setup();
    const { wire: w } = wire(rt);
    w.window.postMessage({ type: 'sub', sid: 1, slice: 's' });
    await tick();
    w.fromCore.length = 0;

    let t = performance.now();
    for (let i = 0; i < 10_000; i++) s.n++;
    const tCounter = performance.now() - t;
    await tick();
    let patches = w.fromCore.filter(m => m.type === 'patch') as Patch[];
    expect(patches).toHaveLength(1);
    expect(patches[0].ops).toHaveLength(1); // coalesced
    const counterBytes = JSON.stringify(patches[0]).length;

    w.fromCore.length = 0;
    t = performance.now();
    for (let i = 0; i < 10_000; i++) s.list.push({ id: i, name: 'n' + i });
    const tPush = performance.now() - t;
    await tick();
    patches = w.fromCore.filter(m => m.type === 'patch') as Patch[];
    expect(patches).toHaveLength(1);
    expect(patches[0].ops).toHaveLength(10_000);
    const pushBytes = JSON.stringify(patches[0]).length;
    console.log(
      `[perf] 10k counter++: ${tCounter.toFixed(1)} ms, 1 patch, 1 op, ${counterBytes} B | ` +
        `10k pushes: ${tPush.toFixed(1)} ms, 1 patch, ${pushBytes} B`,
    );
  });

  it('renaming one item of a 60-item array sends a tiny patch, not the array', async () => {
    const { rt, s } = setup();
    for (let i = 0; i < 60; i++) s.list.push({ id: i, name: 'item number ' + i });
    const { wire: w } = wire(rt);
    w.window.postMessage({ type: 'sub', sid: 1, slice: 's' });
    await tick();
    const snap = w.fromCore.find(m => m.type === 'snapshot')!;
    w.fromCore.length = 0;
    s.list[17].name = 'renamed';
    await tick();
    const patch = w.fromCore[0] as Patch;
    const patchBytes = JSON.stringify(patch).length;
    const arrayBytes = JSON.stringify(s.list).length;
    expect(patch.ops).toEqual([['s', ['list', 17, 'name'], 'renamed']]);
    expect(patchBytes).toBeLessThan(arrayBytes / 20);
    console.log(
      `[perf] 60-item rename: patch ${patchBytes} B vs array ${arrayBytes} B vs snapshot ${JSON.stringify(snap).length} B`,
    );
  });

  it('applyOps standalone', () => {
    const doc = { a: [1, 2, 3], o: { k: 1 } as Record<string, number> };
    const ops: PatchOp[] = [
      ['x', ['a'], 1, 1, [9, 8]],
      ['s', ['o', 'z'], 5],
      ['d', ['o', 'k']],
      ['l', ['a'], 3],
    ];
    applyOps(doc, ops);
    expect(doc).toEqual({ a: [1, 9, 8], o: { z: 5 } });
  });
});
