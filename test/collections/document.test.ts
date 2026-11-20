import { describe, expect, it } from 'vitest';
import { CollectionDocument, overlay } from '@/core/collections/document';
import { ID, buildV2, buildV5, diffPaths, toText } from '../fixtures/synthetic';

const parse = (text: string) => JSON.parse(text) as ReturnType<typeof buildV5>;

describe('document model', () => {
  it('editing one source changes only that node', () => {
    const text = toText(buildV5());
    const doc = CollectionDocument.parse(text);
    doc.source(ID.image)!.name = 'Renamed logo';
    doc.touchSource(ID.image);
    const out = doc.serialize();
    expect(diffPaths(parse(text), parse(out))).toEqual(['$.sources.items.2.name']);
  });

  it('editing one scene item changes only that item and keeps unknown keys and order', () => {
    const text = toText(buildV5());
    const doc = CollectionDocument.parse(text);
    const scene = doc.scene(ID.sceneA)!;
    const node = scene.nodes.find(n => n.id === ID.itemImage)!;
    if (node.kind !== 'item') throw new Error('item expected');
    node.transform.position.x = 77;
    doc.touchItem(node.id);
    const out = doc.serialize();
    const before = parse(text);
    const after = parse(out);
    // file order is bottom-first: [unknown, vertical, browser, folder, image, scene]
    const idx = before.scenes.items[0].sceneItems.items.findIndex(
      (i: { id: string }) => i.id === ID.itemImage,
    );
    expect(diffPaths(before, after)).toEqual([`$.scenes.items.0.sceneItems.items.${idx}.x`]);
    const item = after.scenes.items[0].sceneItems.items[idx];
    expect(Object.keys(item)).toEqual(Object.keys(before.scenes.items[0].sceneItems.items[idx]));
    expect(item.futureItemKey).toBe(1);
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  it('does not resurrect old values on the second save', () => {
    const doc = CollectionDocument.parse(toText(buildV5()));
    doc.source(ID.image)!.name = 'One';
    doc.touchSource(ID.image);
    doc.serialize();
    doc.clearDirty();
    doc.source(ID.desktop)!.muted = true;
    doc.touchSource(ID.desktop);
    const out = parse(doc.serialize());
    expect(out.sources.items[2].name).toBe('One');
    expect(out.sources.items[0].muted).toBe(true);
  });

  it('new sources get the legacy key order', () => {
    const doc = CollectionDocument.parse(toText(buildV5()));
    const img = doc.source(ID.image)!;
    expect(img.raw).not.toBeNull();
    doc.touchAll();
    const out = parse(doc.serialize());
    expect(Object.keys(out.sources.items[0])).toEqual([
      'hotkeys',
      'id',
      'name',
      'type',
      'settings',
      'volume',
      'channel',
      'muted',
      'deinterlaceMode',
      'deinterlaceFieldOrder',
      'filters',
      'propertiesManager',
      'propertiesManagerSettings',
      'forceMono',
      'syncOffset',
      'audioMixers',
      'monitoringType',
      'mixerHidden',
    ]);
    // unknown source keys survive a full re-emit
    expect(out.sources.items[3].futureSourceKey).toEqual({ keep: 'me' });
  });

  it('a schema 2 collection upgrades to v5 on touchAll', () => {
    const doc = CollectionDocument.parse(toText(buildV2()));
    expect(doc.needsMigration).toBe(true);
    doc.touchAll();
    const out = parse(doc.serialize(new Map(), { horizontal: { w: 1280, h: 720 } }));
    expect(out.schemaVersion).toBe(5);
    expect(out.sources.schemaVersion).toBe(5);
    expect(out.relativeCoordinates).toBe(true);
    expect(out.guestCam).toMatchObject({ nodeType: 'GuestCamNode' });
    expect(out.operatingSystem).toBe(process.platform);
    // key order of an old source follows the legacy order
    expect(Object.keys(out.sources.items[1]).slice(0, 4)).toEqual([
      'hotkeys',
      'id',
      'name',
      'type',
    ]);
  });

  it('overlay keeps unknown keys after the known ones', () => {
    const out = overlay({ z: 1, a: 1, id: 'x' }, { id: 'y', b: 2 }, ['id', 'a', 'b']);
    expect(Object.keys(out)).toEqual(['id', 'a', 'b', 'z']);
    expect(out.id).toBe('y');
  });

  it('hides foreign and unavailable items but keeps them in the document', () => {
    const doc = CollectionDocument.parse(toText(buildV5()));
    const hidden = doc
      .scene(ID.sceneA)!
      .nodes.filter(n => n.hidden)
      .map(n => n.id);
    expect(hidden.sort()).toEqual([ID.itemUnknown, ID.itemVertical].sort());
    expect(doc.source(ID.unknown)!.status).toBe('unavailable');
  });
});
