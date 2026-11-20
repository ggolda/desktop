import { afterEach, describe, expect, it } from 'vitest';
import type { DialogDataMap, DialogRef, DialogState } from '@/shared/contracts';
import { ID, buildV5, manifestOf, toText } from '../fixtures/synthetic';
import { type Harness, createHarness, realTick, sliceOf, start, until } from '../core-harness';

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
  let nextWindow = 7;
  h.rpcResults['dialogWindow.open'] = () => ({ windowId: nextWindow++ });
  h.rpcResults['dialogWindow.replace'] = () => ({ windowId: nextWindow++ }); // the swap makes a NEW window
  h.rpcResults['dialogWindow.close'] = () => undefined;
  h.rpcResults['dialog.showError'] = () => undefined;
  await start(h);
  return h;
}

const calls = (h: Harness, method: string) => h.rpcCalls.filter(c => c.method === method);

describe('dialog registry and windows', () => {
  it('opens a dialog with its data prepared, replaces it in place, closes on window-closed', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    const ref: DialogRef = await client.call.dialogs.open({
      kind: 'source-showcase',
      params: {},
      title: 'Add Source',
    });
    expect(ref.windowId).toBe(7);
    expect(calls(h, 'dialogWindow.open')).toHaveLength(1);
    expect(calls(h, 'dialogWindow.open')[0].args[0]).toMatchObject({
      dialogId: ref.dialogId,
      entry: 'dialog-source-showcase',
      title: 'Add Source',
      width: 900,
      height: 700,
      minWidth: 900,
      minHeight: 700,
      position: 'main',
    });
    const state = (await sliceOf(client, `dialog:${ref.dialogId}`)) as DialogState;
    expect(state.kind).toBe('source-showcase');
    const cat = (state.data as { catalogue: { entries: { id: string; availability: string }[] } })
      .catalogue;
    expect(cat.entries.find(e => e.id === 'image_source')?.availability).toBe('available');
    // two scenes in the fixture: the Scene type is offered
    expect(cat.entries.find(e => e.id === 'scene')?.availability).toBe('available');
    expect(cat.entries.find(e => e.id === 'text_ft2_source')?.availability).toBe('hidden');

    // a second dialog of ANOTHER kind replaces the window and re-centers
    const ref2 = await client.call.dialogs.open({
      kind: 'name-scene',
      params: {},
      title: 'Name Scene',
    });
    expect(ref2.windowId).toBe(8);
    expect(calls(h, 'dialogWindow.open')).toHaveLength(1);
    expect(calls(h, 'dialogWindow.replace')).toHaveLength(1);
    expect(calls(h, 'dialogWindow.replace')[0].args[0]).toBe(7);
    expect(calls(h, 'dialogWindow.replace')[0].args[1]).toMatchObject({
      entry: 'dialog-name-scene',
      position: 'main',
    });
    expect(h.core.services.dialogs.count()).toBe(1);

    // the same kind again: not re-centered
    await client.call.dialogs.open({ kind: 'name-scene', params: {}, title: 'Name Scene' });
    expect(calls(h, 'dialogWindow.replace')[1].args[1]).toMatchObject({ position: 'keep' });

    // main reports the window gone: registry is clean
    h.core.services.dialogs.windowClosed(7); // the swapped-out window: nothing to clean up
    expect(h.core.services.dialogs.count()).toBe(1);
    h.core.services.dialogs.windowClosed(9);
    expect(h.core.services.dialogs.count()).toBe(0);
    // opening again creates a new window
    await client.call.dialogs.open({ kind: 'name-scene', params: {}, title: 'Name Scene' });
    expect(calls(h, 'dialogWindow.open')).toHaveLength(2);
  });

  it('close(dialogId) destroys the window; unknown ids are ignored', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    const ref = await client.call.dialogs.open({ kind: 'name-scene', params: {}, title: 'x' });
    await client.call.dialogs.close(ref.dialogId);
    expect(calls(h, 'dialogWindow.close')[0].args).toEqual([7]);
    expect(h.core.services.dialogs.count()).toBe(0);
    await client.call.dialogs.close('nope');
  });

  it('prepares the name dialogs like legacy', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    const nameOf = async (req: Parameters<typeof client.call.dialogs.open>[0]) => {
      const ref = await client.call.dialogs.open(req);
      const s = await sliceOf(client, `dialog:${ref.dialogId}`);
      return s.data as { mode?: string; initialName: string };
    };
    const scenes = (await sliceOf(client, 'scenes')).scenes;
    const a = scenes[0];
    expect(await nameOf({ kind: 'name-scene', params: {}, title: 't' })).toEqual({
      mode: 'create',
      initialName: 'New Scene',
    });
    expect(await nameOf({ kind: 'name-scene', params: { rename: a.id }, title: 't' })).toEqual({
      mode: 'rename',
      initialName: a.name,
    });
    expect(
      await nameOf({ kind: 'name-scene', params: { duplicateFrom: a.id }, title: 't' }),
    ).toEqual({ mode: 'duplicate', initialName: `${a.name} (1)` });
    expect(
      await nameOf({ kind: 'rename-source', params: { sourceId: ID.image }, title: 't' }),
    ).toMatchObject({
      sourceId: ID.image,
    });
    expect(await nameOf({ kind: 'name-folder', params: { sceneId: a.id }, title: 't' })).toEqual({
      mode: 'create',
      initialName: 'New Folder',
    });
    await expect(
      client.call.dialogs.open({ kind: 'rename-source', params: { sourceId: 'nope' }, title: 't' }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('pickPath goes to the native dialogs with the calling window as parent', async () => {
    const h = await ready();
    h.rpcResults['dialog.showOpen'] = () => ({ canceled: false, paths: ['C:\\a.png'] });
    h.rpcResults['dialog.showSave'] = () => ({ canceled: false, path: 'C:\\out.txt' });
    const { client } = h.connect(42);
    const filters = [{ name: 'Images', extensions: ['png'] }];
    expect(await client.call.dialogs.pickPath({ mode: 'open-files', filters })).toEqual({
      canceled: false,
      paths: ['C:\\a.png'],
    });
    expect(calls(h, 'dialog.showOpen')[0].args).toEqual([
      42,
      { properties: ['openFile', 'multiSelections'], defaultPath: undefined, filters },
    ]);
    await client.call.dialogs.pickPath({ mode: 'open-dir' });
    expect((calls(h, 'dialog.showOpen')[1].args[1] as { properties: string[] }).properties).toEqual(
      ['openDirectory'],
    );
    expect(await client.call.dialogs.pickPath({ mode: 'save-file' })).toEqual({
      canceled: false,
      paths: ['C:\\out.txt'],
    });
    expect(calls(h, 'dialog.showSave')[0].args[0]).toBe(42);
  });
});

describe('Add Source orchestration', () => {
  async function openAdd(
    client: ReturnType<Harness['connect']>['client'],
    catalogueId: string,
    sceneId?: string,
  ) {
    const ref = await client.call.dialogs.open({
      kind: 'add-source',
      params: { catalogueId, sceneId },
      title: 'Add Source',
    });
    const state = await sliceOf(client, `dialog:${ref.dialogId}`);
    return { ref, data: state.data as DialogDataMap['add-source'] };
  }

  it('creates a source, selects the new item and opens Source Properties in place', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    const { ref, data } = await openAdd(client, 'image_source');
    expect(data.suggestedName).toBe('Image');
    expect(data.entry.sourceType).toBe('image_source');
    // the fixture has an image source of the same type: "Add Existing Source" is offered
    expect(data.existing.map(e => e.id)).toContain(ID.image);

    await expect(
      client.call.dialogs.submitAddSource(ref.dialogId, { mode: 'new', name: '   ' }),
    ).rejects.toMatchObject({ code: 'ENAME' });

    await client.call.dialogs.submitAddSource(ref.dialogId, { mode: 'new', name: 'My Picture' });
    const sources = (await sliceOf(client, 'sources')).sources;
    const created = Object.values(sources).find(s => s.name === 'My Picture')!;
    expect(created.type).toBe('image_source');
    expect(created.id).toMatch(/^image_source_/);
    const sel = await sliceOf(client, 'selection');
    const items = await sliceOf(client, `sceneItems:${data.sceneId}`);
    const item = items.nodes.find(n => n.kind === 'item' && n.sourceId === created.id)!;
    expect(sel.ids).toEqual([item.id]);

    // replaced by Source Properties in the same window
    expect(calls(h, 'dialogWindow.open')).toHaveLength(1);
    const rep = calls(h, 'dialogWindow.replace')[0];
    expect(rep.args[1]).toMatchObject({
      entry: 'dialog-source-properties',
      width: 600,
      height: 800,
    });
    expect(h.core.services.dialogs.count()).toBe(1);
    const propsDialog = (rep.args[1] as { dialogId: string }).dialogId;
    const dstate = await sliceOf(client, `dialog:${propsDialog}`);
    expect(dstate.data).toMatchObject({
      sourceId: created.id,
      sourceName: 'My Picture',
      typeName: 'Image',
      chrome: 'cancel-done',
    });
    const props = await sliceOf(client, `properties:${propsDialog}`);
    expect(props.sourceId).toBe(created.id);
    expect(props.items.map(p => p.name)).toEqual(['file', 'unload']);
  });

  it('applies the legacy creation defaults', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    const make = async (id: string, name: string) => {
      const { ref } = await openAdd(client, id);
      await client.call.dialogs.submitAddSource(ref.dialogId, { mode: 'new', name });
      const rec = Object.values((await sliceOf(client, 'sources')).sources).find(
        s => s.name === name,
      )!;
      return h.backend.sourceSet.get(rec.id)!.settings;
    };
    expect(await make('browser_source', 'B')).toEqual({
      shutdown: true,
      url: 'https://streamlabs.com/browser-source',
    });
    expect(await make('text_gdiplus', 'Hello')).toEqual({ text: 'Hello', version: 3 });
    expect(await make('color_source', 'C')).toEqual({});
    const game = await make('game_capture', 'G');
    expect(game).toMatchObject({
      capture_overlays: true,
      auto_placeholder_message: 'Looking for a game to capture',
      window_placeholder_missing_message: 'Specified window is not a game',
    });
    expect(String(game.auto_capture_rules_path)).toMatch(/game_capture_list\.json$/);
    expect(String(game.auto_placeholder_image)).toMatch(/capture-placeholder\.png$/);
  });

  it('adds an existing source and closes; a scene cycle shows the native error and stays', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    const { ref } = await openAdd(client, 'image_source');
    await client.call.dialogs.submitAddSource(ref.dialogId, {
      mode: 'existing',
      sourceId: ID.image,
    });
    // closed, no properties step
    expect(calls(h, 'dialogWindow.close')).toHaveLength(1);
    expect(calls(h, 'dialogWindow.replace')).toHaveLength(0);
    expect(h.core.services.dialogs.count()).toBe(0);

    // scene A contains scene B: adding A into B would loop
    const sc = await openAdd(client, 'scene', ID.sceneB);
    expect(sc.data.existing.map(e => e.id)).toEqual([ID.sceneA]);
    await client.call.dialogs.submitAddSource(sc.ref.dialogId, {
      mode: 'existing',
      sourceId: ID.sceneA,
    });
    const err = calls(h, 'dialog.showError');
    expect(err).toHaveLength(1);
    expect(String(err[0].args[2])).toContain('already contains your current scene');
    expect(h.core.services.dialogs.count()).toBe(1); // still open
    const items = await sliceOf(client, `sceneItems:${ID.sceneB}`);
    expect(items.nodes.some(n => n.kind === 'item' && n.sourceId === ID.sceneA)).toBe(false);
  });

  it('closes Source Properties when its source is removed', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    await client.call.dialogs.open({
      kind: 'source-properties',
      params: { sourceId: ID.browser },
      title: 'Settings',
    });
    expect(h.core.services.dialogs.count()).toBe(1);
    await client.call.sources.remove(ID.browser);
    await until(() => h.core.services.dialogs.count() === 0, 'dialog closed');
    expect(calls(h, 'dialogWindow.close')).toHaveLength(1);
    expect(h.core.services.properties.views()).toBe(0);
  });

  it('frees the properties data when the window closes', async () => {
    const h = await ready();
    const { client } = h.connect(1);
    const ref = await client.call.dialogs.open({
      kind: 'source-properties',
      params: { sourceId: ID.browser },
      title: 'Settings',
    });
    expect(h.core.services.properties.views()).toBe(1);
    h.core.services.dialogs.windowClosed(ref.windowId);
    expect(h.core.services.properties.views()).toBe(0);
    await realTick();
  });
});
