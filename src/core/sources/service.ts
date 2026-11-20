// Sources: slice `sources`, commands `sources.*`, backend flag/size updates.
import { randomUUID } from 'node:crypto';
import type { SourceCreateSpec, SourceTypeInfo } from '../../shared/contracts';
import type { SourceRec } from '../collections/document';
import { newSourceRec } from '../collections/document';
import { WINDOWS_SOURCE_TYPES, suggestName } from '../collections/format';
import {
  type Ctx,
  type Services,
  assignDeep,
  coded,
  sceneSourceInfo,
  sourceInfo,
} from '../context';
import type { SourceHandleInfo, SourceSpec } from '../media/backend';
import { defaultsFor } from './defaults';

export interface SourcesApi {
  /** Writes the record (or scene) into the `sources` slice. */
  sync(id: string): void;
  syncAll(): void;
  /** Applies what the backend reported about a created source. Returns the audio patch to apply. */
  applyInfo(rec: SourceRec, info: SourceHandleInfo): void;
  /** Builds the backend spec of a record (applies the load-time fixes E1/E2/E5). */
  specOf(rec: SourceRec): SourceSpec;
  create(spec: SourceCreateSpec): Promise<string>;
  remove(id: string): Promise<void>;
  /** Forget every record of the previous collection. */
  reset(): void;
}

