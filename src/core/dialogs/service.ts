// Dialog windows (m1-dialogs-design 3): the registry `dialogId -> dialog`, the slice `dialog:<id>`,
// the commands `dialogs.*` and `sourceTypes.catalogue`, and the Add Source orchestration. Window
// creation goes through the generic main RPC; nothing here is Electron specific.
import { randomUUID } from 'node:crypto';
import type {
  AddSourceSubmit,
  DialogDataMap,
  DialogKind,
  DialogOpenRequest,
  DialogRef,
  DialogState,
  ExistingSourceOption,
  PickPathOptions,
  PickPathResult,
  SourceCatalogue,
} from '../../shared/contracts';
import { suggestName } from '../collections/format';
import { type Ctx, type Services, coded } from '../context';
import type { MainRpc } from '../main-rpc';
import { NEW_SOURCE_NAME, buildCatalogue, typeDisplayName } from '../sources/catalogue';
import { CLOSE_CHROME_TYPES, DIALOG_SPECS } from './specs';

export interface DialogsApi {
  /** Main reports that a window with a core port is gone (dialog windows: registry cleanup). */
  windowClosed(windowId: number): void;
  /** Destroys the dialog window, if any (shutdown, before OBS teardown). */
  closeAll(): Promise<void>;
  /** Number of open dialogs: 0 or 1 (tests, diagnostics). */
  count(): number;
}

interface Dialog {
  id: string;
  kind: DialogKind;
  state: DialogState;
  windowId: number;
  /** The source a `source-properties` dialog shows. */
  sourceId?: string;
}

const ENGLISH_TITLE = {
  properties: (typeName: string) => `Settings for ${typeName}`,
};

