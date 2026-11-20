// Composition root of the core domain: slices, services, commands (m1-design 5). Works with any
// MediaBackend, so tests run it on the fake backend without OBS or Electron.
import type { CoreContract } from '../shared/contracts';
import { createAudioService } from './audio/service';
import { CollectionStore } from './collections/store';
import { createCollections } from './collections/service';
import { type Ctx, type Services, type Slices, coded } from './context';
import { createDialogs } from './dialogs/service';
import { sharedResourcesDir } from './sources/defaults';
import { createDisplays } from './display/service';
import { createProperties } from './properties/service';
import { registerEditor } from './editor/service';
import type { MainRpc } from './main-rpc';
import type { MediaBackend } from './media/backend';
import { type Perf, instrument } from './perf';
import type { Runtime } from './runtime/runtime';
import { createSelection } from './scenes/selection';
import { createScenesService } from './scenes/service';
import { createSourcesService } from './sources/service';
import { createTransitions } from './transitions/service';

export interface Core {
  ctx: Ctx;
  services: Services;
  /** Phase A: read the manifest and the active collection (no backend needed). */
  openInitial(): void;
  /** Backend init (blocks on OSN). Resolves with the backend info. */
  initBackend(opts: { appDataPath: string; version: string; installPath: string }): Promise<void>;
  /** Phase B of the startup collection. */
  loadInitial(): Promise<void>;
  /** Clean shutdown, in the documented order. */
  shutdown(): Promise<void>;
}

export function createCore(opts: {
  rt: Runtime<CoreContract>;
  backend: MediaBackend;
  userData: string;
  /** App root (`app.getAppPath()`), locates `shared-resources`. Default: the working directory. */
  appPath?: string;
  mainRpc: MainRpc;
  perf: Perf;
  store?: CollectionStore;
}): Core {
  const { rt, perf } = opts;
  const backend = instrument(opts.backend, perf);

  const slices: Slices = {
    collections: rt.defineSlice('collections', {
      status: 'idle',
      activeId: null,
      collections: [],
      warnings: [],
    }),
    scenes: rt.defineSlice('scenes', { activeSceneId: null, scenes: [] }),
    selection: rt.defineSlice('selection', { sceneId: null, ids: [], lastId: null }),
    canvases: rt.defineSlice('canvases', {}),
    sources: rt.defineSlice('sources', { sources: {} }),
    audio: rt.defineSlice('audio', { sources: {}, mixer: { rev: 0, ids: [] } }),
  };

  // eslint-disable-next-line prefer-const
  let services: Services;
  const svc = () => services;

  const ctx: Ctx = {
    rt,
    backend,
    perf,
    userData: opts.userData,
    sharedResources: sharedResourcesDir(opts.appPath ?? process.cwd()),
    store: opts.store ?? new CollectionStore(opts.userData),
    slices,
    doc: null,
    loading: false,
    backendReady: false,
    activeId: null,
    saveBlocked: false,
    touch: {
      source(id) {
        ctx.doc?.touchSource(id);
        svc().collections.saver.schedule();
      },
      scene(id) {
        ctx.doc?.touchScene(id);
        svc().collections.saver.schedule();
      },
      item(id) {
        ctx.doc?.touchItem(id);
        svc().collections.saver.schedule();
      },
      transitions() {
        ctx.doc?.touchTransitions();
        svc().collections.saver.schedule();
      },
      structure() {
        ctx.doc?.touchStructure();
        svc().collections.saver.schedule();
      },
    },
    requireMedia() {
      if (!ctx.backendReady) throw coded('backend not ready', 'ENOTREADY');
      if (ctx.loading) throw coded('a collection is loading', 'ELOADING');
    },
    requireDoc() {
      if (!ctx.doc) throw coded('no collection is open', 'ENOTREADY');
      return ctx.doc;
    },
  };

  const sources = createSourcesService(ctx, svc);
  const audio = createAudioService(ctx);
  const selection = createSelection(ctx);
  const transitions = createTransitions(ctx);
  const scenes = createScenesService(ctx, svc);
  const display = createDisplays(ctx, opts.mainRpc);
  const properties = createProperties(ctx);
  // collections registers last: it uses all of the above
  services = {
    sources,
    audio,
    selection,
    transitions,
    scenes,
    display,
    properties,
  } as Services;
  services.dialogs = createDialogs(ctx, svc, opts.mainRpc);
  services.collections = createCollections(ctx, svc);
  registerEditor(ctx);

  return {
    ctx,
    services,
    openInitial: () => services.collections.openInitial(),
    async initBackend(o) {
      await backend.init(o);
      ctx.backendReady = true;
      audio.meters.backendReady();
    },
    loadInitial: () => services.collections.completeInitial(),
    async shutdown() {
      // order: meters -> displays -> collections flush (+ settings re-read) -> release -> backend
      perf.mark('shutdown.start');
      await services.dialogs.closeAll().catch(e => console.error('[shutdown] dialogs', e));
      await audio.stopMeters().catch(e => console.error('[shutdown] meters', e));
      await display.destroyAll().catch(e => console.error('[shutdown] displays', e));
      perf.mark('shutdown.displays');
      await services.collections.shutdown();
      perf.mark('shutdown.saved');
      if (ctx.backendReady) {
        await services.collections
          .releaseMedia()
          .catch(e => console.error('[shutdown] release', e));
        perf.mark('shutdown.released');
        await backend.shutdown().catch(e => console.error('[shutdown] backend', e));
        ctx.backendReady = false;
        perf.mark('shutdown.backend');
      }
    },
  };
}
