import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import type { ServerMessage } from '@/shared/protocol';
import { coreTransport } from '../helpers';
import { ID, buildV5, manifestOf, toText } from '../fixtures/synthetic';
import { type Harness, createHarness, realTick, sliceOf, start, until } from '../core-harness';

let h: Harness | undefined;

function rawConnection(h: Harness) {
  const { port1, port2 } = new MessageChannel();
  h.rt.attach(coreTransport(port1), { windowId: 9 });
  port1.unref();
  port2.unref();
  const messages: ServerMessage[] = [];
  port2.on('message', (m: ServerMessage) => messages.push(m));
  return { port: port2, messages };
}
afterEach(() => {
  h?.cleanup();
  h = undefined;
  vi.useRealTimers();
});

async function ready() {
  h = createHarness({
    'manifest.json': toText(manifestOf([{ id: 'c1' }, { id: 'c2', name: 'Two' }], 'c1')),
    'c1.json': toText(buildV5()),
    'c2.json': toText(buildV5({ withUnknown: false })),
  });
  await start(h);
  return h;
}

describe('scene items', () => {
  it('add, transform, remove: slices, backend and document stay in step', async () => {
    const h = await ready();
    const { client } = h.connect();
    const id = await client.call.sceneItems.add(ID.sceneB, ID.browser, { select: false });
    let items = await sliceOf(client, `sceneItems:${ID.sceneB}`);
    expect(items.nodes[0]).toMatchObject({ id, sourceId: ID.browser, kind: 'item' });
    await client.call.sceneItems.transform(ID.sceneB, [
      { id, transform: { position: { x: 40 }, scale: { x: 2, y: 2 } } },
    ]);
    items = await sliceOf(client, `sceneItems:${ID.sceneB}`);
    expect(items.nodes[0]).toMatchObject({
      transform: { position: { x: 40, y: 0 }, scale: { x: 2, y: 2 } },
    });
    await client.call.collections.save();
    const saved = JSON.parse(h.read('c1.json')!);
    const file = saved.scenes.items[1].sceneItems.items;
    expect(file.at(-1)).toMatchObject({ id, x: 40, scaleX: 2, display: 'horizontal' });
    await client.call.sceneItems.remove(ID.sceneB, [id]);
    items = await sliceOf(client, `sceneItems:${ID.sceneB}`);
    expect(items.nodes.map(n => n.id)).not.toContain(id);
    expect(h.backend.sceneSet.get(ID.sceneB)).toHaveLength(1);
  });

  it('removing the last item of a source removes the source (legacy), shared sources stay', async () => {
    const h = await ready();
    const { client } = h.connect();
    const spec = { type: 'color_source', name: 'Orphan', propertiesManager: 'default' } as const;
    const { sourceId, itemId } = await client.call.sceneItems.addNew(ID.sceneA, spec as never);
    const shared = await client.call.sceneItems.add(ID.sceneB, sourceId);
    await client.call.sceneItems.remove(ID.sceneA, [itemId]);
    let src = await sliceOf(client, 'sources');
    expect(src.sources[sourceId]).toBeDefined(); // still used by scene B
    await client.call.sceneItems.remove(ID.sceneB, [shared]);
    src = await sliceOf(client, 'sources');
    expect(src.sources[sourceId]).toBeUndefined();
  });

  it('a drag is a single leaf patch', async () => {
    const h = await ready();
    const { port, messages } = rawConnection(h);
    const idx = 1; // UI order: scene, image, folder, browser
    port.postMessage({ type: 'sub', sid: 1, slice: `sceneItems:${ID.sceneA}` });
    await until(() => messages.some(m => m.type === 'snapshot'), 'snapshot');
    port.postMessage({
      type: 'call',
      id: 1,
      target: 'sceneItems',
      method: 'transform',
      args: [ID.sceneA, [{ id: ID.itemImage, transform: { position: { x: 123 } } }]],
    });
    await until(() => messages.some(m => m.type === 'result'), 'result');
    const patches = messages.filter(
      (m): m is Extract<ServerMessage, { type: 'patch' }> => m.type === 'patch',
    );
    expect(patches.flatMap(p => p.ops)).toEqual([
      ['s', ['nodes', idx, 'transform', 'position', 'x'], 123],
    ]);
  });

  it('move reorders the backend (top-first) and respects folders', async () => {
    const h = await ready();
    const { client } = h.connect();
    await client.call.sceneItems.move(ID.sceneA, [ID.itemScene], { type: 'bottom' });
    const items = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    expect(items.nodes.map(n => n.id)).toEqual([
      ID.itemImage,
      ID.folder,
      ID.itemBrowser,
      ID.itemScene,
    ]);
    // backend keeps bottom-first: scene, browser, image
    expect(h.backend.sceneSet.get(ID.sceneA)!.map(i => i.sourceId)).toEqual([
      ID.sceneB,
      ID.browser,
      ID.image,
    ]);
    // a folder moves with its children
    await client.call.sceneItems.move(ID.sceneA, [ID.folder], { type: 'top' });
    const after = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    expect(after.nodes.map(n => n.id)).toEqual([
      ID.folder,
      ID.itemBrowser,
      ID.itemImage,
      ID.itemScene,
    ]);
    await expect(
      client.call.sceneItems.move(ID.sceneA, [ID.folder], { type: 'into', folderId: ID.folder }),
    ).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('folders: create with children, rename, remove with children', async () => {
    const h = await ready();
    const { client } = h.connect();
    const folderId = await client.call.sceneItems.createFolder(ID.sceneA, 'New', [ID.itemImage]);
    let items = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    expect(items.nodes.find(n => n.id === ID.itemImage)?.parentId).toBe(folderId);
    await client.call.sceneItems.renameFolder(ID.sceneA, folderId, 'Renamed');
    items = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    expect(items.nodes.find(n => n.id === folderId)).toMatchObject({ name: 'Renamed' });
    await client.call.sceneItems.remove(ID.sceneA, [folderId]);
    items = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    expect(items.nodes.map(n => n.id)).not.toContain(ID.itemImage);
    expect(h.backend.sceneSet.get(ID.sceneA)).toHaveLength(2);
  });

  it('refuses scene cycles and unknown ids with codes', async () => {
    const h = await ready();
    const { client } = h.connect();
    await expect(client.call.sceneItems.add(ID.sceneB, ID.sceneA)).rejects.toMatchObject({
      code: 'ECYCLE',
    });
    await expect(client.call.sceneItems.add('nope', ID.image)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(client.call.sceneItems.remove(ID.sceneA, ['x'])).resolves.toBeUndefined();
  });

  it('transform actions: flip, fit, rotate keep the visual position sane', async () => {
    const h = await ready();
    const { client } = h.connect();
    // image source is 1920x1080 in the fake backend, canvas 1920x1080
    await client.call.sceneItems.transformAction(ID.sceneA, [ID.itemImage], { type: 'fit' });
    let items = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    let it = items.nodes.find(n => n.id === ID.itemImage)!;
    if (it.kind !== 'item') throw new Error('item');
    expect(it.transform.scale).toEqual({ x: 1, y: 1 });
    await client.call.sceneItems.transformAction(ID.sceneA, [ID.itemImage], { type: 'flipX' });
    items = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    it = items.nodes.find(n => n.id === ID.itemImage)!;
    if (it.kind !== 'item') throw new Error('item');
    expect(it.transform.scale.x).toBe(-1);
    expect(it.transform.position.x).toBe(1920);
  });
});

describe('selection', () => {
  it('reaches the backend only when it changed', async () => {
    const h = await ready();
    const { client } = h.connect();
    const calls = () => h.backend.calls.filter(c => c.startsWith('scenes.setSelected')).length;
    const base = calls();
    await client.call.selection.set([ID.itemImage]);
    expect(calls()).toBe(base + 1);
    await client.call.selection.set([ID.itemImage]);
    expect(calls()).toBe(base + 1);
    await client.call.selection.add([ID.itemScene]);
    expect(calls()).toBe(base + 2);
    const sel = await sliceOf(client, 'selection');
    expect(sel.ids).toEqual([ID.itemScene, ID.itemImage]); // UI order
    // a folder selects its children's guides
    await client.call.selection.set([ID.folder]);
    expect(h.backend.selected.get(ID.sceneA)).toHaveLength(1);
    await client.call.selection.clear();
    expect(h.backend.selected.get(ID.sceneA)).toHaveLength(0);
    await expect(client.call.selection.set(['nope'])).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is cleared when the scene changes', async () => {
    const h = await ready();
    const { client } = h.connect();
    await client.call.selection.set([ID.itemImage]);
    await client.call.scenes.makeActive(ID.sceneB);
    const sel = await sliceOf(client, 'selection');
    expect(sel).toMatchObject({ sceneId: ID.sceneB, ids: [], lastId: null });
    expect(h.backend.selected.get(ID.sceneA)).toEqual([]);
  });
});

describe('scenes', () => {
  it('switching goes through the transitions and recomputes the mixer', async () => {
    const h = await ready();
    const { client } = h.connect();
    const events: unknown[] = [];
    client.on('scene.switched', e => events.push(e));
    await until(() => true);
    await client.call.scenes.makeActive(ID.sceneB);
    expect(h.backend.program.sceneId).toBe(ID.sceneB);
    expect(h.backend.program.transitionId).toBe(ID.transition);
    const audio = await sliceOf(client, 'audio');
    expect(audio.mixer.ids).toEqual([ID.desktop, ID.mic]);
    expect(audio.mixer.rev).toBeGreaterThan(0);
    await until(() => events.length === 1, 'event');
    expect(events[0]).toEqual({ fromId: ID.sceneA, toId: ID.sceneB });
  });

  it('create (with duplicate), rename, reorder, remove', async () => {
    const h = await ready();
    const { client } = h.connect();
    const id = await client.call.scenes.create('Copy', { duplicateFrom: ID.sceneA });
    let scenes = await sliceOf(client, 'scenes');
    expect(scenes.scenes.map(s => s.name)).toEqual(['Scene A', 'Scene B', 'Copy']);
    const items = await sliceOf(client, `sceneItems:${id}`);
    expect(items.nodes).toHaveLength(4);
    expect(items.nodes.map(n => n.id)).not.toContain(ID.itemImage); // new item ids
    expect(h.backend.sceneSet.get(id)).toHaveLength(3);
    await client.call.scenes.reorder([id, ID.sceneA, ID.sceneB]);
    scenes = await sliceOf(client, 'scenes');
    expect(scenes.scenes[0].id).toBe(id);
    await client.call.scenes.makeActive(id);
    await client.call.scenes.remove(id);
    scenes = await sliceOf(client, 'scenes');
    expect(scenes.scenes).toHaveLength(2);
    expect(scenes.activeSceneId).not.toBe(id);
    await expect(client.call.scenes.reorder([ID.sceneA])).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('removing a scene removes the items that nest it', async () => {
    const h = await ready();
    const { client } = h.connect();
    await client.call.scenes.remove(ID.sceneB);
    const items = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    expect(items.nodes.map(n => n.id)).not.toContain(ID.itemScene);
    await expect(client.call.scenes.remove(ID.sceneA)).rejects.toMatchObject({ code: 'EINVAL' });
  });
});

describe('sources', () => {
  it('create, rename, settings, suggestName, remove', async () => {
    const h = await ready();
    const { client } = h.connect();
    const id = await client.call.sources.create({ type: 'color_source', name: 'Red' });
    const sources = await sliceOf(client, 'sources');
    expect(sources.sources[id]).toMatchObject({ name: 'Red', status: 'ready' });
    expect(await client.call.sources.suggestName('Red')).toBe('Red (1)');
    await client.call.sources.rename(id, 'Blue');
    await client.call.sources.updateSettings(id, { color: 4278190335 });
    expect(await client.call.sources.getSettings(id)).toMatchObject({ color: 4278190335 });
    await client.call.collections.save();
    const saved = JSON.parse(h.read('c1.json')!);
    const node = saved.sources.items.find((s: { id: string }) => s.id === id);
    expect(node).toMatchObject({ name: 'Blue', type: 'color_source' });
    expect(node.settings).toMatchObject({ color: 4278190335 });
    expect(Object.keys(node).slice(0, 4)).toEqual(['hotkeys', 'id', 'name', 'type']);
    await client.call.sources.remove(id);
    expect((await sliceOf(client, 'sources')).sources[id]).toBeUndefined();
    await expect(client.call.sources.remove(id)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removing a source removes its items everywhere', async () => {
    const h = await ready();
    const { client } = h.connect();
    await client.call.sources.remove(ID.image);
    const a = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    const b = await sliceOf(client, `sceneItems:${ID.sceneB}`);
    expect(a.nodes.map(n => n.id)).not.toContain(ID.itemImage);
    expect(b.nodes).toHaveLength(0);
    await client.call.collections.save();
    const saved = JSON.parse(h.read('c1.json')!);
    // hidden/foreign items of other sources are untouched, the vertical item of the image is gone
    const ids = saved.scenes.items[0].sceneItems.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(ID.itemVertical);
    expect(ids).toContain(ID.itemUnknown);
  });

  it('a source the backend cannot create stays in the file and is marked failed', async () => {
    h = createHarness({
      'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
      'c1.json': toText(buildV5({ withUnknown: false })),
    });
    h.backend.failTypes.add('browser_source');
    await start(h);
    const { client } = h.connect();
    const col = await sliceOf(client, 'collections');
    expect(col.warnings).toContainEqual({
      code: 'sources-failed',
      count: 1,
      types: ['browser_source'],
    });
    expect((await sliceOf(client, 'sources')).sources[ID.browser]).toBeUndefined();
    await client.call.scenes.rename(ID.sceneB, 'x');
    await client.call.collections.save();
    const saved = JSON.parse(h.read('c1.json')!);
    expect(saved.sources.items.map((s: { id: string }) => s.id)).toContain(ID.browser);
    expect(saved.scenes.items[0].sceneItems.items.map((i: { id: string }) => i.id)).toContain(
      ID.itemBrowser,
    );
  });

  it('commands need a ready backend and no load in progress', async () => {
    h = createHarness({
      'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
      'c1.json': toText(buildV5()),
    });
    const { client } = h.connect();
    await expect(
      client.call.sources.create({ type: 'color_source', name: 'x' }),
    ).rejects.toMatchObject({
      code: 'ENOTREADY',
    });
  });
});

describe('audio', () => {
  it('muted, fader and settings update slice, backend and file', async () => {
    const h = await ready();
    const { client } = h.connect();
    await client.call.audio.setMuted(ID.mic, true);
    await client.call.audio.setFader(ID.mic, { deflection: 0.5 });
    await client.call.audio.setSettings(ID.mic, { monitoring: 'monitor-only', syncOffsetMs: 250 });
    const audio = await sliceOf(client, 'audio');
    expect(audio.sources[ID.mic]).toMatchObject({
      muted: true,
      deflection: 0.5,
      mul: 0.1, // IEC: deflection 0.5 = -20 dB
      monitoring: 'monitor-only',
      syncOffsetMs: 250,
    });
    await expect(client.call.audio.setFader(ID.mic, { db: 1, mul: 1 })).rejects.toMatchObject({
      code: 'EINVAL',
    });
    await client.call.collections.save();
    const node = JSON.parse(h.read('c1.json')!).sources.items[1];
    expect(node).toMatchObject({
      muted: true,
      volume: 0.1,
      monitoringType: 1,
      syncOffset: { sec: 0, nsec: 250_000_000 },
    });
    await client.call.audio.setSettings(ID.mic, { hidden: true });
    await client.call.audio.unhideAll();
    expect((await sliceOf(client, 'audio')).sources[ID.mic].hidden).toBe(false);
  });

  it('persisted volume 1 shows 0 dB at full deflection and round-trips through setDeflection', async () => {
    const h = await ready();
    const { client } = h.connect();
    const audio = await sliceOf(client, 'audio');
    expect(audio.sources[ID.desktop]).toMatchObject({ mul: 1, db: 0, deflection: 1 });
    expect(audio.sources[ID.mic]).toMatchObject({ mul: 1, db: 0, deflection: 1 });
    await client.call.audio.setFader(ID.mic, { deflection: 0.75 });
    const mid = (await sliceOf(client, 'audio')).sources[ID.mic];
    expect(mid.deflection).toBe(0.75);
    expect(mid.db).toBeCloseTo(-10, 5);
    await client.call.audio.setFader(ID.mic, { deflection: 1 });
    expect(await sliceOf(client, 'audio')).toMatchObject({
      sources: { [ID.mic]: { mul: 1, db: 0, deflection: 1 } },
    });
    await client.call.audio.setFader(ID.mic, { db: -20 });
    expect((await sliceOf(client, 'audio')).sources[ID.mic].deflection).toBe(0.5);
  });

  it('meters: volmeters only while on, merged peaks, 2 s grace, frame layout', async () => {
    const h = await ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const meters = h.core.services.audio.meters;
    const setCalls = () => h.backend.calls.filter(c => c.startsWith('audio.setMetersEnabled'));
    expect(setCalls()).toHaveLength(0);
    meters.onActiveChange(true);
    await realTick();
    expect(h.backend.meters.enabled).toBe(true);
    expect(h.backend.meters.ids).toEqual([ID.desktop, ID.mic, ID.browser]);
    // two backend callbacks between frames: peaks merge by max, magnitude is the latest
    h.backend.emitMeter([
      { id: ID.mic, peak: [-30, -31], magnitude: [-40, -41], inputPeak: [-20, -21] },
    ]);
    h.backend.emitMeter([
      { id: ID.mic, peak: [-10, -35], magnitude: [-42, -43], inputPeak: [-22, -23] },
    ]);
    let f = meters.sample();
    expect(f[0]).toBe(1);
    expect(f[1]).toBe(h.core.ctx.slices.audio.mixer.rev);
    expect(f[2]).toBe(3);
    // desktop: no data yet -> 0 channels; mic: 2 channels
    expect(Array.from(f.slice(3, 4))).toEqual([0]);
    expect(Array.from(f.slice(4, 5))).toEqual([2]);
    expect(Array.from(f.slice(5, 11))).toEqual([-10, -31, -42, -43, -22, -23]);
    // after a frame the accumulator is reset: no data -> 0 channels again
    f = meters.sample();
    expect(Array.from(f.slice(3, 6))).toEqual([0, 0, 0]);
    // muted wasapi input draws nothing
    h.core.ctx.doc!.source(ID.mic)!.muted = true;
    h.backend.emitMeter([{ id: ID.mic, peak: [-5], magnitude: [-5], inputPeak: [-5] }]);
    f = meters.sample();
    expect(Array.from(f.slice(4, 8))).toEqual([1, -65535, -65535, -65535]);
    // leaving: still on for 2 s, then the volmeters are destroyed
    meters.onActiveChange(false);
    await vi.advanceTimersByTimeAsync(1900);
    expect(h.backend.meters.enabled).toBe(true);
    meters.onActiveChange(true); // somebody came back: the timer is cancelled
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.backend.meters.enabled).toBe(true);
    meters.onActiveChange(false);
    await vi.advanceTimersByTimeAsync(2100);
    expect(h.backend.meters.enabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the mixer change re-syncs the volmeters while meters are on', async () => {
    const h = await ready();
    const { client } = h.connect();
    h.core.services.audio.meters.onActiveChange(true);
    await realTick();
    await client.call.scenes.makeActive(ID.sceneB);
    await realTick();
    expect(h.backend.meters.ids).toEqual([ID.desktop, ID.mic]);
  });
});

describe('collections', () => {
  it('switching saves the old one, releases its objects and loads the other', async () => {
    const h = await ready();
    const { client } = h.connect();
    await client.call.scenes.rename(ID.sceneA, 'Edited');
    const events: string[] = [];
    client.on('collection.willSwitch', e => events.push(`will ${e.fromId}>${e.toId}`));
    client.on('collection.loaded', e => events.push(`loaded ${e.id}`));
    await realTick();
    await client.call.collections.load('c2');
    expect(JSON.parse(h.read('c1.json')!).scenes.items[0].name).toBe('Edited');
    const col = await sliceOf(client, 'collections');
    expect(col).toMatchObject({ status: 'ready', activeId: 'c2' });
    expect(col.warnings).toEqual([]);
    expect(h.backend.sceneSet.size).toBe(2); // only c2's scenes remain
    expect(JSON.parse(h.read('manifest.json')!).activeId).toBe('c2');
    await until(() => events.length === 2, 'events');
    expect(events).toEqual(['will c1>c2', 'loaded c2']);
    await expect(client.call.collections.load('nope')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('create, duplicate, rename, remove (soft)', async () => {
    const h = await ready();
    const { client } = h.connect();
    const created = await client.call.collections.create({ name: 'Fresh' });
    expect(created.name).toBe('Fresh');
    let col = await sliceOf(client, 'collections');
    expect(col.activeId).toBe(created.id);
    expect(col.collections[0].id).toBe(created.id); // new entries go first, as in the legacy manifest
    const copy = await client.call.collections.duplicate('c2', 'Copy of two');
    await client.call.collections.rename(copy, 'Renamed copy');
    col = await sliceOf(client, 'collections');
    expect(col.collections.find(c => c.id === copy)?.name).toBe('Renamed copy');
    expect(h.read(`${copy}.json`)).toBe(h.read('c2.json'));
    await client.call.collections.remove(copy);
    col = await sliceOf(client, 'collections');
    expect(col.collections.find(c => c.id === copy)).toBeUndefined();
    expect(h.read(`${copy}.json`)).not.toBeNull(); // files stay on disk
    const manifest = JSON.parse(h.read('manifest.json')!);
    expect(manifest.collections.find((c: { id: string }) => c.id === copy).deleted).toBe(true);
    // removing the active one moves on to another
    await client.call.collections.remove(created.id);
    col = await sliceOf(client, 'collections');
    expect(col.activeId).not.toBe(created.id);
    expect(col.status).toBe('ready');
  });

  it('shutdown order: meters, displays, save, release, backend', async () => {
    const h = await ready();
    const { client } = h.connect();
    await client.call.scenes.rename(ID.sceneA, 'Last');
    await h.core.shutdown();
    expect(JSON.parse(h.read('c1.json')!).scenes.items[0].name).toBe('Last');
    const calls = h.backend.calls;
    expect(calls.at(-1)).toBe('shutdown');
    expect(calls.indexOf('shutdown')).toBeGreaterThan(
      calls.lastIndexOf(`scenes.remove:${ID.sceneA}`),
    );
  });

  it('shutdown re-reads every source and saves the ones that changed on their own', async () => {
    const h = await ready();
    // a source rewrote its own settings (nobody sent a command)
    h.backend.sourceSet.get(ID.image)!.settings.file = 'C:/other.png';
    await h.core.shutdown();
    const saved = JSON.parse(h.read('c1.json')!);
    expect(saved.sources.items[2].settings.file).toBe('C:/other.png');
    expect(h.core.services.collections.saver.lastRereadChanged()).toEqual(['image_source']);
  });
});
