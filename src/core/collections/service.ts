// Collections: manifest, open/switch/create, the two-phase load, recovery ladder, `collections.*`.
// Phase A (document, no backend): parse, normalize, fill slices. Phase B (media): create the backend
// objects in chunks with bulk calls (m1-design 1.3, 3, 7).
import { randomUUID } from 'node:crypto';
import type { CollectionEntry, CollectionWarning } from '../../shared/contracts';
import { type Ctx, type Services, coded } from '../context';
import type { ItemRec, SceneRec } from './document';
import { CollectionDocument } from './document';
import { DEFAULT_COLLECTION_NAME, type Manifest, type ManifestEntry, suggestName } from './format';
import { type Saver, createSaver } from './saver';

const SOURCE_CHUNK = 8;
const ITEM_CHUNK = 100;

const yieldLoop = () => new Promise<void>(r => setImmediate(r));
const os = (): 'win32' | 'darwin' => (process.platform === 'darwin' ? 'darwin' : 'win32');

type Kind = 'primary' | 'backup' | 'new';

export interface CollectionsApi {
  saver: Saver;
  /** Phase A of the startup collection (no backend needed). */
  openInitial(): void;
  /** Phase B of the startup collection; call after the backend is ready. */
  completeInitial(): Promise<void>;
  /** Final save (settings re-read), flush of every queued write. Before backend shutdown. */
  shutdown(): Promise<void>;
  /** Releases the backend objects of the open collection (shutdown, before OSN teardown). */
  releaseMedia(): Promise<void>;
}

