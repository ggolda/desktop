// Inputs: bulk creation, settings, filters, channels, and the source size/flags callback.
import type { BackendProperty, MediaBackend, SourceHandleInfo } from '../backend';
import {
  OUTPUT_ASYNC,
  OUTPUT_AUDIO,
  OUTPUT_DO_NOT_DUPLICATE,
  OUTPUT_VIDEO,
  msToTimeSpec,
  timeSpecToMs,
} from './enums';
import { type ObsState, missing } from './state';
import type { OsnInput, OsnProperty } from './types';

const flagsOf = (f: number) => ({
  audio: !!(f & OUTPUT_AUDIO),
  video: !!(f & OUTPUT_VIDEO),
  async: !!(f & OUTPUT_ASYNC),
  doNotDuplicate: !!(f & OUTPUT_DO_NOT_DUPLICATE),
});

/** EPropertyType values the adapter needs details for. */
const P_INT = 2;
const P_FLOAT = 3;
const P_TEXT = 4;
const P_PATH = 5;
const P_LIST = 6;
const P_FONT = 9;
const P_EDITABLE_LIST = 10;
const N_SLIDER = 1;

/** Reads every field of every property once (each getter is an IPC round trip to obs64). */
function readProperty(p: OsnProperty, input: OsnInput): BackendProperty {
  const out: BackendProperty = {
    name: p.name,
    description: p.description,
    longDescription: p.longDescription,
    enabled: p.enabled,
    visible: p.visible,
    type: p.type,
    value: undefined,
  };
  switch (p.type) {
    case P_INT:
    case P_FLOAT: {
      const d = p.details;
      out.number = { slider: d.type === N_SLIDER, min: d.min, max: d.max, step: d.step };
      break;
    }
    case P_TEXT:
      out.text = { type: p.details.type, infoType: p.details.infoType };
      break;
    case P_PATH:
      out.path = {
        type: p.details.type,
        filter: p.details.filter ?? '',
        defaultPath: p.details.defaultPath ?? '',
      };
      break;
    case P_LIST:
      out.list = {
        format: p.details.format,
        items: (p.details.items ?? []).map((it: { name: string; value: string | number }) => ({
          name: it.name,
          value: it.value,
        })),
      };
      break;
    case P_EDITABLE_LIST:
      out.editable = {
        type: p.details.type,
        filter: p.details.filter ?? '',
        defaultPath: p.details.defaultPath ?? '',
      };
      break;
  }
  let value: unknown = p.value;
  if (p.type === P_FONT) {
    // legacy: the Google font path is the app-level `custom_font` setting
    const custom = input.settings.custom_font;
    value = { ...(value as object), path: typeof custom === 'string' ? custom : '' };
  }
  out.value = value;
  return out;
}

