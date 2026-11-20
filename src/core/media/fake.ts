// In-memory MediaBackend for unit tests and tooling (no OSN, no native code).
import type { CanvasId, SceneItemSettings, Transform } from '../../shared/contracts';
import type {
  BackendEvents,
  BackendProperty,
  BackendInfo,
  CanvasInfo,
  FilterSpec,
  ItemInfo,
  ItemRef,
  ItemSpec,
  MediaBackend,
  SourceHandleInfo,
  SourceSpec,
} from './backend';

interface FakeItem {
  ref: ItemRef;
  sourceId: string;
  settings: SceneItemSettings;
  transform: Transform;
}

// IEC 60268-18 fader law, as the OBS fader (IEC type) uses it; keeps tests meaningful for the
// deflection <-> db <-> mul mapping.
const IEC: [number, number, number][] = [
  // [db from, scale, offset] segments in ascending order
  [-70, 0.0025, 0],
  [-60, 0.005, 0.025],
  [-50, 0.0075, 0.075],
  [-40, 0.015, 0.15],
  [-30, 0.02, 0.3],
  [-20, 0.025, 0.5],
];
function deflectionFromDb(db: number): number {
  if (!(db > -Infinity) || db < -70) return 0;
  if (db >= 0) return 1;
  let seg = IEC[0];
  for (const s of IEC) if (db >= s[0]) seg = s;
  return (db - seg[0]) * seg[1] + seg[2];
}
function dbFromDeflection(d: number): number {
  if (d <= 0) return -Infinity;
  if (d >= 1) return 0;
  let seg = IEC[0];
  for (const s of IEC) if (d >= s[2]) seg = s;
  return (d - seg[2]) / seg[1] + seg[0];
}
function faderFromDb(db: number) {
  return { db, mul: db === -Infinity ? 0 : 10 ** (db / 20), deflection: deflectionFromDb(db) };
}
function faderFromMul(mul: number) {
  return faderFromDb(mul > 0 ? 20 * Math.log10(mul) : -Infinity);
}

type PropertyDef = (settings: Record<string, unknown>) => BackendProperty[];

const prop = (p: Partial<BackendProperty> & { name: string; type: number }): BackendProperty => ({
  description: p.name,
  longDescription: '',
  enabled: true,
  visible: true,
  value: undefined,
  ...p,
});

/** A few realistic property sets (dependent visibility like the OBS `modified` callbacks). */
const DEFAULT_PROPERTY_DEFS: Record<string, PropertyDef> = {
  image_source: s => [
    prop({
      name: 'file',
      type: 5,
      value: s.file ?? '',
      path: { type: 0, filter: 'Images (*.png *.jpg);;All Files (*.*)', defaultPath: '' },
    }),
    prop({ name: 'unload', type: 1, value: s.unload ?? false }),
  ],
  color_source: s => [
    prop({ name: 'color', type: 7, value: s.color ?? 4294967295 }),
    prop({
      name: 'width',
      type: 2,
      value: s.width ?? 400,
      number: { slider: false, min: 0, max: 4096, step: 1 },
    }),
  ],
  browser_source: s => [
    prop({ name: 'url', type: 4, value: s.url ?? '', text: { type: 0, infoType: 0 } }),
    prop({ name: 'fps_custom', type: 1, value: s.fps_custom ?? false }),
    prop({
      name: 'fps',
      type: 2,
      value: s.fps ?? 30,
      visible: s.fps_custom === true,
      number: { slider: false, min: 1, max: 60, step: 1 },
    }),
    prop({
      name: 'mode',
      type: 6,
      value: s.mode ?? 'a',
      list: {
        format: 3,
        items:
          s.fps_custom === true
            ? [
                { name: 'A', value: 'a' },
                { name: 'B', value: 'b' },
              ]
            : [{ name: 'A', value: 'a' }],
      },
    }),
    prop({ name: 'refreshnocache', type: 8 }),
  ],
  text_gdiplus: s => [
    prop({
      name: 'font',
      type: 9,
      value: { face: 'Arial', style: '', size: 36, flags: 0, path: s.custom_font ?? '' },
    }),
    prop({ name: 'text', type: 4, value: s.text ?? '', text: { type: 2, infoType: 0 } }),
  ],
};

