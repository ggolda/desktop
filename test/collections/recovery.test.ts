import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ID, buildV5, manifestOf, toText } from '../fixtures/synthetic';
import { type Harness, createHarness, sliceOf, start } from '../core-harness';

let h: Harness | undefined;
afterEach(() => {
  h?.cleanup();
  h = undefined;
  vi.restoreAllMocks();
});

const good = toText(buildV5());
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

async function open(files: Record<string, string>) {
  h = createHarness(files);
  await start(h);
  return h.connect().client;
}

describe('recovery ladder', () => {
  it('corrupt primary -> the .bak is used and nothing is overwritten on open', async () => {
    quiet();
    const client = await open({
      'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
      'c1.json': '{ not json',
      'c1.json.bak': good,
    });
    const col = await sliceOf(client, 'collections');
    expect(col.status).toBe('ready');
    expect(col.warnings).toContainEqual({ code: 'restored-from-backup' });
    const scenes = await sliceOf(client, 'scenes');
    expect(scenes.scenes).toHaveLength(2);
    expect(h!.read('c1.json')).toBe('{ not json');
  });

  it('a missing primary falls back to the .bak too', async () => {
    quiet();
    const client = await open({
      'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
      'c1.json.bak': good,
    });
    expect((await sliceOf(client, 'collections')).warnings).toContainEqual({
      code: 'restored-from-backup',
    });
  });

  it('after a restore the next save repairs the primary', async () => {
    quiet();
    const client = await open({
      'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
      'c1.json': 'garbage',
      'c1.json.bak': good,
    });
    await client.call.scenes.rename(ID.sceneB, 'Fixed');
    await client.call.collections.save();
    expect(JSON.parse(h!.read('c1.json')!).scenes.items[1].name).toBe('Fixed');
  });

  it('both corrupt -> a new collection, the broken files are left alone', async () => {
    quiet();
    const client = await open({
      'manifest.json': toText(manifestOf([{ id: 'c1', name: 'Broken' }], 'c1')),
      'c1.json': '{ nope',
      'c1.json.bak': '[1,2',
    });
    const col = await sliceOf(client, 'collections');
    expect(col.status).toBe('ready');
    expect(col.warnings).toContainEqual({ code: 'load-failed', collectionId: 'c1' });
    expect(col.activeId).not.toBe('c1');
    expect(col.collections.map(c => c.name).sort()).toEqual(['Broken', 'Scenes']);
    expect(h!.read('c1.json')).toBe('{ nope');
    expect(h!.read('c1.json.bak')).toBe('[1,2');
    const manifest = JSON.parse(h!.read('manifest.json')!);
    expect(manifest.collections.find((c: { id: string }) => c.id === 'c1')).toBeTruthy();
    expect(fs.existsSync(`${h!.collectionsDir}/${manifest.activeId}.json`)).toBe(true);
  });

  it('a media-phase failure of the primary falls back to the .bak', async () => {
    quiet();
    h = createHarness({
      'manifest.json': toText(manifestOf([{ id: 'c1' }], 'c1')),
      'c1.json': good,
      'c1.json.bak': good,
    });
    const original = h.backend.scenes.create;
    let failed = false;
    h.backend.scenes.create = async id => {
      if (!failed) {
        failed = true;
        throw new Error('boom');
      }
      return original(id);
    };
    await start(h);
    const client = h.connect().client;
    const col = await sliceOf(client, 'collections');
    expect(col.status).toBe('ready');
    expect(col.warnings).toContainEqual({ code: 'restored-from-backup' });
  });

  it('the startup choice prefers the active entry, then the most recent', async () => {
    const entry = (id: string, modified: string) =>
      manifestOf([{ id, modified }], 'x').collections[0];
    h = createHarness({
      'manifest.json': toText({
        activeId: 'gone',
        collections: [
          entry('old', '2026-01-01T00:00:00.000Z'),
          entry('new', '2026-06-01T00:00:00.000Z'),
        ],
      }),
      'old.json': good,
      'new.json': good,
    });
    await start(h);
    expect(h.core.ctx.activeId).toBe('new');
  });
});
