import { afterEach, describe, expect, it } from 'vitest';
import { ID, buildV5, manifestOf, toText } from '../fixtures/synthetic';
import { type Harness, createHarness, sliceOf, start } from '../core-harness';

let h: Harness | undefined;
afterEach(() => {
  h?.cleanup();
  h = undefined;
});

async function ready() {
  h = createHarness({
    'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
    'c1.json': toText(buildV5()),
  });
  await start(h);
  return h;
}

describe('editor.getGeometry', () => {
  it('lists the active scene front-most first with transforms, flags and current source sizes', async () => {
    const h = await ready();
    const { client } = h.connect();
    const g = await client.call.editor.getGeometry('horizontal');
    expect(g).not.toBeNull();
    expect(g!.sceneId).toBe(ID.sceneA);
    expect(g!.baseWidth).toBeGreaterThan(0);
    const slice = await sliceOf(client, `sceneItems:${ID.sceneA}`);
    const itemIds = slice.nodes.filter(n => n.kind === 'item').map(n => n.id);
    expect(g!.items.map(i => i.id)).toEqual(itemIds);
    expect(g!.folders.map(f => f.id)).toEqual(
      slice.nodes.filter(n => n.kind === 'folder').map(n => n.id),
    );
    const image = g!.items.find(i => i.id === ID.itemImage)!;
    // the fake backend reports 1920x1080 for the image source
    expect([image.width, image.height]).toEqual([1920, 1080]);
    expect(image).toMatchObject({ visible: true, locked: false, rotation: 0 });
  });

  it('reads source sizes from the backend on every call (no cache)', async () => {
    const h = await ready();
    const { client } = h.connect();
    const before = await client.call.editor.getGeometry();
    expect(before!.items.find(i => i.id === ID.itemImage)!.width).toBe(1920);
    h.backend.sourceSet.get(ID.image)!.info.width = 640;
    h.backend.sourceSet.get(ID.image)!.info.height = 360;
    const after = await client.call.editor.getGeometry();
    const image = after!.items.find(i => i.id === ID.itemImage)!;
    expect([image.width, image.height]).toEqual([640, 360]);
  });
});

describe('editor transforms', () => {
  it('a throttled drag goes through sceneItems.transform: slice, backend and saved file stay in step', async () => {
    const h = await ready();
    const { client } = h.connect();
    await client.call.sceneItems.transform(ID.sceneA, [
      { id: ID.itemImage, transform: { position: { x: 10, y: 20 } } },
    ]);
    await client.call.sceneItems.transform(ID.sceneA, [
      { id: ID.itemImage, transform: { position: { x: 33, y: 44 }, scale: { x: 0.5, y: 0.5 } } },
    ]);
    await client.call.collections.save();
    const file = JSON.parse(h.read('c1.json')!);
    const saved = file.scenes.items[0].sceneItems.items.find(
      (i: { id: string }) => i.id === ID.itemImage,
    );
    expect(saved).toMatchObject({ x: 33, y: 44, scaleX: 0.5, scaleY: 0.5 });
  });

  it('translate moves items by a delta atomically and marks them dirty', async () => {
    const h = await ready();
    const { client } = h.connect();
    const g0 = await client.call.editor.getGeometry();
    const a0 = g0!.items.find(i => i.id === ID.itemImage)!;
    await client.call.sceneItems.translate(ID.sceneA, [ID.itemImage], { x: 1, y: -1 });
    await client.call.sceneItems.translate(ID.sceneA, [ID.itemImage], { x: 1, y: -1 });
    const g1 = await client.call.editor.getGeometry();
    const a1 = g1!.items.find(i => i.id === ID.itemImage)!;
    expect([a1.x, a1.y]).toEqual([a0.x + 2, a0.y - 2]);
    await client.call.collections.save();
    const file = JSON.parse(h.read('c1.json')!);
    const saved = file.scenes.items[0].sceneItems.items.find(
      (i: { id: string }) => i.id === ID.itemImage,
    );
    expect([saved.x, saved.y]).toEqual([a0.x + 2, a0.y - 2]);
  });
});