export interface FakeBackend extends MediaBackend {
  /** Input types `sources.types()` returns. */
  typeList: string[];
  /** Property sets by source type, computed from the source's current settings. */
  propertyDefs: Record<string, PropertyDef>;
  /** Buttons pressed so far: `<sourceId>:<name>`. */
  pressed: string[];
  /** Number of `sources.getProperties` calls (to assert coalescing). */
  propertyReads: number;
  /** Everything the backend did, in order: `method:arg`. */
  calls: string[];
  sourceSet: Map<
    string,
    { spec: SourceSpec; info: SourceHandleInfo; settings: Record<string, unknown> }
  >;
  /** Items bottom-first, as the real backend keeps them. */
  sceneSet: Map<string, FakeItem[]>;
  displaySet: Map<string, { w: number; h: number; x: number; y: number }>;
  /** Source types for which `createMany` fails. */
  failTypes: Set<string>;
  meters: { enabled: boolean; ids: string[] };
  emitMeter(
    batch: { id: string; peak: number[]; magnitude: number[]; inputPeak: number[] }[],
  ): void;
  emit<K extends keyof BackendEvents>(e: K, p: BackendEvents[K]): void;
  /** Currently selected refs per scene. */
  selected: Map<string, ItemRef[]>;
  program: { sceneId: string | null; transitionId: string | null };
  initialized: boolean;
}

const AUDIO_TYPES = new Set([
  'wasapi_input_capture',
  'wasapi_output_capture',
  'browser_source',
  'ffmpeg_source',
  'dshow_input',
]);