export function createDialogs(ctx: Ctx, svc: () => Services, mainRpc: MainRpc): DialogsApi {
  const { rt, backend } = ctx;
  const dialogs = new Map<string, Dialog>();
  /** The ONE dialog window (legacy has one child window): its current dialog. */
  let current: Dialog | null = null;
  /** `open` calls are serialized: a second one replaces the first in place. */
  let chain: Promise<unknown> = Promise.resolve();

  rt.defineSliceFactory('dialog', {
    create(key): DialogState {
      const d = dialogs.get(key);
      if (!d) throw coded(`unknown dialog: ${key}`, 'ENOENT');
      return structuredClone(d.state);
    },
  });

  // ---- data (design 3.3 step 2: everything the first frame needs) ---------------------------

  async function catalogue(): Promise<SourceCatalogue> {
    ctx.requireMedia();
    return buildCatalogue({
      backendTypes: await backend.sources.types(),
      sceneCount: ctx.requireDoc().scenes.length,
    });
  }

  function nameTaken(name: string) {
    const doc = ctx.requireDoc();
    return doc.sources.some(s => s.name === name) || doc.scenes.some(s => s.name === name);
  }

  function existingOptions(
    entry: { sourceType: string; propertiesManager: string },
    sceneId: string,
  ) {
    const doc = ctx.requireDoc();
    const out: ExistingSourceOption[] = [];
    if (entry.sourceType === 'scene') {
      for (const s of doc.scenes) if (s.id !== sceneId) out.push({ id: s.id, name: s.name });
      return out;
    }
    // legacy `Source.isSameType`: same type and manager, never a global audio source
    for (const s of doc.sources) {
      if (s.status !== 'ready' || s.channel !== undefined) continue;
      if (s.type === entry.sourceType && s.propertiesManager === entry.propertiesManager) {
        out.push({ id: s.id, name: s.name });
      }
    }
    return out;
  }

  async function build<K extends DialogKind>(
    req: Extract<DialogOpenRequest, { kind: K }>,
  ): Promise<{ data: DialogDataMap[K]; sourceId?: string }> {
    const doc = ctx.requireDoc();
    const kind: DialogKind = req.kind;
    switch (kind) {
      case 'source-showcase':
        return { data: { catalogue: await catalogue() } as DialogDataMap[K] };
      case 'add-source': {
        const p = (req as Extract<DialogOpenRequest, { kind: 'add-source' }>).params;
        const cat = await catalogue();
        const entry = cat.entries.find(e => e.id === p.catalogueId);
        if (!entry || entry.availability !== 'available') {
          throw coded(`unknown source type: ${p.catalogueId}`, 'ENOENT');
        }
        const sceneId = p.sceneId ?? doc.activeSceneId;
        if (!sceneId || !doc.scene(sceneId)) throw coded('no target scene', 'ENOENT');
        return {
          data: {
            entry,
            sceneId,
            suggestedName: suggestName(NEW_SOURCE_NAME[entry.id] ?? entry.name, nameTaken),
            existing: existingOptions(entry, sceneId),
          } as DialogDataMap[K],
        };
      }
      case 'source-properties': {
        const { sourceId } = (req as Extract<DialogOpenRequest, { kind: 'source-properties' }>)
          .params;
        const rec = doc.source(sourceId);
        if (!rec || rec.status !== 'ready') throw coded(`unknown source: ${sourceId}`, 'ENOENT');
        const close = CLOSE_CHROME_TYPES.includes(rec.type) && rec.propertiesManager === 'default';
        return {
          sourceId,
          data: {
            sourceId,
            sourceName: rec.name,
            typeName: typeDisplayName(rec.type, rec.propertiesManager),
            chrome: close ? 'close' : 'cancel-done',
          } as DialogDataMap[K],
        };
      }
      case 'name-scene': {
        const p = (req as Extract<DialogOpenRequest, { kind: 'name-scene' }>).params;
        if (p.rename) {
          const sc = doc.scene(p.rename);
          if (!sc) throw coded(`unknown scene: ${p.rename}`, 'ENOENT');
          return { data: { mode: 'rename', initialName: sc.name } as DialogDataMap[K] };
        }
        if (p.duplicateFrom) {
          const sc = doc.scene(p.duplicateFrom);
          if (!sc) throw coded(`unknown scene: ${p.duplicateFrom}`, 'ENOENT');
          return {
            data: {
              mode: 'duplicate',
              initialName: suggestName(sc.name, nameTaken),
            } as DialogDataMap[K],
          };
        }
        return {
          data: {
            mode: 'create',
            initialName: suggestName('New Scene', nameTaken),
          } as DialogDataMap[K],
        };
      }
      case 'rename-source': {
        const { sourceId } = (req as Extract<DialogOpenRequest, { kind: 'rename-source' }>).params;
        const rec = doc.source(sourceId);
        const name = rec?.name ?? doc.scene(sourceId)?.name;
        if (name === undefined) throw coded(`unknown source: ${sourceId}`, 'ENOENT');
        return { data: { sourceId, initialName: name } as DialogDataMap[K] };
      }
      case 'name-folder': {
        const p = (req as Extract<DialogOpenRequest, { kind: 'name-folder' }>).params;
        const sc = doc.scene(p.sceneId);
        if (!sc) throw coded(`unknown scene: ${p.sceneId}`, 'ENOENT');
        if (p.renameId) {
          const f = sc.nodes.find(n => n.kind === 'folder' && n.id === p.renameId);
          if (!f || f.kind !== 'folder') throw coded(`unknown folder: ${p.renameId}`, 'ENOENT');
          return { data: { mode: 'rename', initialName: f.name } as DialogDataMap[K] };
        }
        const taken = new Set(sc.nodes.flatMap(n => (n.kind === 'folder' ? [n.name] : [])));
        return {
          data: {
            mode: 'create',
            initialName: suggestName('New Folder', n => taken.has(n)),
          } as DialogDataMap[K],
        };
      }
    }
  }

  // ---- registry ----------------------------------------------------------------------------

  function drop(d: Dialog) {
    if (dialogs.get(d.id) !== d) return;
    dialogs.delete(d.id);
    if (current === d) current = null;
    if (d.kind === 'source-properties') svc().properties.close(d.id);
    rt.bus.emit('dialog.closed', { dialogId: d.id, kind: d.kind });
  }

  async function doOpen(req: DialogOpenRequest): Promise<DialogRef> {
    const { data, sourceId } = await build(req as never);
    const id = randomUUID();
    const state = {
      id,
      kind: req.kind,
      title: req.title,
      params: req.params,
      data,
    } as DialogState;
    const dialog: Dialog = { id, kind: req.kind, state, windowId: 0, sourceId };
    if (sourceId) await svc().properties.open(id, sourceId);
    dialogs.set(id, dialog);
    const size = DIALOG_SPECS[req.kind];
    const spec = {
      dialogId: id,
      entry: size.entry,
      title: req.title,
      width: size.width,
      height: size.height,
      minWidth: size.width,
      minHeight: size.height,
    };
    try {
      const old = current;
      let windowId = 0;
      if (old) {
        try {
          // legacy: replaced in place, re-centered only when the kind changes
          await mainRpc.call('dialogWindow.replace', old.windowId, {
            ...spec,
            position: old.kind === req.kind ? 'keep' : 'main',
          });
          windowId = old.windowId;
        } catch (e) {
          if ((e as { code?: string }).code !== 'ENOWINDOW') throw e;
        }
        drop(old); // the old page's port closes with its navigation; its slices go with it
      }
      if (!windowId) {
        windowId = (await mainRpc.call('dialogWindow.open', { ...spec, position: 'main' }))
          .windowId;
      }
      dialog.windowId = windowId;
      current = dialog;
    } catch (e) {
      dialogs.delete(id);
      if (sourceId) svc().properties.close(id);
      throw e;
    }
    rt.bus.emit('dialog.opened', { dialogId: id, kind: req.kind });
    return { dialogId: id, windowId: dialog.windowId };
  }

  function open(req: DialogOpenRequest): Promise<DialogRef> {
    const run = chain.then(() => doOpen(req));
    chain = run.catch(() => undefined);
    return run;
  }

  async function close(dialogId: string) {
    const d = dialogs.get(dialogId);
    if (!d) return;
    await mainRpc.call('dialogWindow.close', d.windowId).catch(() => undefined);
    drop(d);
  }

  // ---- Add Source (design 5.4) -------------------------------------------------------------

  async function submitAddSource(dialogId: string, submit: AddSourceSubmit) {
    const d = dialogs.get(dialogId);
    if (!d || d.kind !== 'add-source')
      throw coded(`unknown add-source dialog: ${dialogId}`, 'ENOENT');
    const data = d.state.data as DialogDataMap['add-source'];
    ctx.requireMedia();
    if (submit.mode === 'existing') {
      try {
        await svc().scenes.addItem(data.sceneId, submit.sourceId, { select: true });
      } catch (e) {
        if ((e as { code?: string }).code !== 'ECYCLE') throw e;
        // legacy: a native error box, the dialog stays open
        await mainRpc
          .call(
            'dialog.showError',
            d.windowId,
            'Error',
            'Unable to add a source: the scene you are trying to add already contains your current scene',
          )
          .catch(() => undefined);
        return;
      }
      await close(dialogId);
      return;
    }
    const name = (submit.name ?? '').trim();
    if (!name) throw coded('the name is empty', 'ENAME');
    const sourceId = await svc().sources.create({
      type: data.entry.sourceType,
      name,
      propertiesManager: data.entry.propertiesManager,
    });
    try {
      await svc().scenes.addItem(data.sceneId, sourceId, { select: true });
    } catch (e) {
      await svc()
        .sources.remove(sourceId)
        .catch(() => undefined);
      throw e;
    }
    // owner decision 5: audio-only sources open Source Properties too (Advanced Audio comes later)
    const rec = ctx.requireDoc().source(sourceId);
    if (rec?.configurable) {
      const typeName = typeDisplayName(rec.type, rec.propertiesManager);
      await open({
        kind: 'source-properties',
        params: { sourceId },
        title: ENGLISH_TITLE.properties(typeName),
      });
    } else await close(dialogId);
  }

  async function pickPath(options: PickPathOptions, windowId: number): Promise<PickPathResult> {
    if (options.mode === 'save-file') {
      const r = await mainRpc.call('dialog.showSave', windowId, {
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      return { canceled: r.canceled, paths: r.path ? [r.path] : [] };
    }
    const properties: ('openFile' | 'openDirectory' | 'multiSelections')[] =
      options.mode === 'open-dir' ? ['openDirectory'] : ['openFile'];
    if (options.mode === 'open-files') properties.push('multiSelections');
    return mainRpc.call('dialog.showOpen', windowId, {
      properties,
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
  }

  // ---- lifetime ----------------------------------------------------------------------------

  // legacy `SourceProperties` closes itself when its source is removed (also on collection switch)
  const closePropertiesOf = (match: (d: Dialog) => boolean) => {
    for (const d of [...dialogs.values()]) {
      if (d.kind === 'source-properties' && match(d)) void close(d.id);
    }
  };
  rt.bus.on('source.removed', ({ id }) => closePropertiesOf(d => d.sourceId === id));
  rt.bus.on('collection.willSwitch', () => closePropertiesOf(() => true));

  rt.registerCommands('dialogs', {
    open,
    close,
    submitAddSource,
    pickPath(options) {
      // caller() is only valid before the first await (runtime rule R-c)
      const windowId = rt.caller()?.windowId ?? current?.windowId ?? 0;
      return pickPath(options, windowId);
    },
  });
  rt.registerCommands('sourceTypes', { catalogue });

  return {
    windowClosed(windowId) {
      if (current && current.windowId === windowId) drop(current);
    },
    async closeAll() {
      const d = current;
      if (!d) return;
      await mainRpc.call('dialogWindow.close', d.windowId).catch(() => undefined);
      drop(d);
    },
    count: () => dialogs.size,
  };
}