export function createSourcesService(ctx: Ctx, svc: () => Services): SourcesApi {
  const { rt, backend } = ctx;
  const slice = ctx.slices.sources;

  function sync(id: string) {
    const doc = ctx.doc;
    if (!doc) return;
    const rec = doc.source(id);
    const scene = doc.scene(id);
    const info = rec
      ? rec.status === 'unavailable' || rec.status === 'failed'
        ? null
        : sourceInfo(rec)
      : scene
        ? sceneSourceInfo(scene, !ctx.loading)
        : null;
    if (!info) {
      if (id in slice.sources) delete slice.sources[id];
      return;
    }
    const cur = slice.sources[id];
    if (cur)
      assignDeep(
        cur as unknown as Record<string, unknown>,
        info as unknown as Record<string, unknown>,
      );
    else slice.sources[id] = info;
  }

  function syncAll() {
    const doc = ctx.doc;
    const next: Record<string, unknown> = {};
    if (doc) {
      for (const s of doc.sources) {
        if (s.status === 'unavailable' || s.status === 'failed') continue;
        next[s.id] = sourceInfo(s);
      }
      for (const sc of doc.scenes) next[sc.id] = sceneSourceInfo(sc, !ctx.loading);
    }
    for (const id of Object.keys(slice.sources)) if (!(id in next)) delete slice.sources[id];
    for (const [id, info] of Object.entries(next)) {
      const cur = slice.sources[id];
      if (cur)
        assignDeep(cur as unknown as Record<string, unknown>, info as Record<string, unknown>);
      else slice.sources[id] = info as never;
    }
  }

  function applyInfo(rec: SourceRec, info: SourceHandleInfo) {
    rec.status = 'ready';
    rec.hasVideo = info.video;
    rec.width = info.width;
    rec.height = info.height;
    rec.configurable = info.configurable;
    if (info.audio) rec.hasAudio = true;
    if (rec.hasAudio && rec.audioDefaultsPending) {
      rec.forceMono = false;
      rec.syncOffsetMs = info.syncOffsetMs;
      rec.audioMixers = 255;
      rec.monitoring = info.monitoring;
      rec.audioDefaultsPending = false;
    }
  }

  function specOf(rec: SourceRec): SourceSpec {
    let settings = rec.createSettings;
    // E1: the media flag is never restored. E2: hw decoding off for old ffmpeg sources.
    if (rec.type === 'ffmpeg_source') {
      const old = ctx.doc !== null && ctx.doc.schemaVersion < 4;
      if (settings.is_media_flag || (old && settings.hw_decode === undefined)) {
        settings = { ...settings, is_media_flag: false, ...(old ? { hw_decode: false } : {}) };
      }
    }
    const filters = ((rec.filtersRaw?.items ?? []) as Record<string, unknown>[])
      .filter(f => f && f.type !== 'face_mask_filter') // E5
      .map(f => ({
        name: String(f.name),
        type: String(f.type),
        settings: (f.settings ?? {}) as Record<string, unknown>,
        enabled: f.enabled !== false,
      }));
    return {
      id: rec.id,
      type: rec.type,
      settings,
      muted: rec.muted,
      volume: rec.volume,
      syncOffsetMs: rec.syncOffsetMs,
      deinterlaceMode: rec.deinterlaceMode,
      deinterlaceFieldOrder: rec.deinterlaceFieldOrder,
      filters,
    };
  }

  function nameTaken(name: string) {
    const doc = ctx.doc;
    if (!doc) return false;
    return doc.sources.some(s => s.name === name) || doc.scenes.some(s => s.name === name);
  }

  async function create(spec: SourceCreateSpec): Promise<string> {
    ctx.requireMedia();
    const doc = ctx.requireDoc();
    if (!WINDOWS_SOURCE_TYPES.includes(spec.type)) {
      throw coded(`unsupported source type: ${spec.type}`, 'EUNSUPPORTED');
    }
    const id = spec.id ?? `${spec.type}_${randomUUID()}`;
    if (doc.source(id) || doc.scene(id)) throw coded(`source exists: ${id}`, 'EEXIST');
    const rec = newSourceRec({
      id,
      name: spec.name,
      type: spec.type,
      settings: {
        ...defaultsFor(spec.type, spec.name, {
          userData: ctx.userData,
          sharedResources: ctx.sharedResources,
        }),
        ...(spec.settings ?? {}),
      },
      channel: spec.channel,
      propertiesManager: spec.propertiesManager,
      propertiesManagerSettings: spec.propertiesManagerSettings,
    });
    const { ok, failed } = await backend.sources.createMany([specOf(rec)]);
    if (failed.length || ok.length === 0) {
      throw coded(`the backend could not create source ${spec.type}`, 'EFAILED');
    }
    doc.addSource(rec);
    applyInfo(rec, ok[0]);
    if (rec.channel !== undefined) await backend.sources.assignChannel(rec.channel, rec.id);
    if (rec.hasAudio) await svc().audio.onSourceReady(rec, ok[0]);
    sync(rec.id);
    ctx.touch.source(rec.id);
    ctx.touch.structure();
    rt.bus.emit('source.added', { id: rec.id, type: rec.type });
    return rec.id;
  }

  async function remove(id: string): Promise<void> {
    ctx.requireMedia();
    const doc = ctx.requireDoc();
    if (doc.scene(id)) return svc().scenes.remove(id);
    const rec = doc.source(id);
    if (!rec) throw coded(`unknown source: ${id}`, 'ENOENT');
    await svc().scenes.removeItemsOfSource(id);
    if (rec.status === 'ready') {
      await svc().audio.onSourceRemoved(id);
      if (rec.channel !== undefined) await backend.sources.assignChannel(rec.channel, null);
      await backend.sources.remove(id);
    }
    doc.removeSource(id);
    delete slice.sources[id];
    svc().audio.recomputeMixer();
    ctx.touch.structure();
    rt.bus.emit('source.removed', { id, type: rec.type });
  }

  // source flags/size come from the backend, coalesced there
  backend.on('source-changed', e => {
    const rec = ctx.doc?.source(e.id);
    if (!rec || rec.status !== 'ready') return;
    rec.width = e.width;
    rec.height = e.height;
    rec.hasVideo = e.video;
    if (e.audio && !rec.hasAudio) rec.hasAudio = true;
    sync(rec.id);
  });

  rt.registerCommands('sources', {
    create: spec => create(spec),
    remove: id => remove(id),
    rename(id, name) {
      const doc = ctx.requireDoc();
      if (doc.scene(id)) return svc().scenes.rename(id, name);
      const rec = doc.source(id);
      if (!rec || rec.status === 'unavailable' || rec.status === 'failed') {
        throw coded(`unknown source: ${id}`, 'ENOENT');
      }
      rec.name = name;
      sync(id);
      ctx.touch.source(id);
      rt.bus.emit('source.updated', { id });
    },
    async getSettings(id) {
      ctx.requireMedia();
      const rec = ctx.requireDoc().source(id);
      if (!rec || rec.status !== 'ready') throw coded(`unknown source: ${id}`, 'ENOENT');
      return backend.sources.getSettings(id);
    },
    async updateSettings(id, patch) {
      ctx.requireMedia();
      const rec = ctx.requireDoc().source(id);
      if (!rec || rec.status !== 'ready') throw coded(`unknown source: ${id}`, 'ENOENT');
      await backend.sources.updateSettings(id, patch);
      ctx.touch.source(id);
      rt.bus.emit('source.updated', { id });
    },
    suggestName: base => suggestName(base, nameTaken),
    async types(): Promise<SourceTypeInfo[]> {
      ctx.requireMedia();
      const have = new Set(await backend.sources.types());
      return WINDOWS_SOURCE_TYPES.filter(t => t !== 'scene').map(id => ({
        id,
        available: have.has(id),
      }));
    },
  });

  return {
    sync,
    syncAll,
    applyInfo,
    specOf,
    create,
    remove,
    reset() {
      for (const id of Object.keys(slice.sources)) delete slice.sources[id];
    },
  };
}