export function createFakeBackend(): FakeBackend {
  const calls: string[] = [];
  let nextRef = 1;
  const listeners = new Map<string, Set<(p: never) => void>>();
  const meterCbs = new Set<(b: never) => void>();
  const faders = new Map<string, { db: number; deflection: number; mul: number }>();
  const canvases = new Map<CanvasId, CanvasInfo>();

  const self: FakeBackend = {
    calls,
    typeList: [
      'image_source',
      'color_source',
      'browser_source',
      'slideshow',
      'ffmpeg_source',
      'text_gdiplus',
      'monitor_capture',
      'window_capture',
      'game_capture',
      'dshow_input',
      'wasapi_input_capture',
      'wasapi_output_capture',
      'screen_capture',
    ],
    propertyDefs: { ...DEFAULT_PROPERTY_DEFS },
    pressed: [],
    propertyReads: 0,
    sourceSet: new Map(),
    sceneSet: new Map(),
    displaySet: new Map(),
    failTypes: new Set(),
    meters: { enabled: false, ids: [] },
    selected: new Map(),
    program: { sceneId: null, transitionId: null },
    initialized: false,
    info: { name: 'fake' },
    async init(): Promise<BackendInfo> {
      calls.push('init');
      self.initialized = true;
      return self.info;
    },
    async shutdown() {
      calls.push('shutdown');
      self.initialized = false;
    },
    on(e, cb) {
      let set = listeners.get(e);
      if (!set) listeners.set(e, (set = new Set()));
      set.add(cb as never);
      return () => set.delete(cb as never);
    },
    emit(e, p) {
      for (const l of listeners.get(e) ?? []) (l as (p: unknown) => void)(p);
    },
    emitMeter(batch) {
      for (const cb of meterCbs) (cb as (b: unknown) => void)(batch);
    },
    canvases: {
      async ensure(id) {
        calls.push(`canvases.ensure:${id}`);
        let c = canvases.get(id);
        if (!c) {
          c = {
            id,
            baseWidth: 1280,
            baseHeight: 720,
            outputWidth: 1280,
            outputHeight: 720,
            fpsNum: 30,
            fpsDen: 1,
          };
          canvases.set(id, c);
        }
        return { ...c };
      },
      async get(id) {
        const c = canvases.get(id);
        return c ? { ...c } : null;
      },
      async setBaseResolution(id, size) {
        calls.push(`canvases.setBaseResolution:${id}`);
        const c = canvases.get(id);
        if (c) {
          c.baseWidth = size.width;
          c.baseHeight = size.height;
        }
      },
      async destroy(id) {
        canvases.delete(id);
      },
    },
    sources: {
      async createMany(specs) {
        calls.push(`sources.createMany:${specs.length}`);
        const ok: SourceHandleInfo[] = [];
        const failed: string[] = [];
        for (const spec of specs) {
          if (self.failTypes.has(spec.type)) {
            failed.push(spec.id);
            continue;
          }
          const audio = AUDIO_TYPES.has(spec.type);
          const info: SourceHandleInfo = {
            id: spec.id,
            type: spec.type,
            width: audio && !spec.type.includes('browser') ? 0 : 1920,
            height: audio && !spec.type.includes('browser') ? 0 : 1080,
            configurable: true,
            audio,
            video: !spec.type.startsWith('wasapi'),
            async: false,
            doNotDuplicate: false,
            muted: spec.muted ?? false,
            volume: spec.volume ?? 1,
            audioMixers: 255,
            monitoring: spec.type === 'browser_source' ? 1 : 0,
            syncOffsetMs: spec.syncOffsetMs ?? 0,
          };
          self.sourceSet.set(spec.id, { spec, info, settings: { ...spec.settings } });
          ok.push(info);
        }
        return { ok, failed };
      },
      async remove(id) {
        calls.push(`sources.remove:${id}`);
        self.sourceSet.delete(id);
        faders.delete(id);
      },
      async getSettings(id, opts) {
        calls.push(`sources.getSettings:${id}${opts?.persist ? ':persist' : ''}`);
        return { ...(self.sourceSet.get(id)?.settings ?? {}) };
      },
      async updateSettings(id, patch) {
        calls.push(`sources.updateSettings:${id}`);
        const s = self.sourceSet.get(id);
        if (s) Object.assign(s.settings, patch);
      },
      async types() {
        return [...self.typeList];
      },
      async getProperties(id) {
        calls.push(`sources.getProperties:${id}`);
        self.propertyReads++;
        const src = self.sourceSet.get(id);
        if (!src) throw Object.assign(new Error(`backend: unknown source ${id}`), { code: 'ENOENT' });
        return structuredClone(self.propertyDefs[src.spec.type]?.(src.settings) ?? []);
      },
      async pressButton(id, name) {
        calls.push(`sources.pressButton:${id}:${name}`);
        self.pressed.push(`${id}:${name}`);
      },
      async getInfo(id) {
        return self.sourceSet.get(id)?.info ?? null;
      },
      async getSizes(ids) {
        const out: Record<string, { width: number; height: number }> = {};
        for (const id of ids) {
          const i = self.sourceSet.get(id)?.info;
          if (i) out[id] = { width: i.width, height: i.height };
        }
        return out;
      },
      async getFilters(id): Promise<FilterSpec[]> {
        return self.sourceSet.get(id)?.spec.filters ?? [];
      },
      async assignChannel(channel, id) {
        calls.push(`sources.assignChannel:${channel}:${id}`);
      },
    },
    scenes: {
      async create(id) {
        calls.push(`scenes.create:${id}`);
        self.sceneSet.set(id, []);
      },
      async remove(id) {
        calls.push(`scenes.remove:${id}`);
        self.sceneSet.delete(id);
      },
      async duplicateItems(from, to) {
        calls.push(`scenes.duplicateItems:${from}:${to}`);
        const items = self.sceneSet.get(from) ?? [];
        self.sceneSet.set(
          to,
          items.map(i => ({ ...structuredClone(i), ref: nextRef++ })),
        );
      },
      async addItems(sceneId, specs: ItemSpec[]) {
        calls.push(`scenes.addItems:${sceneId}:${specs.length}`);
        const list = self.sceneSet.get(sceneId);
        if (!list) throw new Error('no scene');
        const out: ItemInfo[] = [];
        for (const s of specs) {
          const item: FakeItem = {
            ref: nextRef++,
            sourceId: s.sourceId,
            settings: {
              visible: s.visible,
              locked: s.locked,
              streamVisible: s.streamVisible,
              recordingVisible: s.recordingVisible,
              scaleFilter: s.scaleFilter,
              blendingMode: s.blendingMode,
              blendingMethod: s.blendingMethod,
            },
            transform: structuredClone(s.transform),
          };
          list.push(item);
          out.push({ ref: item.ref, transform: structuredClone(item.transform) });
        }
        return out;
      },
      async removeItem(sceneId, ref) {
        calls.push(`scenes.removeItem:${sceneId}:${ref}`);
        const list = self.sceneSet.get(sceneId) ?? [];
        const i = list.findIndex(x => x.ref === ref);
        if (i >= 0) list.splice(i, 1);
      },
      async updateItem(sceneId, ref, patch) {
        calls.push(`scenes.updateItem:${sceneId}:${ref}`);
        const item = self.sceneSet.get(sceneId)?.find(x => x.ref === ref);
        if (!item) throw new Error('no item');
        const { transform, ...rest } = patch;
        Object.assign(item.settings, rest);
        if (transform) {
          const t = item.transform;
          Object.assign(t.position, transform.position);
          Object.assign(t.scale, transform.scale);
          Object.assign(t.crop, transform.crop);
          if (transform.rotation !== undefined) t.rotation = transform.rotation;
        }
        return { ref, transform: structuredClone(item.transform) };
      },
      async reorder(sceneId, refsTopFirst) {
        calls.push(`scenes.reorder:${sceneId}`);
        const list = self.sceneSet.get(sceneId);
        if (!list) return;
        const byRef = new Map(list.map(i => [i.ref, i]));
        const ordered = refsTopFirst
          .map(r => byRef.get(r))
          .filter((i): i is FakeItem => !!i)
          .reverse();
        list.splice(0, list.length, ...ordered);
      },
      async setSelected(sceneId, refs) {
        calls.push(`scenes.setSelected:${sceneId}:${refs.length}`);
        self.selected.set(sceneId, [...refs]);
      },
      async getItem(sceneId, ref) {
        const item = self.sceneSet.get(sceneId)?.find(x => x.ref === ref);
        return item ? { ref, transform: structuredClone(item.transform) } : null;
      },
    },
    transitions: {
      async create(spec) {
        calls.push(`transitions.create:${spec.id}`);
      },
      async remove(id) {
        calls.push(`transitions.remove:${id}`);
      },
      async switchScene(toSceneId, transitionId) {
        calls.push(`transitions.switchScene:${toSceneId}`);
        self.program = { sceneId: toSceneId, transitionId };
      },
    },
    audio: {
      async attach(id, mul) {
        calls.push(`audio.attach:${id}`);
        const info = self.sourceSet.get(id)?.info;
        const f = faders.get(id) ?? faderFromMul(mul ?? info?.volume ?? 1);
        faders.set(id, f);
        return { ...f };
      },
      async detach(id) {
        faders.delete(id);
      },
      async setMuted(id, muted) {
        calls.push(`audio.setMuted:${id}:${muted}`);
        const s = self.sourceSet.get(id);
        if (s) s.info.muted = muted;
      },
      async setFader(id, patch) {
        calls.push(`audio.setFader:${id}`);
        let f = faders.get(id) ?? faderFromMul(1);
        if (patch.deflection !== undefined) f = faderFromDb(dbFromDeflection(patch.deflection));
        else if (patch.mul !== undefined) f = faderFromMul(patch.mul);
        else if (patch.db !== undefined) f = faderFromDb(patch.db);
        faders.set(id, f);
        return { ...f };
      },
      async setSettings(id, patch) {
        calls.push(`audio.setSettings:${id}`);
        const s = self.sourceSet.get(id);
        if (!s) return;
        if (patch.mixers !== undefined) s.info.audioMixers = patch.mixers;
        if (patch.monitoring !== undefined) s.info.monitoring = patch.monitoring;
        if (patch.syncOffsetMs !== undefined) s.info.syncOffsetMs = patch.syncOffsetMs;
      },
      async setMetersEnabled(enabled, ids) {
        calls.push(`audio.setMetersEnabled:${enabled}:${ids.length}`);
        self.meters = { enabled, ids: [...ids] };
      },
      onMeterData(cb) {
        meterCbs.add(cb as never);
        return () => meterCbs.delete(cb as never);
      },
    },
    displays: {
      async create(spec) {
        calls.push(`displays.create:${spec.id}`);
        self.displaySet.set(spec.id, { w: 0, h: 0, x: 0, y: 0 });
      },
      async moveResize(id, r) {
        calls.push(`displays.moveResize:${id}:${r.width}x${r.height}`);
        const d = self.displaySet.get(id);
        if (d) Object.assign(d, { x: r.x, y: r.y, w: r.width, h: r.height });
      },
      async setDrawUi() {},
      async setGuidelines() {},
      async setPadding() {},
      async getOutputRegion(id) {
        const d = self.displaySet.get(id);
        return { x: 0, y: 0, width: d?.w ?? 0, height: d?.h ?? 0 };
      },
      async destroy(id) {
        calls.push(`displays.destroy:${id}`);
        self.displaySet.delete(id);
      },
    },
  };
  return self;
}
