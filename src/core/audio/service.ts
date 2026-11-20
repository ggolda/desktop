// Audio: slice `audio`, commands `audio.*`, and the meters path (m1-design 8).
import type { AudioPatch, FaderPatch } from '../../shared/contracts';
import type { SourceRec } from '../collections/document';
import { MONITORING_TYPES } from '../collections/format';
import { type Ctx, assignDeep, audioView, coded } from '../context';
import type { SourceHandleInfo } from '../media/backend';
import { createMeters } from './meters';

export interface AudioApi {
  /** Applies audio defaults/settings of a freshly created source, attaches its fader, fills the slice. */
  onSourceReady(rec: SourceRec, info: SourceHandleInfo): Promise<void>;
  onSourceRemoved(id: string): Promise<void>;
  /** Recomputes `mixer` for the active scene; resyncs the volmeters when they are on. */
  recomputeMixer(): void;
  /** Forget the previous collection. */
  reset(): Promise<void>;
  meters: {
    sample(): Float32Array;
    onActiveChange(active: boolean): void;
    /** Called when the backend became ready, so meters requested earlier can start. */
    backendReady(): void;
  };
  /** Stops the volmeters now (shutdown). */
  stopMeters(): Promise<void>;
}

export function createAudioService(ctx: Ctx): AudioApi {
  const { rt, backend } = ctx;
  const slice = ctx.slices.audio;
  const meters = createMeters(ctx);

  function rec(id: string): SourceRec {
    const r = ctx.requireDoc().source(id);
    if (!r || r.status !== 'ready' || !r.hasAudio)
      throw coded(`unknown audio source: ${id}`, 'ENOENT');
    return r;
  }

  function setEntry(r: SourceRec, fader: { db: number; deflection: number; mul: number }) {
    const view = audioView(r, fader);
    const cur = slice.sources[r.id];
    if (cur)
      assignDeep(
        cur as unknown as Record<string, unknown>,
        view as unknown as Record<string, unknown>,
      );
    else slice.sources[r.id] = view;
  }

  async function onSourceReady(r: SourceRec, info: SourceHandleInfo) {
    const patch: {
      forceMono?: boolean;
      syncOffsetMs?: number;
      mixers?: number;
      monitoring?: number;
    } = {};
    if (r.audioMixers !== info.audioMixers) patch.mixers = r.audioMixers;
    if (r.monitoring !== info.monitoring) patch.monitoring = r.monitoring;
    if (r.forceMono) patch.forceMono = true;
    if (r.syncOffsetMs !== info.syncOffsetMs) patch.syncOffsetMs = r.syncOffsetMs;
    if (Object.keys(patch).length) await backend.audio.setSettings(r.id, patch);
    const fader = await backend.audio.attach(r.id, r.volume);
    setEntry(r, fader);
    recomputeMixer();
  }

  async function onSourceRemoved(id: string) {
    if (slice.sources[id]) {
      await backend.audio.detach(id);
      delete slice.sources[id];
    }
  }

  function mixerIds(): string[] {
    const doc = ctx.doc;
    if (!doc) return [];
    const ids: string[] = [];
    const add = (id: string) => {
      if (!ids.includes(id)) ids.push(id);
    };
    for (const s of doc.sources)
      if (s.channel !== undefined && s.status === 'ready' && s.hasAudio) add(s.id);
    const seen = new Set<string>();
    const walk = (sceneId: string) => {
      if (seen.has(sceneId)) return;
      seen.add(sceneId);
      const sc = doc.scene(sceneId);
      if (!sc) return;
      for (const n of sc.nodes) {
        if (n.kind !== 'item' || n.hidden) continue;
        if (doc.scene(n.sourceId)) walk(n.sourceId);
        else {
          const s = doc.source(n.sourceId);
          if (s && s.status === 'ready' && s.hasAudio) add(s.id);
        }
      }
    };
    if (doc.activeSceneId) walk(doc.activeSceneId);
    return ids;
  }

  function recomputeMixer() {
    const ids = mixerIds();
    const cur = slice.mixer.ids;
    if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return;
    slice.mixer.ids = ids;
    slice.mixer.rev++;
    meters.resync(ids);
  }

  function patchEntry(id: string, values: Record<string, unknown>) {
    const cur = slice.sources[id];
    if (cur)
      for (const [k, v] of Object.entries(values))
        (cur as unknown as Record<string, unknown>)[k] = v;
  }

  rt.registerCommands('audio', {
    async setMuted(id, muted) {
      ctx.requireMedia();
      const r = rec(id);
      await backend.audio.setMuted(id, muted);
      r.muted = muted;
      patchEntry(id, { muted });
      ctx.touch.source(id);
    },
    async setFader(id, patch: FaderPatch) {
      ctx.requireMedia();
      const r = rec(id);
      const keys = (['deflection', 'db', 'mul'] as const).filter(k => patch[k] !== undefined);
      if (keys.length !== 1)
        throw coded('setFader takes exactly one of deflection, db, mul', 'EINVAL');
      const fader = await backend.audio.setFader(id, { [keys[0]]: patch[keys[0]] });
      r.volume = fader.mul;
      const v = audioView(r, fader);
      patchEntry(id, { mul: v.mul, db: v.db, deflection: v.deflection });
      ctx.touch.source(id);
    },
    async setSettings(id, patch: AudioPatch) {
      ctx.requireMedia();
      const r = rec(id);
      const b: {
        forceMono?: boolean;
        syncOffsetMs?: number;
        mixers?: number;
        monitoring?: number;
      } = {};
      if (patch.forceMono !== undefined) b.forceMono = patch.forceMono;
      if (patch.syncOffsetMs !== undefined) b.syncOffsetMs = Math.round(patch.syncOffsetMs);
      if (patch.mixers !== undefined) b.mixers = patch.mixers & 0xff;
      if (patch.monitoring !== undefined) {
        const m = MONITORING_TYPES.indexOf(patch.monitoring);
        if (m < 0) throw coded('bad monitoring type', 'EINVAL');
        b.monitoring = m;
      }
      if (Object.keys(b).length) await backend.audio.setSettings(id, b);
      if (b.forceMono !== undefined) r.forceMono = b.forceMono;
      if (b.syncOffsetMs !== undefined) r.syncOffsetMs = b.syncOffsetMs;
      if (b.mixers !== undefined) r.audioMixers = b.mixers;
      if (b.monitoring !== undefined) r.monitoring = b.monitoring;
      if (patch.hidden !== undefined) r.mixerHidden = patch.hidden;
      patchEntry(id, {
        ...(b.forceMono !== undefined && { forceMono: b.forceMono }),
        ...(b.syncOffsetMs !== undefined && { syncOffsetMs: b.syncOffsetMs }),
        ...(b.mixers !== undefined && { mixers: b.mixers }),
        ...(patch.monitoring !== undefined && { monitoring: patch.monitoring }),
        ...(patch.hidden !== undefined && { hidden: patch.hidden }),
      });
      ctx.touch.source(id);
    },
    unhideAll() {
      const doc = ctx.requireDoc();
      for (const r of doc.sources) {
        if (!r.mixerHidden) continue;
        r.mixerHidden = false;
        patchEntry(r.id, { hidden: false });
        ctx.touch.source(r.id);
      }
    },
  });

  return {
    onSourceReady,
    onSourceRemoved,
    recomputeMixer,
    async reset() {
      await meters.pause();
      for (const id of Object.keys(slice.sources)) {
        await backend.audio.detach(id).catch(() => undefined);
        delete slice.sources[id];
      }
      slice.mixer.ids = [];
      slice.mixer.rev++;
    },
    meters: {
      sample: meters.sample,
      onActiveChange: meters.onActiveChange,
      backendReady: meters.backendReady,
    },
    stopMeters: meters.stop,
  };
}