export function createSources(st: ObsState): MediaBackend['sources'] {
  const input = (id: string): OsnInput => {
    const i = st.inputs.get(id);
    if (!i) throw missing('source', id);
    return i;
  };

  // One global callback: only real changes are emitted (size, audio/video flags).
  const seen = new Map<string, string>();
  let callbackBound = false;
  function bindCallback() {
    if (callbackBound) return;
    callbackBound = true;
    st.osn.NodeObs.RegisterSourceCallback(objs => {
      for (const o of objs) {
        if (!st.inputs.has(o.name)) continue; // transitions and other internals
        const key = `${o.width}x${o.height}:${o.flags}`;
        if (seen.get(o.name) === key) continue;
        seen.set(o.name, key);
        st.emit('source-changed', { id: o.name, width: o.width, height: o.height, ...flagsOf(o.flags) });
      }
    });
  }

  return {
    async createMany(specs) {
      bindCallback();
      if (specs.length === 0) return { ok: [], failed: [] };
      const made = st.osn.createSources(
        specs.map(s => ({
          name: s.id,
          type: s.type,
          muted: s.muted ?? false,
          settings: s.settings,
          volume: s.volume ?? 1,
          syncOffset: msToTimeSpec(s.syncOffsetMs ?? 0),
          deinterlaceMode: s.deinterlaceMode ?? 0,
          deinterlaceFieldOrder: s.deinterlaceFieldOrder ?? 0,
          filters: (s.filters ?? []).map(f => ({
            name: f.name,
            type: f.type,
            settings: f.settings,
            enabled: f.enabled,
          })),
        })),
      );
      const byName = new Map<string, OsnInput>();
      for (const i of made) byName.set(i.name, i);
      const ok: SourceHandleInfo[] = [];
      const failed: string[] = [];
      const createdIds = specs.filter(s => byName.has(s.id)).map(s => s.id);
      const sizes = new Map(
        (createdIds.length ? st.osn.getSourcesSize(createdIds) : []).map(s => [s.name, s]),
      );
      for (const spec of specs) {
        const i = byName.get(spec.id);
        if (!i) {
          failed.push(spec.id);
          continue;
        }
        st.inputs.set(spec.id, i);
        const sz = sizes.get(spec.id);
        const flags = flagsOf(sz?.outputFlags ?? i.outputFlags);
        const info: SourceHandleInfo = {
          id: spec.id,
          type: spec.type,
          width: sz?.width ?? 0,
          height: sz?.height ?? 0,
          configurable: i.configurable,
          ...flags,
          muted: spec.muted ?? false,
          volume: spec.volume ?? 1,
          audioMixers: 255,
          monitoring: 0,
          syncOffsetMs: spec.syncOffsetMs ?? 0,
        };
        if (flags.audio) {
          info.muted = i.muted;
          info.audioMixers = i.audioMixers;
          info.monitoring = i.monitoringType;
          info.syncOffsetMs = timeSpecToMs(i.syncOffset);
        }
        seen.set(spec.id, `${info.width}x${info.height}:`);
        ok.push(info);
      }
      return { ok, failed };
    },
    async remove(id) {
      const i = st.inputs.get(id);
      if (!i) return;
      st.inputs.delete(id);
      seen.delete(id);
      i.release();
    },
    async getSettings(id, opts) {
      const i = input(id);
      if (opts?.persist) i.save();
      return i.settings;
    },
    async updateSettings(id, patch) {
      input(id).update(patch);
    },
    async types() {
      return st.osn.InputFactory.types();
    },
    async getProperties(id) {
      const i = input(id);
      const props = i.properties;
      if (!props || !props.count()) return [];
      const out: BackendProperty[] = [];
      for (let p = props.first(); p; p = p.next()) out.push(readProperty(p, i));
      return out;
    },
    async pressButton(id, name) {
      const i = input(id);
      const p = i.properties?.get(name);
      if (!p?.buttonClicked) throw missing('property', name);
      p.buttonClicked(i);
    },
    async getInfo(id) {
      const i = st.inputs.get(id);
      if (!i) return null;
      const sz = st.osn.getSourcesSize([id])[0];
      const flags = flagsOf(sz?.outputFlags ?? i.outputFlags);
      return {
        id,
        type: '',
        width: sz?.width ?? 0,
        height: sz?.height ?? 0,
        configurable: i.configurable,
        ...flags,
        muted: i.muted,
        volume: 1,
        audioMixers: flags.audio ? i.audioMixers : 255,
        monitoring: flags.audio ? i.monitoringType : 0,
        syncOffsetMs: flags.audio ? timeSpecToMs(i.syncOffset) : 0,
      };
    },
    async getSizes(ids) {
      const known = ids.filter(id => st.inputs.has(id));
      const out: Record<string, { width: number; height: number }> = {};
      if (!known.length) return out;
      for (const s of st.osn.getSourcesSize(known)) out[s.name] = { width: s.width, height: s.height };
      return out;
    },
    async getFilters(id) {
      return input(id).filters.map(f => ({
        name: f.name,
        type: f.id,
        settings: f.settings,
        enabled: f.enabled,
      }));
    },
    async assignChannel(channel, id) {
      st.osn.Global.setOutputSource(channel, id === null ? null : input(id));
    },
  };
}
