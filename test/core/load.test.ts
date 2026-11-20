import { afterEach, describe, expect, it } from 'vitest';
import { ID, buildV2, buildV5, manifestOf, toText } from '../fixtures/synthetic';
import { type Harness, createHarness, sliceOf, start } from '../core-harness';

let h: Harness | undefined;
afterEach(() => {
  h?.cleanup();
  h = undefined;
});

const files = (v5 = buildV5()) => ({
  'manifest.json': toText(manifestOf([{ id: 'c1', name: 'One' }], 'c1')),
  'c1.json': toText(v5),
});

describe('two-phase load', () => {
  it('fills the lists from the document before the backend exists', async () => {
    h = createHarness(files());
    const { client } = h.connect();
    // no backend.init yet
    const scenes = await sliceOf(client, 'scenes');
    expect(scenes.scenes.map(s => s.name)).toEqual(['Scene A', 'Scene B']);
    expect(scenes.activeSceneId).toBe(ID.sceneA);
    const col = await sliceOf(client, 'collections');
    expect(col.status).toBe('loading');
    expect(col.activeId).toBe('c1');
    expect(h.backend.calls).not.toContain('init');
    const items = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    // UI order is the reverse of the file; vertical and unavailable items are hidden
    expect(items.nodes.map(n => n.id)).toEqual([
      ID.itemScene,
      ID.itemImage,
      ID.folder,
      ID.itemBrowser,
    ]);
    const folderChild = items.nodes.find(n => n.id === ID.itemBrowser);
    expect(folderChild?.parentId).toBe(ID.folder);
  });

  it('creates backend objects in bulk and ends ready', async () => {
    h = createHarness(files());
    await start(h);
    const { client } = h.connect();
    const col = await sliceOf(client, 'collections');
    expect(col.status).toBe('ready');
    expect(col.warnings).toEqual([
      { code: 'unavailable-sources', count: 1, types: ['foo_source'] },
    ]);
    const calls = h.backend.calls;
    expect(calls.filter(c => c.startsWith('sources.createMany'))).toEqual(['sources.createMany:4']);
    expect(calls.filter(c => c.startsWith('scenes.addItems'))).toEqual([
      `scenes.addItems:${ID.sceneA}:3`,
      `scenes.addItems:${ID.sceneB}:1`,
    ]);
    expect(calls).toContain(`canvases.setBaseResolution:horizontal`);
    expect(calls).toContain(`transitions.switchScene:${ID.sceneA}`);
    // items were added bottom-first (file order), hidden ones were not created
    const sceneA = h.backend.sceneSet.get(ID.sceneA)!;
    expect(sceneA.map(i => i.sourceId)).toEqual([ID.browser, ID.image, ID.sceneB]);
    const sources = await sliceOf(client, 'sources');
    expect(Object.keys(sources.sources).sort()).toEqual(
      [ID.desktop, ID.mic, ID.image, ID.browser, ID.sceneA, ID.sceneB].sort(),
    );
    expect(sources.sources[ID.unknown]).toBeUndefined();
    expect(sources.sources[ID.desktop].channel).toBe(1);
    const canvases = await sliceOf(client, 'canvases');
    expect(canvases.horizontal?.baseWidth).toBe(1920);
    const audio = await sliceOf(client, 'audio');
    expect(audio.mixer.ids).toEqual([ID.desktop, ID.mic, ID.browser]); // globals, then scene audio
    expect(Object.keys(audio.sources).sort()).toEqual([ID.browser, ID.desktop, ID.mic].sort());
  });

  it('opening a clean collection writes nothing but the .bak', async () => {
    h = createHarness(files());
    const before = h.read('c1.json');
    await start(h);
    await h.core.shutdown();
    expect(h.read('c1.json')).toBe(before);
    expect(h.read('c1.json.bak')).toBe(before);
  });

  it('a schema 2 collection is migrated: .absolute.bak first, then saved as v5', async () => {
    const v2 = toText(buildV2());
    h = createHarness({
      'manifest.json': toText(manifestOf([{ id: 'old' }], 'old')),
      'old.json': v2,
    });
    await start(h);
    expect(h.read('old.json.absolute.bak')).toBe(v2);
    const saved = JSON.parse(h.read('old.json')!);
    expect(saved.schemaVersion).toBe(5);
    expect(saved.relativeCoordinates).toBe(true);
    expect(saved.baseResolutions.horizontal).toEqual({ baseWidth: 1280, baseHeight: 720 });
    const item = saved.scenes.items[0].sceneItems.items[0];
    expect(Object.keys(item)).toEqual([
      'hotkeys',
      'id',
      'sourceId',
      'x',
      'y',
      'scaleX',
      'scaleY',
      'visible',
      'crop',
      'locked',
      'rotation',
      'streamVisible',
      'recordingVisible',
      'scaleFilter',
      'blendingMode',
      'blendingMethod',
      'sceneNodeType',
      'display',
    ]);
    expect(item.display).toBe('horizontal');
    // .bak keeps the text that loaded
    expect(h.read('old.json.bak')).toBe(v2);
  });

  it('keeps unavailable sources and foreign items when something else changes', async () => {
    h = createHarness(files());
    await start(h);
    const { client } = h.connect();
    await client.call.scenes.rename(ID.sceneB, 'Renamed');
    await client.call.collections.save();
    const saved = JSON.parse(h.read('c1.json')!);
    expect(saved.sources.items.map((s: { id: string }) => s.id)).toContain(ID.unknown);
    const a = saved.scenes.items[0].sceneItems.items.map((i: { id: string }) => i.id);
    expect(a).toContain(ID.itemVertical);
    expect(a).toContain(ID.itemUnknown);
    expect(saved.futureRootKey).toEqual({ nested: [1, 2, 3] });
    expect(saved.scenes.items[1].name).toBe('Renamed');
  });

  it('creates the defaults like the legacy app when there is no manifest', async () => {
    h = createHarness({});
    await start(h);
    const { client } = h.connect();
    const scenes = await sliceOf(client, 'scenes');
    expect(scenes.scenes.map(s => s.name)).toEqual(['Scene']);
    const sources = await sliceOf(client, 'sources');
    const named = Object.values(sources.sources).filter(s => s.type !== 'scene');
    expect(named.map(s => [s.name, s.type, s.channel])).toEqual([
      ['Desktop Audio', 'wasapi_output_capture', 1],
      ['Mic/Aux', 'wasapi_input_capture', 3],
    ]);
    const manifest = JSON.parse(h.read('manifest.json')!);
    expect(manifest.collections).toHaveLength(1);
    expect(manifest.collections[0]).toMatchObject({ name: 'Scenes', auto: true, deleted: false });
    const saved = JSON.parse(h.read(`${manifest.activeId}.json`)!);
    expect(saved.schemaVersion).toBe(5);
    expect(saved.scenes.items).toHaveLength(1);
    expect(saved.transitions.transitions).toHaveLength(1);
  });
});