export function createCollections(ctx: Ctx, svc: () => Services): CollectionsApi {
  const { rt, store, perf } = ctx;
  const slice = ctx.slices.collections;

  let manifest: Manifest = { activeId: null, collections: [] };
  let kind: Kind = 'primary';
  let loadedText: string | null = null;
  let needsDefaults = false;
  let failedLoad: string | null = null;
  let absoluteBak: Promise<void> = Promise.resolve();

  const saver: Saver = createSaver(ctx, {
    async onSaved(id) {
      const e = entry(id);
      if (e) e.modified = new Date().toISOString();
      await writeManifest();
    },
  });

  // ---- manifest ---------------------------------------------------------------------------

  const entry = (id: string): ManifestEntry | undefined =>
    manifest.collections.find(c => c.id === id);
  const loadable = () => manifest.collections.filter(c => !c.deleted && c.operatingSystem === os());

  function entriesView(): CollectionEntry[] {
    return manifest.collections
      .filter(c => !c.deleted)
      .map(c => {
        const e: CollectionEntry = {
          id: c.id,
          name: c.name,
          modified: c.modified,
          operatingSystem: c.operatingSystem,
          needsRename: c.needsRename === true,
        };
        if (typeof c.serverId === 'number') e.serverId = c.serverId;
        return e;
      });
  }

  function syncList() {
    const next = entriesView();
    if (JSON.stringify(next) !== JSON.stringify(slice.collections)) slice.collections = next;
    if (slice.activeId !== ctx.activeId) slice.activeId = ctx.activeId;
  }

  async function writeManifest() {
    manifest.activeId = ctx.activeId;
    await store.writeManifest(manifest);
    syncList();
  }

  function addEntry(id: string, name: string, auto: boolean): ManifestEntry {
    const e: ManifestEntry = {
      id,
      name,
      modified: new Date().toISOString(),
      auto,
      operatingSystem: os(),
      deleted: false,
      needsRename: false,
    };
    manifest.collections.unshift(e); // legacy ADD_COLLECTION unshifts
    return e;
  }

  const nameTaken = (n: string) => manifest.collections.some(c => c.name === n && !c.deleted);

  // ---- phase A ----------------------------------------------------------------------------

  function warningsOf(doc: CollectionDocument | null): CollectionWarning[] {
    const w: CollectionWarning[] = [];
    if (failedLoad) w.push({ code: 'load-failed', collectionId: failedLoad });
    if (kind === 'backup') w.push({ code: 'restored-from-backup' });
    if (doc) {
      const un = doc.sources.filter(s => s.status === 'unavailable');
      if (un.length) {
        w.push({
          code: 'unavailable-sources',
          count: un.length,
          types: [...new Set(un.map(s => s.type))],
        });
      }
      const failed = doc.sources.filter(s => s.status === 'failed');
      if (failed.length) {
        w.push({
          code: 'sources-failed',
          count: failed.length,
          types: [...new Set(failed.map(s => s.type))],
        });
      }
    }
    if (ctx.saveBlocked) w.push({ code: 'migration-blocked', reason: 'incomplete load' });
    return w;
  }

  function syncWarnings() {
    const next = warningsOf(ctx.doc);
    if (JSON.stringify(next) !== JSON.stringify(slice.warnings)) slice.warnings = next;
  }

  function fillSlices() {
    svc().scenes.syncAll();
    svc().sources.syncAll();
    svc().selection.reset();
    for (const sc of ctx.doc?.scenes ?? []) svc().scenes.refreshItems(sc.id);
    syncList();
    syncWarnings();
  }

  function install(doc: CollectionDocument, id: string, text: string | null, k: Kind) {
    ctx.doc = doc;
    ctx.activeId = id;
    ctx.saveBlocked = false;
    kind = k;
    loadedText = text;
    if (text !== null && doc.needsMigration && !store.hasAbsoluteBackup(id)) {
      // C6: the pre-migration copy exists before anything can go wrong
      absoluteBak = store.writeAbsoluteBak(id, text).catch(e => console.error('[collections]', e));
    }
    fillSlices();
  }

  /** Primary, then `.bak`. Null when neither parses (nothing is installed then). */
  function openDocument(id: string, from: 'primary' | 'backup' = 'primary'): Kind | null {
    const order: ('primary' | 'backup')[] = from === 'primary' ? ['primary', 'backup'] : ['backup'];
    for (const k of order) {
      let text: string | null = null;
      try {
        text = store.read(id, k === 'backup');
        if (text === null) continue;
        if (!text) throw new Error('blank file');
        install(CollectionDocument.parse(text), id, text, k);
        return k;
      } catch (e) {
        console.error(`[collections] ${id} ${k} unusable: ${e instanceof Error ? e.message : e}`);
      }
    }
    return null;
  }

  // ---- phase B ----------------------------------------------------------------------------

  async function loadMedia() {
    const doc = ctx.requireDoc();
    const { backend } = ctx;
    // video context first: scene items bind to it (legacy root.ts:103)
    const canvas = await backend.canvases.ensure('horizontal');
    const base = (doc.root.baseResolutions?.horizontal ?? doc.root.baseResolution) as
      { baseWidth?: number; baseHeight?: number } | undefined;
    if (
      base &&
      typeof base.baseWidth === 'number' &&
      typeof base.baseHeight === 'number' &&
      base.baseWidth > 0 &&
      base.baseHeight > 0 &&
      (base.baseWidth !== canvas.baseWidth || base.baseHeight !== canvas.baseHeight)
    ) {
      await backend.canvases.setBaseResolution('horizontal', {
        width: base.baseWidth,
        height: base.baseHeight,
      });
    }
    const c = (await backend.canvases.get('horizontal')) ?? canvas;
    ctx.slices.canvases.horizontal = {
      id: 'horizontal',
      baseWidth: c.baseWidth,
      baseHeight: c.baseHeight,
      outputWidth: c.outputWidth,
      outputHeight: c.outputHeight,
      fpsNum: c.fpsNum,
      fpsDen: c.fpsDen,
    };
    await svc().transitions.load();

    // sources: chunks, one bulk call each
    const pending = doc.sources.filter(s => s.status === 'pending');
    for (let i = 0; i < pending.length; i += SOURCE_CHUNK) {
      const chunk = pending.slice(i, i + SOURCE_CHUNK);
      const { ok } = await backend.sources.createMany(chunk.map(r => svc().sources.specOf(r)));
      for (const info of ok) {
        const rec = doc.source(info.id);
        if (!rec) continue;
        svc().sources.applyInfo(rec, info);
        if (rec.channel !== undefined) await backend.sources.assignChannel(rec.channel, rec.id);
        if (rec.hasAudio) await svc().audio.onSourceReady(rec, info);
      }
      const okIds = new Set(ok.map(o => o.id));
      for (const rec of chunk) if (!okIds.has(rec.id)) rec.status = 'failed';
      for (const rec of chunk) svc().sources.sync(rec.id);
      await yieldLoop();
    }
    perf.mark('sources.created');

    // scenes, then items (nested scenes need every scene to exist first)
    for (const sc of doc.scenes) await backend.scenes.create(sc.id);
    for (const sc of doc.scenes) {
      await addSceneItems(sc);
      svc().scenes.refreshItems(sc.id);
      await yieldLoop();
    }
    perf.mark('items.added');
    const first = doc.activeSceneId ?? doc.scenes[0]?.id;
    // a new collection has no scene yet: the defaults create and activate one
    if (first) await svc().transitions.switchTo(null, first);
  }

  async function addSceneItems(sc: SceneRec) {
    const doc = ctx.requireDoc();
    const items = [...sc.nodes]
      .reverse() // bottom first, as the backend stores them
      .filter((n): n is ItemRec => n.kind === 'item' && !n.hidden);
    const live: ItemRec[] = [];
    for (const n of items) {
      const src = doc.source(n.sourceId);
      if (src && src.status !== 'ready')
        n.hidden = true; // failed to create: kept, never shown
      else live.push(n);
    }
    for (let i = 0; i < live.length; i += ITEM_CHUNK) {
      const chunk = live.slice(i, i + ITEM_CHUNK);
      const infos = await ctx.backend.scenes.addItems(
        sc.id,
        chunk.map(n => ({
          sourceId: n.sourceId,
          canvas: n.canvas,
          transform: n.transform,
          ...n.settings,
        })),
      );
      chunk.forEach((n, j) => {
        n.ref = infos[j].ref;
        n.transform = infos[j].transform;
      });
      if (live.length > ITEM_CHUNK) await yieldLoop();
    }
  }

  async function releaseMedia() {
    const doc = ctx.doc;
    await svc().audio.reset();
    if (!doc) return;
    const { backend } = ctx;
    for (const sc of doc.scenes) await backend.scenes.remove(sc.id).catch(() => undefined);
    for (const s of doc.sources) {
      if (s.status !== 'ready') continue;
      if (s.channel !== undefined)
        await backend.sources.assignChannel(s.channel, null).catch(() => undefined);
      await backend.sources.remove(s.id).catch(() => undefined);
    }
    await svc().transitions.unload();
  }

  async function teardown() {
    await releaseMedia();
    ctx.doc = null;
    svc().sources.reset();
    svc().scenes.reset();
    ctx.slices.selection.sceneId = null;
    ctx.slices.selection.ids = [];
    ctx.slices.selection.lastId = null;
  }

  async function setupDefaults() {
    const s = svc();
    await s.scenes.create('Scene', { makeActive: true });
    await s.sources.create({ type: 'wasapi_output_capture', name: 'Desktop Audio', channel: 1 });
    await s.sources.create({ type: 'wasapi_input_capture', name: 'Mic/Aux', channel: 3 });
  }

  async function finish(id: string) {
    const doc = ctx.requireDoc();
    ctx.loading = false;
    if (needsDefaults) {
      needsDefaults = false;
      await setupDefaults();
      await saver.flush();
    }
    fillSlices();
    svc().audio.recomputeMixer();
    svc().selection.resync();
    svc().display.backendReady();
    void svc().display.refreshRegions();
    slice.status = 'ready';
    perf.mark('ready');

    if (kind === 'primary' && loadedText !== null && store.read(id, true) !== loadedText) {
      // C6 / legacy scene-collections.ts:758: the `.bak` is the last text that loaded
      await store.writeBak(id, loadedText).catch(e => console.error('[collections]', e));
    }
    if (doc.needsMigration && loadedText !== null) {
      // strict mode: any loss blocks persisting the migration (scene-collections.ts:764)
      const lost =
        doc.sources.some(s => s.status !== 'ready') ||
        doc.scenes.some(sc =>
          sc.nodes.some(n => n.hidden && n.kind === 'item' && n.canvas === 'horizontal'),
        );
      if (lost) {
        ctx.saveBlocked = true;
        syncWarnings();
      } else {
        await absoluteBak;
        doc.touchAll();
        await saver.flush();
      }
    }
    rt.bus.emit('collection.loaded', { id });
  }

  /** Runs phase B for the installed document; falls back to `.bak`, then to a new collection. */
  async function mediaOrRecover(id: string) {
    try {
      await loadMedia();
      await finish(id);
      return;
    } catch (e) {
      console.error('[collections] media load failed', e);
    }
    await teardown();
    if (kind === 'primary' && openDocument(id, 'backup')) {
      return mediaOrRecover(id);
    }
    await fallbackNew(id);
  }

  async function fallbackNew(failedId: string) {
    failedLoad = failedId;
    await createAndLoad({ auto: true });
  }

  /** Creates the entry and document of a new collection and loads it (defaults are created). */
  async function createAndLoad(opts: { name?: string; auto?: boolean }): Promise<CollectionEntry> {
    const id = randomUUID();
    const name = opts.name || suggestName(DEFAULT_COLLECTION_NAME, nameTaken);
    const e = addEntry(id, name, opts.auto ?? false);
    needsDefaults = true;
    install(CollectionDocument.empty(), id, null, 'new');
    ctx.loading = true;
    slice.status = 'loading';
    await writeManifest();
    try {
      await loadMedia();
      await finish(id);
    } catch (err) {
      slice.status = 'error';
      ctx.loading = false;
      throw err;
    }
    return entriesView().find(c => c.id === e.id)!;
  }

  // ---- switching --------------------------------------------------------------------------

  async function beforeSwitch(toId: string | null) {
    if (ctx.loading) throw coded('a collection is loading', 'ELOADING');
    if (!ctx.backendReady) throw coded('backend not ready', 'ENOTREADY');
    rt.bus.emit('collection.willSwitch', { fromId: ctx.activeId, toId: toId ?? '' });
    ctx.loading = true;
    slice.status = 'loading';
    try {
      await saver.flush({ reread: true });
    } catch (e) {
      console.error('[collections] save before switch failed', e);
    }
    saver.cancel();
    await teardown();
  }

  async function switchTo(id: string) {
    await beforeSwitch(id);
    failedLoad = null;
    const k = openDocument(id);
    if (!k) {
      await fallbackNew(id);
      return;
    }
    ctx.activeId = id;
    await writeManifest();
    await mediaOrRecover(id);
  }

  async function afterRemovingActive() {
    const next = loadable()[0];
    if (next) await switchTo(next.id);
    else {
      await beforeSwitch(null);
      failedLoad = null;
      await createAndLoad({ auto: true });
    }
  }

  // ---- commands ---------------------------------------------------------------------------

  rt.registerCommands('collections', {
    async load(id) {
      if (ctx.loading) throw coded('a collection is loading', 'ELOADING');
      const e = entry(id);
      if (!e || e.deleted) throw coded(`unknown collection: ${id}`, 'ENOENT');
      if (id === ctx.activeId) return;
      await switchTo(id);
    },
    async create(opts) {
      await beforeSwitch(null);
      failedLoad = null;
      return createAndLoad({ name: opts?.name });
    },
    async duplicate(id, name) {
      const e = entry(id);
      if (!e || e.deleted) throw coded(`unknown collection: ${id}`, 'ENOENT');
      if (id === ctx.activeId) await saver.flush({ reread: true });
      const text = store.read(id);
      if (text === null) throw coded('collection file is missing', 'ENOENT');
      const newId = randomUUID();
      await store.write(newId, text);
      const ne = addEntry(newId, name || suggestName(e.name, nameTaken), false);
      ne.operatingSystem = e.operatingSystem;
      await writeManifest();
      return newId;
    },
    async rename(id, name) {
      const e = entry(id);
      if (!e || e.deleted) throw coded(`unknown collection: ${id}`, 'ENOENT');
      e.name = name;
      e.modified = new Date().toISOString();
      e.needsRename = false;
      await writeManifest();
    },
    async remove(id) {
      const e = entry(id);
      if (!e || e.deleted) throw coded(`unknown collection: ${id}`, 'ENOENT');
      if (ctx.loading) throw coded('a collection is loading', 'ELOADING');
      if (id === ctx.activeId) {
        // flush while it is still the active one, then mark and move on
        await saver.flush({ reread: true });
        e.deleted = true;
        await afterRemovingActive();
        return;
      }
      e.deleted = true;
      await writeManifest();
    },
    async save() {
      await saver.flush();
    },
  });

  return {
    saver,
    openInitial() {
      ctx.store.ensureDir();
      manifest = store.readManifest() ?? { activeId: null, collections: [] };
      ctx.loading = true;
      slice.status = 'loading';
      let picked: ManifestEntry | undefined;
      const active = manifest.activeId ? entry(manifest.activeId) : undefined;
      if (active && !active.deleted && active.operatingSystem === os()) picked = active;
      else {
        picked = loadable().reduce<ManifestEntry | undefined>(
          (best, c) => (!best || c.modified > best.modified ? c : best),
          undefined,
        );
      }
      if (picked && openDocument(picked.id)) {
        ctx.activeId = picked.id;
        syncList();
        perf.mark('doc.loaded');
        return;
      }
      if (picked) failedLoad = picked.id;
      // nothing usable: a new (auto) collection, defaults are created once the backend is up
      const id = randomUUID();
      addEntry(id, suggestName(DEFAULT_COLLECTION_NAME, nameTaken), true);
      needsDefaults = true;
      install(CollectionDocument.empty(), id, null, 'new');
      void store.writeManifest({ ...manifest, activeId: id }).catch(e => console.error(e));
      syncList();
      perf.mark('doc.loaded');
    },
    async completeInitial() {
      const id = ctx.activeId;
      if (!id || !ctx.doc) return;
      try {
        await mediaOrRecover(id);
      } catch (e) {
        slice.status = 'error';
        ctx.loading = false;
        throw e;
      }
      if (manifest.activeId !== ctx.activeId) await writeManifest();
    },
    async shutdown() {
      try {
        await saver.flush({ reread: true });
      } catch (e) {
        console.error('[collections] final save failed', e);
      }
      saver.cancel();
      await store.flush();
    },
    releaseMedia,
  };
}
