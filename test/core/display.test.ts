import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayView } from '@/shared/contracts';
import { ID, buildV5, manifestOf, toText } from '../fixtures/synthetic';
import { type Harness, createHarness, realTick, sliceOf, start, until } from '../core-harness';

let h: Harness | undefined;
afterEach(() => {
  h?.cleanup();
  h = undefined;
  vi.useRealTimers();
});

const view = (over: Partial<DisplayView> = {}, w = 640, hgt = 360): DisplayView => ({
  rect: { x: 10, y: 20, width: w, height: hgt },
  dpr: 1.5,
  visible: true,
  ...over,
});

async function ready() {
  h = createHarness({
    'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
    'c1.json': toText(buildV5()),
  });
  await start(h);
  return h;
}

describe('display', () => {
  it('creates after the backend is ready, sized in device pixels, owned by the caller window', async () => {
    h = createHarness({
      'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
      'c1.json': toText(buildV5()),
    });
    const { client } = h.connect(7);
    // the window asks before the backend exists: it is queued
    await client.call.display.create('d1', { drawUi: true }, view());
    await realTick();
    expect(h.backend.calls.some(c => c.startsWith('displays.create'))).toBe(false);
    expect((await sliceOf(client, 'display:d1')).status).toBe('pending');
    await start(h);
    await until(() => h!.backend.displaySet.has('d1'), 'display created');
    await until(() => h!.backend.displaySet.get('d1')!.w === 960, 'sized');
    expect(h.backend.displaySet.get('d1')).toEqual({ x: 15, y: 30, w: 960, h: 540 });
    expect(h.rpcCalls).toEqual([{ method: 'window.nativeHandle', args: [7] }]);
    const st = await sliceOf(client, 'display:d1');
    expect(st.status).toBe('ready');
    // fake backend reports the region it was sized to: device px / dpr
    expect(st.outputRegion).toEqual({ x: 0, y: 0, width: 640, height: 360 });
  });

  it('coalesces bursts of views and skips unchanged ones', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    await client.call.display.create('d1', {}, view());
    await until(() => h.backend.displaySet.get('d1')?.w === 960, 'ready');
    const moves = () => h.backend.calls.filter(c => c.startsWith('displays.moveResize')).length;
    const base = moves();
    for (let i = 1; i <= 20; i++) void client.call.display.update('d1', view({}, 640 + i, 360));
    await until(() => h.backend.displaySet.get('d1')!.w === Math.round(660 * 1.5), 'burst applied');
    await realTick();
    expect(moves() - base).toBeLessThanOrEqual(20); // never more than one per message
    const after = moves();
    await client.call.display.update('d1', view({}, 660, 360));
    await realTick();
    await realTick();
    expect(moves()).toBe(after); // same view: nothing
  });

  it('hidden: sized to 0x0, destroyed after 10 s, recreated when visible again', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    await client.call.display.create('d1', {}, view());
    await until(() => h.backend.displaySet.get('d1')?.w === 960, 'ready');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await client.call.display.update('d1', view({ visible: false }));
    await until(() => h.backend.displaySet.get('d1')?.w === 0, 'zero size');
    expect((await sliceOf(client, 'display:d1')).status).toBe('hidden');
    await vi.advanceTimersByTimeAsync(9900);
    expect(h.backend.displaySet.has('d1')).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    await until(() => !h.backend.displaySet.has('d1'), 'destroyed');
    expect((await sliceOf(client, 'display:d1')).status).toBe('absent');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await client.call.display.update('d1', view());
    await until(() => h.backend.displaySet.get('d1')?.w === 960, 'recreated');
    expect((await sliceOf(client, 'display:d1')).status).toBe('ready');
  });

  it('a window coming back visible before 10 s keeps the display', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    await client.call.display.create('d1', {}, view());
    await until(() => h.backend.displaySet.get('d1')?.w === 960, 'ready');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await client.call.display.update('d1', view({ visible: false }));
    await until(() => h.backend.displaySet.get('d1')?.w === 0, 'zero size');
    await client.call.display.update('d1', view());
    await until(() => h.backend.displaySet.get('d1')?.w === 960, 'visible again');
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.backend.displaySet.has('d1')).toBe(true);
    expect(h.backend.calls.filter(c => c.startsWith('displays.create'))).toHaveLength(1);
  });

  it('destroys the displays of a window when it disconnects, and on shutdown', async () => {
    const h = await ready();
    const a = h.connect(1);
    const b = h.connect(2);
    await a.client.call.display.create('da', {}, view());
    await b.client.call.display.create('db', {}, view());
    await until(() => h.backend.displaySet.size === 2, 'both');
    a.close();
    await until(() => !h.backend.displaySet.has('da'), 'da destroyed');
    expect(h.backend.displaySet.has('db')).toBe(true);
    await h.core.shutdown();
    expect(h.backend.displaySet.size).toBe(0);
    expect(h.backend.calls.indexOf('displays.destroy:db')).toBeLessThan(
      h.backend.calls.indexOf('shutdown'),
    );
  });

  it('explicit destroy, duplicate ids, unsupported canvases, options', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    await client.call.display.create('d1', {}, view());
    await expect(client.call.display.create('d1', {}, view())).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await expect(
      client.call.display.create('d2', { canvas: 'vertical' }, view()),
    ).rejects.toMatchObject({ code: 'EUNSUPPORTED' });
    await until(() => h.backend.displaySet.get('d1')?.w === 960, 'ready');
    await client.call.display.setOptions('d1', { drawUi: false, guidelines: true });
    await client.call.display.destroy('d1');
    expect(h.backend.displaySet.has('d1')).toBe(false);
    await client.call.display.destroy('d1'); // idempotent
    void ID;
  });
});

describe('display lifecycle edge cases', () => {
  it('a display still waiting for the backend does not block shutdown', async () => {
    h = createHarness({
      'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
      'c1.json': toText(buildV5()),
    });
    const { client } = h.connect(3);
    await client.call.display.create('d1', {}, view());
    await realTick();
    // the backend never became ready (init failed): shutdown must still finish
    await Promise.race([
      h.core.shutdown(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('shutdown hung')), 2000)),
    ]);
    expect(h.backend.displaySet.size).toBe(0);
  });
});
