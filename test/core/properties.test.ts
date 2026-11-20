import { afterEach, describe, expect, it } from 'vitest';
import type { Property, PropertiesState } from '@/shared/contracts';
import { loadSystemFonts } from '@/core/properties/fonts';
import { ID, buildV5, manifestOf, toText } from '../fixtures/synthetic';
import { type Harness, createHarness, realTick, start, until } from '../core-harness';

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
  h.rpcResults['dialogWindow.open'] = () => ({ windowId: 7 });
  await start(h);
  const { client } = h.connect(1);
  const ref = await client.call.dialogs.open({
    kind: 'source-properties',
    params: { sourceId: ID.browser },
    title: 'Settings',
  });
  const handle = client.slice(`properties:${ref.dialogId}`);
  const off = handle.subscribe(() => undefined);
  await until(() => handle.state !== undefined, 'properties slice');
  const state = () => handle.state as unknown as PropertiesState;
  const prop = (name: string) => state().items.find(p => p.name === name) as Property;
  return { h, client, ref, state, prop, off };
}

describe('properties.set', () => {
  it('re-reads the set and patches only what differs (modified callbacks)', async () => {
    const { h, client, state, prop } = await ready();
    expect(state().sourceId).toBe(ID.browser);
    expect(state().items.map(p => p.name)).toEqual([
      'url',
      'fps_custom',
      'fps',
      'mode',
      'refreshnocache',
    ]);
    expect(prop('fps').visible).toBe(false);
    expect((prop('mode') as { items: unknown[] }).items).toHaveLength(1);
    const rev0 = state().rev;

    let updated = 0;
    client.on('source.updated', () => updated++);
    await realTick();
    await client.call.properties.set(ID.browser, [{ name: 'fps_custom', value: true }]);
    await until(() => state().rev > rev0, 'patch');
    expect(prop('fps_custom')).toMatchObject({ value: true });
    expect(prop('fps').visible).toBe(true); // dependent visibility, as libobs `modified`
    expect((prop('mode') as { items: unknown[] }).items).toHaveLength(2);
    expect(h.backend.sourceSet.get(ID.browser)!.settings.fps_custom).toBe(true);
    await until(() => updated === 1, 'source.updated');
  });

  it('marks the collection dirty (saved with the new setting)', async () => {
    const { h, client } = await ready();
    await client.call.properties.set(ID.browser, [
      { name: 'url', value: 'https://example.test/x' },
    ]);
    await client.call.collections.save();
    const saved = JSON.parse(h.read('c1.json')!);
    const src = saved.sources.items.find((s: { id: string }) => s.id === ID.browser);
    expect(src.settings.url).toBe('https://example.test/x');
  });

  it('coalesces calls that arrive while one is running into one update and one re-read', async () => {
    const { h, client } = await ready();
    const real = h.backend.sources.updateSettings;
    h.backend.sources.updateSettings = async (id, patch) => {
      await realTick();
      await real(id, patch);
    };
    const before = h.backend.calls.filter(c => c.startsWith('sources.updateSettings')).length;
    const reads = h.backend.propertyReads;
    await Promise.all([
      client.call.properties.set(ID.browser, [{ name: 'url', value: 'a' }]),
      client.call.properties.set(ID.browser, [{ name: 'fps', value: 10 }]),
      client.call.properties.set(ID.browser, [{ name: 'url', value: 'b' }]),
    ]);
    const updates =
      h.backend.calls.filter(c => c.startsWith('sources.updateSettings')).length - before;
    expect(updates).toBeLessThanOrEqual(2);
    expect(h.backend.sourceSet.get(ID.browser)!.settings).toMatchObject({ url: 'b', fps: 10 });
    expect(h.backend.propertyReads - reads).toBeLessThanOrEqual(2 * 2 + 1);
  });

  it('puts a list value that fell out of its items on the first item (legacy)', async () => {
    const { h, client, prop } = await ready();
    await client.call.properties.set(ID.browser, [{ name: 'fps_custom', value: true }]);
    await client.call.properties.set(ID.browser, [{ name: 'mode', value: 'b' }]);
    await until(
      () => prop('mode').kind === 'list' && (prop('mode') as { value: string }).value === 'b',
      'b',
    );
    await client.call.properties.set(ID.browser, [{ name: 'fps_custom', value: false }]);
    await until(() => (prop('mode') as { value: string }).value === 'a', 'back to a');
    expect(h.backend.sourceSet.get(ID.browser)!.settings.mode).toBe('a');
  });

  it('never sends buttons, and press / refresh re-read', async () => {
    const { h, client, state } = await ready();
    await client.call.properties.set(ID.browser, [
      { name: 'refreshnocache', value: true as never },
    ]);
    expect(h.backend.sourceSet.get(ID.browser)!.settings).not.toHaveProperty('refreshnocache');
    const rev = state().rev;
    await client.call.properties.press(ID.browser, 'refreshnocache');
    expect(h.backend.pressed).toEqual([`${ID.browser}:refreshnocache`]);
    await until(() => state().rev > rev, 'rev after press');
    const rev2 = state().rev;
    await client.call.properties.refresh(ID.browser);
    await until(() => state().rev > rev2, 'rev after refresh');
  });

  it('rejects unknown sources', async () => {
    const { client } = await ready();
    await expect(client.call.properties.set('nope', [])).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(client.call.properties.press('nope', 'x')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('splits font and editable list values into backend settings', async () => {
    const { h, client } = await ready();
    h.backend.propertyDefs.browser_source = () => [
      {
        name: 'font',
        description: 'Font',
        longDescription: '',
        enabled: true,
        visible: true,
        type: 9,
        value: { face: 'Arial', style: '', size: 36, flags: 0 },
      },
      {
        name: 'files',
        description: 'Files',
        longDescription: '',
        enabled: true,
        visible: true,
        type: 10,
        value: [],
        editable: { type: 1, filter: '', defaultPath: '' },
      },
    ];
    // a fresh view learns the kinds from the next open; refresh the set the command uses
    const ref2 = await client.call.dialogs.open({
      kind: 'source-properties',
      params: { sourceId: ID.browser },
      title: 'Settings',
    });
    expect(ref2.dialogId).toBeTruthy();
    await client.call.properties.set(ID.browser, [
      {
        name: 'font',
        value: { face: 'Segoe UI', style: 'Bold', size: 20, flags: 1, path: 'C:\\f.ttf' },
      },
      { name: 'files', value: ['a.png', 'b.png'] },
    ]);
    const s = h.backend.sourceSet.get(ID.browser)!.settings;
    expect(s.font).toEqual({ face: 'Segoe UI', style: 'Bold', size: 20, flags: 1 });
    expect(s.custom_font).toBe('C:\\f.ttf');
    expect(s.files).toEqual([
      { value: 'a.png', selected: false, hidden: false },
      { value: 'b.png', selected: false, hidden: false },
    ]);
  });

  it('fonts() is a command and the loader maps faces', async () => {
    const faces = await loadSystemFonts(async () => [
      { family: 'B', style: 'Bold', weight: 700, italic: false, oblique: false },
      { family: 'A', style: 'Italic', weight: 400, italic: true, oblique: false },
      { family: 'A', style: 'Regular', weight: 400, italic: false, oblique: false },
    ]);
    expect(faces.map(f => `${f.family}/${f.style}/${f.flags}`)).toEqual([
      'A/Italic/2',
      'A/Regular/0',
      'B/Bold/1',
    ]);
  });
});
