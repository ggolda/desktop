import type {
  AudioSourceState,
  AudioState,
  CanvasState,
  CoreContract,
  DialogOpenRequest,
  DialogRef,
  DialogState,
  DisplayState,
  MoveDestination,
  PickPathResult,
  PropertiesState,
  Property,
  SceneItemNode,
  SceneNode,
  ScenesState,
  SelectionState,
  SourceInfo,
} from '@/shared/contracts';
import type { ClientMessage, CoreStatus, PatchOp, ServerMessage } from '@/shared/protocol';
import { createClient, type ClientTransport, type CoreClient } from '@/ui/core/client';
import { propertiesTitle } from '@/ui/source-types';
import {
  applyModified,
  buildCatalogue,
  buildDialogState,
  propertySetFor,
  type FakeWorld,
} from './fake-dialogs';

/**
 * In-memory implementation of the M1 contracts for UI development and tests (no Electron, no OBS).
 * It speaks the real window<->core protocol (sub/patch/call/meters-on...), so the real `createClient`
 * is used on top of it. It is not a model of core behavior: only what the editor UI needs.
 * Dev-only: it uses a timer for synthetic meters, but only while a window has meters on.
 */

type AnyRecord = Record<string, unknown>;

export interface FakeCoreOptions {
  scenes?: number;
  sources?: number;
  audioSources?: number;
  /** Generate synthetic meter frames while meters are on (default true; tests drive them by hand). */
  autoMeters?: boolean;
  intervalMs?: number;
  /** Catalogue shows Reactive Source like legacy (M1 hides it). */
  legacyCatalogue?: boolean;
}

export type FakeDialogEvent =
  { type: 'open'; state: DialogState } | { type: 'close'; dialogId: string };

export interface FakeCall {
  target: string;
  method: string;
  args: unknown[];
}

export interface FakeCore {
  /** The window side of the port: pass to `createClient`. */
  transport: ClientTransport;
  /** Client built on the transport (state wrapped by `makeState`, e.g. Vue's `reactive`). */
  connect(makeState?: (v: object) => object): CoreClient<CoreContract>;
  /** Raw slice values by name (what core would hold). */
  slices: Map<string, object>;
  /** Every command received, in order. */
  calls: FakeCall[];
  /** Messages received from the window. */
  sent: ClientMessage[];
  /** Dialog contracts: what `dialogs.open` does (also callable from tests / the dev page). */
  openDialog(request: DialogOpenRequest): DialogRef;
  /** Called when a dialog opens (replaces the previous one) or closes. */
  onDialogEvent(cb: (e: FakeDialogEvent) => void): () => void;
  /** Adds a source of `type` (not to a scene); returns its id. */
  addSource(type: string, name: string): string;
  /** Result of the next `dialogs.pickPath` (default: canceled). */
  pickResult: PickPathResult;
  metersOn(): boolean;
  /** Pushes one meters frame to the window (only while meters are on). */
  pushMeters(frame: Float32Array | number[]): void;
  /** Frame for the current `audio.mixer` with the given peak dB for every channel of each source. */
  buildFrame(dbPeak: (index: number) => number): Float32Array;
  /** Applies `fn` to a slice and sends the resulting patch to subscribers. */
  mutate<T extends object>(name: string, fn: (s: T) => void): void;
  dispose(): void;
}

const TYPES = [
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
];
const clone = <T>(v: T): T => structuredClone(v);

/** Patch ops from `a` to `b`: per key for objects, per index for equal-length arrays, else a set. */
export function diffOps(a: unknown, b: unknown, path: (string | number)[] = []): PatchOp[] {
  if (a === b) return [];
  const isObj = (v: unknown): v is AnyRecord => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    return [['s', path, clone(b)]];
  }
  const ops: PatchOp[] = [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [['s', path, clone(b)]];
    a.forEach((v, i) => ops.push(...diffOps(v, b[i], [...path, i])));
    return ops;
  }
  for (const k of Object.keys(a)) {
    if (!(k in b)) ops.push(['d', [...path, k]]);
  }
  for (const k of Object.keys(b)) {
    if (!(k in a)) ops.push(['s', [...path, k], clone(b[k])]);
    else ops.push(...diffOps(a[k], b[k], [...path, k]));
  }
  return ops;
}

/** Rough IEC-like fader curve (the real one lives in OBS; the UI only edits `deflection`). */
export function deflectionToDb(def: number): number {
  const knots: [number, number][] = [
    [0, -96],
    [0.025, -60],
    [0.075, -50],
    [0.15, -40],
    [0.3, -30],
    [0.6, -9],
    [1, 0],
  ];
  if (def <= 0) return -96;
  for (let i = 1; i < knots.length; i++) {
    if (def <= knots[i][0]) {
      const [x0, y0] = knots[i - 1];
      const [x1, y1] = knots[i];
      return y0 + ((def - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 0;
}

const status: CoreStatus = {
  obsInit: 'ok',
  code: 0,
  initMs: 1234,
  versions: { app: '0.0.0-fake', electron: '45.x', node: '24.x', chrome: '140' },
};

export function createFakeCore(opts: FakeCoreOptions = {}): FakeCore {
  const nScenes = opts.scenes ?? 10;
  const nSources = opts.sources ?? 40;
  const nAudio = opts.audioSources ?? 4;
  const autoMeters = opts.autoMeters ?? true;

  const slices = new Map<string, object>();
  const revs = new Map<string, number>();
  const subs = new Map<number, string>(); // sid -> slice
  const calls: FakeCall[] = [];
  const sent: ClientMessage[] = [];
  let toWindow: (m: ServerMessage) => void = () => {};
  let meters = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let uid = 0;
  const id = (p: string) => `${p}_${(++uid).toString(36).padStart(4, '0')}`;

  // ---- initial data
  const sources: Record<string, SourceInfo> = {};
  const scenes: ScenesState = { activeSceneId: null, scenes: [] };
  const audio: AudioState = { sources: {}, mixer: { rev: 1, ids: [] } };
  const items: Record<string, SceneNode[]> = {};

  const mkSource = (
    i: number,
    type = TYPES[i % TYPES.length],
    hasAudio = false,
    forcedId?: string,
  ): SourceInfo => {
    const sid = forcedId ?? id(type);
    const s: SourceInfo = {
      id: sid,
      name: `${type.replace(/_/g, ' ')} ${i + 1}`,
      type,
      status: 'ready',
      audio: hasAudio,
      video: !hasAudio,
      width: 1920,
      height: 1080,
      configurable: true,
      propertiesManager: 'default',
    };
    sources[sid] = s;
    return s;
  };
  const mkAudio = (sid: string, def: number): AudioSourceState => ({
    id: sid,
    muted: false,
    mul: def * def,
    db: deflectionToDb(def),
    deflection: def,
    forceMono: false,
    syncOffsetMs: 0,
    mixers: 255,
    monitoring: 'none',
    hidden: false,
  });
  const mkItem = (sourceId: string, parentId: string | null = null): SceneItemNode => ({
    kind: 'item',
    id: id('item'),
    sourceId,
    parentId,
    canvas: 'horizontal',
    visible: true,
    locked: false,
    streamVisible: true,
    recordingVisible: true,
    scaleFilter: 'disable',
    blendingMode: 'normal',
    blendingMethod: 'default',
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
  });

  const audioNames = ['Desktop Audio', 'Mic/Aux', 'Game Audio', 'Music'];
  for (let i = 0; i < nAudio; i++) {
    const s = mkSource(i, i % 2 ? 'wasapi_input_capture' : 'wasapi_output_capture', true);
    s.name = audioNames[i] ?? `Audio ${i + 1}`;
    s.channel = i + 1;
    audio.sources[s.id] = mkAudio(s.id, 0.7 - i * 0.1);
  }
  audio.mixer.ids = Object.keys(audio.sources);
  const videoIds: string[] = [];
  for (let i = 0; i < nSources; i++) videoIds.push(mkSource(i).id);
  for (let i = 0; i < nScenes; i++) {
    const sid = `scene_${id('s')}`;
    scenes.scenes.push({ id: sid, name: `Scene ${i + 1}` });
    mkSource(0, 'scene', false, sid).name = `Scene ${i + 1}`;
    const list: SceneNode[] = [];
    // the first scene gets many items (long list), the others a handful
    const count = i === 0 ? Math.min(nSources, 12) : Math.min(nSources, 3 + (i % 5));
    for (let k = 0; k < count; k++) list.push(mkItem(videoIds[(i * 3 + k) % nSources]));
    items[sid] = list;
  }
  scenes.activeSceneId = scenes.scenes[0]?.id ?? null;

  const selection: SelectionState = { sceneId: scenes.activeSceneId, ids: [], lastId: null };
  const canvases: Partial<Record<'horizontal', CanvasState>> = {
    horizontal: {
      id: 'horizontal',
      baseWidth: 1920,
      baseHeight: 1080,
      outputWidth: 1920,
      outputHeight: 1080,
      fpsNum: 60,
      fpsDen: 1,
    },
  };

  slices.set('scenes', scenes);
  slices.set('selection', selection);
  slices.set('canvases', canvases);
  slices.set('sources', { sources });
  slices.set('audio', audio);
  for (const sc of scenes.scenes) {
    slices.set(`sceneItems:${sc.id}`, { sceneId: sc.id, nodes: items[sc.id] });
  }

  // ---- slice plumbing
  function emit(name: string, before: object, after: object) {
    const ops = diffOps(before, after);
    if (!ops.length) return;
    const rev = (revs.get(name) ?? 1) + 1;
    revs.set(name, rev);
    for (const [sid, sl] of subs) if (sl === name) toWindow({ type: 'patch', sid, rev, ops });
  }

  function mutate<T extends object>(name: string, fn: (s: T) => void) {
    const cur = slices.get(name) as T | undefined;
    if (!cur) return;
    const before = clone(cur);
    fn(cur);
    emit(name, before, cur);
  }

  const enoent = (what: string) => Object.assign(new Error(`${what}: ENOENT`), { code: 'ENOENT' });
  const sceneItems = (sceneId: string) => {
    const s = slices.get(`sceneItems:${sceneId}`) as { nodes: SceneNode[] } | undefined;
    if (!s) throw enoent(`scene ${sceneId}`);
    return s;
  };

  const descendants = (nodes: SceneNode[], rootId: string): string[] => {
    const out: string[] = [];
    const walk = (pid: string) => {
      for (const n of nodes) {
        if (n.parentId !== pid) continue;
        out.push(n.id);
        if (n.kind === 'folder') walk(n.id);
      }
    };
    walk(rootId);
    return out;
  };

  const syncMixer = () => {
    mutate<AudioState>('audio', a => {
      const ids = Object.values(a.sources).map(s => s.id);
      if (JSON.stringify(ids) !== JSON.stringify(a.mixer.ids)) {
        a.mixer.ids = ids;
        a.mixer.rev++;
      }
    });
  };

  function switchedTo(sceneId: string | null) {
    mutate<SelectionState>('selection', s => {
      s.sceneId = sceneId;
      s.ids = [];
      s.lastId = null;
    });
    syncMixer();
  }

  // ---- commands
  type Fn = (...a: never[]) => unknown;
  const f = <A extends unknown[]>(fn: (...a: A) => unknown) => fn as unknown as Fn;
  type SourcesState = { sources: Record<string, SourceInfo> };
  type NodesState = { nodes: SceneNode[] };

  const impl: Record<string, Record<string, Fn>> = {
    scenes: {
      create: f((name: string, o?: { duplicateFrom?: string; makeActive?: boolean }) => {
        const sid = `scene_${id('s')}`;
        const nodes: SceneNode[] = o?.duplicateFrom
          ? clone(sceneItems(o.duplicateFrom).nodes).map(n => ({ ...n, id: id('item') }))
          : [];
        slices.set(`sceneItems:${sid}`, { sceneId: sid, nodes });
        mutate<SourcesState>('sources', s => {
          s.sources[sid] = { ...mkSource(0, 'scene', false, sid), name };
        });
        mutate<ScenesState>('scenes', s => {
          s.scenes.push({ id: sid, name });
          if (o?.makeActive) s.activeSceneId = sid;
        });
        if (o?.makeActive) switchedTo(sid);
        return sid;
      }),
      remove: f((sceneId: string) => {
        sceneItems(sceneId);
        mutate<ScenesState>('scenes', s => {
          s.scenes = s.scenes.filter(x => x.id !== sceneId);
          if (s.activeSceneId === sceneId) s.activeSceneId = s.scenes[0]?.id ?? null;
        });
        slices.delete(`sceneItems:${sceneId}`);
        mutate<SourcesState>('sources', s => {
          delete s.sources[sceneId];
        });
        switchedTo((slices.get('scenes') as ScenesState).activeSceneId);
      }),
      rename: f((sceneId: string, name: string) => {
        mutate<ScenesState>('scenes', s => {
          const sc = s.scenes.find(x => x.id === sceneId);
          if (!sc) throw enoent(`scene ${sceneId}`);
          sc.name = name;
        });
        mutate<SourcesState>('sources', s => {
          if (s.sources[sceneId]) s.sources[sceneId].name = name;
        });
      }),
      makeActive: f((sceneId: string) => {
        sceneItems(sceneId);
        mutate<ScenesState>('scenes', s => void (s.activeSceneId = sceneId));
        switchedTo(sceneId);
      }),
      reorder: f((ids: string[]) => {
        mutate<ScenesState>('scenes', s => {
          const by = new Map(s.scenes.map(x => [x.id, x]));
          s.scenes = ids.map(i => by.get(i)).filter((x): x is NonNullable<typeof x> => !!x);
        });
      }),
    },
    sceneItems: {
      remove: f((sceneId: string, ids: string[]) => {
        mutate<NodesState>(`sceneItems:${sceneId}`, s => {
          const gone = new Set(ids.flatMap(i => [i, ...descendants(s.nodes, i)]));
          s.nodes = s.nodes.filter(n => !gone.has(n.id));
        });
        const left = new Set(sceneItems(sceneId).nodes.map(n => n.id));
        mutate<SelectionState>('selection', s => {
          s.ids = s.ids.filter(i => left.has(i));
        });
      }),
      update: f((sceneId: string, ids: string[], patch: Partial<SceneItemNode>) => {
        mutate<NodesState>(`sceneItems:${sceneId}`, s => {
          for (const n of s.nodes) {
            if (n.kind === 'item' && ids.includes(n.id)) Object.assign(n, patch);
          }
        });
      }),
      move: f((sceneId: string, ids: string[], to: MoveDestination) => {
        mutate<NodesState>(`sceneItems:${sceneId}`, s => {
          const moving = s.nodes.filter(n => ids.includes(n.id));
          const rest = s.nodes.filter(n => !ids.includes(n.id));
          let at = 0;
          if (to.type === 'bottom') at = rest.length;
          else if (to.type === 'before' || to.type === 'after') {
            const i = rest.findIndex(n => n.id === to.id);
            at = i < 0 ? rest.length : to.type === 'before' ? i : i + 1;
            const target = rest[i];
            if (target) for (const m of moving) m.parentId = target.parentId;
          } else if (to.type === 'into') {
            at = rest.findIndex(n => n.id === to.folderId) + 1;
            for (const m of moving) m.parentId = to.folderId;
          }
          rest.splice(at, 0, ...moving);
          s.nodes = rest;
        });
      }),
      transform: f(
        (
          sceneId: string,
          updates: { id: string; transform: Partial<SceneItemNode['transform']> }[],
        ) => {
          mutate<NodesState>(`sceneItems:${sceneId}`, s => {
            for (const u of updates) {
              const n = s.nodes.find(x => x.id === u.id);
              if (n?.kind !== 'item') continue;
              const t = u.transform;
              if (t.position) Object.assign(n.transform.position, t.position);
              if (t.scale) Object.assign(n.transform.scale, t.scale);
              if (t.crop) Object.assign(n.transform.crop, t.crop);
              if (t.rotation !== undefined) n.transform.rotation = t.rotation;
            }
          });
        },
      ),
      translate: f((sceneId: string, ids: string[], d: { x: number; y: number }) => {
        mutate<NodesState>(`sceneItems:${sceneId}`, s => {
          for (const n of s.nodes) {
            if (n.kind !== 'item' || !ids.includes(n.id)) continue;
            n.transform.position.x += d.x;
            n.transform.position.y += d.y;
          }
        });
      }),
      add: f((sceneId: string, sourceId: string) => {
        const item = mkItem(sourceId);
        mutate<NodesState>(`sceneItems:${sceneId}`, s => void s.nodes.unshift(item));
        return item.id;
      }),
    },
    editor: {
      getGeometry: f(() => {
        const sceneId = scenes.activeSceneId;
        const nodes = sceneId ? sceneItems(sceneId).nodes : [];
        const src = (slices.get('sources') as SourcesState).sources;
        return sceneId
          ? {
              sceneId,
              canvas: 'horizontal',
              baseWidth: 1920,
              baseHeight: 1080,
              folders: nodes
                .filter(n => n.kind === 'folder')
                .map(n => ({ id: n.id, parentId: n.parentId })),
              items: nodes.flatMap(n =>
                n.kind === 'item'
                  ? [
                      {
                        id: n.id,
                        sourceId: n.sourceId,
                        parentId: n.parentId,
                        x: n.transform.position.x,
                        y: n.transform.position.y,
                        scaleX: n.transform.scale.x,
                        scaleY: n.transform.scale.y,
                        rotation: n.transform.rotation,
                        crop: { ...n.transform.crop },
                        width: src[n.sourceId]?.width ?? 0,
                        height: src[n.sourceId]?.height ?? 0,
                        visible: n.visible,
                        locked: n.locked,
                      },
                    ]
                  : [],
              ),
            }
          : null;
      }),
    },
    selection: {
      set: f((ids: string[]) =>
        mutate<SelectionState>('selection', s => {
          s.ids = ids;
          s.lastId = ids.at(-1) ?? null;
        }),
      ),
      add: f((ids: string[]) =>
        mutate<SelectionState>('selection', s => {
          for (const i of ids) if (!s.ids.includes(i)) s.ids.push(i);
          s.lastId = ids.at(-1) ?? s.lastId;
        }),
      ),
      remove: f((ids: string[]) =>
        mutate<SelectionState>('selection', s => {
          s.ids = s.ids.filter(i => !ids.includes(i));
        }),
      ),
      selectAll: f(() =>
        mutate<SelectionState>('selection', s => {
          s.ids = s.sceneId ? sceneItems(s.sceneId).nodes.map(n => n.id) : [];
        }),
      ),
      clear: f(() =>
        mutate<SelectionState>('selection', s => {
          s.ids = [];
          s.lastId = null;
        }),
      ),
    },
    sources: {
      rename: f((sourceId: string, name: string) =>
        mutate<SourcesState>('sources', s => {
          if (s.sources[sourceId]) s.sources[sourceId].name = name;
        }),
      ),
      suggestName: f((base: string) => base),
    },
    audio: {
      setMuted: f((sourceId: string, muted: boolean) =>
        mutate<AudioState>('audio', a => void (a.sources[sourceId].muted = muted)),
      ),
      setFader: f((sourceId: string, p: { deflection?: number }) =>
        mutate<AudioState>('audio', a => {
          const s = a.sources[sourceId];
          if (p.deflection !== undefined) s.deflection = p.deflection;
          s.db = deflectionToDb(s.deflection);
          s.mul = 10 ** (s.db / 20);
        }),
      ),
      setSettings: f((sourceId: string, p: Partial<AudioSourceState>) => {
        mutate<AudioState>('audio', a => void Object.assign(a.sources[sourceId], p));
        syncMixer();
      }),
      unhideAll: f(() => {
        mutate<AudioState>('audio', a => {
          for (const s of Object.values(a.sources)) s.hidden = false;
        });
        syncMixer();
      }),
    },
    display: {
      create: f((did: string, o: { canvas?: 'horizontal' }, view: { visible: boolean }) => {
        const st: DisplayState = {
          id: did,
          status: view.visible ? 'ready' : 'hidden',
          canvas: o.canvas ?? 'horizontal',
          outputRegion: null,
        };
        slices.set(`display:${did}`, st);
      }),
      update: f(
        (did: string, view: { visible: boolean; rect: { width: number; height: number } }) =>
          mutate<DisplayState>(`display:${did}`, s => {
            s.status = view.visible ? 'ready' : 'hidden';
            s.outputRegion = { x: 0, y: 0, width: view.rect.width, height: view.rect.height };
          }),
      ),
      setOptions: f(() => {}),
      destroy: f((did: string) => void slices.delete(`display:${did}`)),
    },
  };

  // ---- dialogs (m1-dialogs-design): open/close, Add Source, properties
  let dlgSeq = 0;
  const dialogListeners = new Set<(e: FakeDialogEvent) => void>();
  const backendProps = new Map<string, Property[]>(); // sourceId -> the "backend" property set
  let current: string | undefined; // one dialog window at a time
  const fakeApi = { pickResult: { canceled: true, paths: [] } as PickPathResult };

  const world = (): FakeWorld => ({
    catalogue: buildCatalogue({ legacy: opts.legacyCatalogue, scenes: scenes.scenes.length }),
    sources: Object.values((slices.get('sources') as SourcesState).sources).map(src => ({
      id: src.id,
      name: src.name,
      type: src.type,
      channel: src.channel,
    })),
    sceneNames: scenes.scenes.map(sc => sc.name),
    activeSceneId: scenes.activeSceneId ?? '',
  });

  const dropDialog = (dialogId: string) => {
    slices.delete(`dialog:${dialogId}`);
    slices.delete(`properties:${dialogId}`);
  };

  function openDialog(req: DialogOpenRequest): DialogRef {
    const dialogId = `dlg_${++dlgSeq}`;
    const state = buildDialogState(dialogId, req, world());
    if (current) dropDialog(current);
    current = dialogId;
    slices.set(`dialog:${dialogId}`, state);
    if (state.kind === 'source-properties') {
      const src = (slices.get('sources') as SourcesState).sources[state.data.sourceId];
      let set = backendProps.get(src.id);
      if (!set) backendProps.set(src.id, (set = propertySetFor(src.type)));
      applyModified(src.type, set);
      const ps: PropertiesState = { sourceId: src.id, rev: 1, items: clone(set) };
      slices.set(`properties:${dialogId}`, ps);
    }
    for (const cb of dialogListeners) cb({ type: 'open', state });
    return { dialogId, windowId: 1 };
  }
  function closeDialog(dialogId: string) {
    if (current !== dialogId) return;
    dropDialog(dialogId);
    current = undefined;
    for (const cb of dialogListeners) cb({ type: 'close', dialogId });
  }
  function addSourceOnly(type: string, name: string): string {
    let sid = '';
    mutate<SourcesState>('sources', st => {
      const src = mkSource(0, type);
      src.name = name;
      sid = src.id;
      st.sources[sid] = src;
    });
    return sid;
  }

  impl.dialogs = {
    open: f((req: DialogOpenRequest) => openDialog(req)),
    close: f((dialogId: string) => closeDialog(dialogId)),
    pickPath: f(() => fakeApi.pickResult),
    submitAddSource: f(
      (
        dialogId: string,
        submit: { mode: 'new'; name: string } | { mode: 'existing'; sourceId: string },
      ) => {
        const st = slices.get(`dialog:${dialogId}`) as DialogState | undefined;
        if (!st || st.kind !== 'add-source') throw enoent(`dialog ${dialogId}`);
        const { sceneId, entry } = st.data;
        let sourceId: string;
        if (submit.mode === 'new') {
          if (!submit.name.trim()) throw Object.assign(new Error('ENAME'), { code: 'ENAME' });
          sourceId = addSourceOnly(entry.sourceType, submit.name.trim());
        } else {
          sourceId = submit.sourceId;
          if (sourceId === sceneId) throw Object.assign(new Error('ECYCLE'), { code: 'ECYCLE' });
        }
        const addItem = impl.sceneItems.add as unknown as (...a: unknown[]) => string;
        const itemId = addItem(sceneId, sourceId);
        mutate<SelectionState>('selection', s => {
          s.ids = [itemId];
          s.lastId = itemId;
        });
        if (submit.mode === 'new') {
          openDialog({
            kind: 'source-properties',
            params: { sourceId },
            title: propertiesTitle(entry.sourceType),
          });
        } else closeDialog(dialogId);
      },
    ),
  };
  impl.properties = {
    set: f((sourceId: string, changes: { name: string; value: never }[]) => {
      const src = (slices.get('sources') as SourcesState).sources[sourceId];
      const set = backendProps.get(sourceId);
      if (!src || !set) throw enoent(`source ${sourceId}`);
      for (const c of changes) {
        const p = set.find(i => i.name === c.name) as { value?: unknown } | undefined;
        if (p) p.value = c.value;
      }
      applyModified(src.type, set);
      for (const key of [...slices.keys()]) {
        if (!key.startsWith('properties:')) continue;
        mutate<PropertiesState>(key, ps => {
          if (ps.sourceId !== sourceId) return;
          ps.items = clone(set);
          ps.rev++;
        });
      }
    }),
    fonts: f(() =>
      ['Arial', 'Calibri', 'Consolas', 'Segoe UI', 'Times New Roman', 'Verdana'].flatMap(family =>
        [
          ['Regular', 0, 400],
          ['Bold', 1, 700],
          ['Italic', 2, 400],
          ['Bold Italic', 3, 700],
        ].map(([style, flags, weight]) => ({
          family,
          style,
          flags,
          weight,
          italic: (flags as number) >= 2,
        })),
      ),
    ),
    press: f(() => {}),
    refresh: f(() => {}),
  };
  impl.sourceTypes = { catalogue: f(() => world().catalogue) };

  // ---- meters
  function buildFrame(dbPeak: (i: number) => number): Float32Array {
    const a = slices.get('audio') as AudioState;
    const ids = a.mixer.ids;
    const out: number[] = [1, a.mixer.rev, ids.length];
    ids.forEach((sid, i) => {
      if (a.sources[sid]?.muted) out.push(2, -65535, -65535, -65535, -65535, -65535, -65535);
      else {
        const p = dbPeak(i);
        out.push(2, p, p - 1.5, p - 4, p - 3, p - 3, p - 3);
      }
    });
    return new Float32Array(out);
  }
  function syntheticFrame(): Float32Array {
    const t = performance.now() / 1000;
    return buildFrame(i => -40 + 30 * Math.abs(Math.sin(t * (0.8 + i * 0.37))) - (i % 2) * 10);
  }
  function startMeters() {
    meters = true;
    if (autoMeters && !timer) {
      const ms = opts.intervalMs ?? 66;
      timer = setInterval(() => toWindow({ type: 'meters', data: syntheticFrame() }), ms);
    }
  }
  function stopMeters() {
    meters = false;
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  // ---- transport
  async function onMessage(m: ClientMessage) {
    sent.push(m);
    switch (m.type) {
      case 'sub': {
        const state = slices.get(m.slice);
        if (!state) {
          toWindow({
            type: 'sub-error',
            sid: m.sid,
            slice: m.slice,
            error: { message: `unknown slice ${m.slice}`, code: 'ENOENT' },
          });
          return;
        }
        subs.set(m.sid, m.slice);
        toWindow({
          type: 'snapshot',
          sid: m.sid,
          slice: m.slice,
          value: clone(state),
          rev: revs.get(m.slice) ?? 1,
        });
        break;
      }
      case 'unsub':
        subs.delete(m.sid);
        break;
      case 'meters-on':
        startMeters();
        break;
      case 'meters-off':
        stopMeters();
        break;
      case 'ping':
        toWindow({ type: 'pong', id: m.id, t: m.t, ts: Date.now() });
        break;
      case 'call': {
        calls.push({ target: m.target, method: m.method, args: m.args });
        const fn = impl[m.target]?.[m.method] as ((...a: unknown[]) => unknown) | undefined;
        if (!fn) {
          const message = `fake core: ${m.target}.${m.method} not implemented`;
          toWindow({ type: 'result', id: m.id, ok: false, error: { message } });
          return;
        }
        try {
          const value = await fn(...m.args);
          toWindow({ type: 'result', id: m.id, ok: true, value });
        } catch (e) {
          const err = e as Error & { code?: string };
          const error = { message: err.message, code: err.code };
          toWindow({ type: 'result', id: m.id, ok: false, error });
        }
        break;
      }
      default:
        break; // on/off (events): the fake emits none
    }
  }

  const transport: ClientTransport = {
    // asynchronous like a MessagePort
    post: msg => void queueMicrotask(() => void onMessage(msg)),
    onMessage: cb => {
      toWindow = m => queueMicrotask(() => cb(m));
      queueMicrotask(() => cb({ type: 'status', status })); // pushed on connect, as the real core does
    },
    close: () => stopMeters(),
  };

  return {
    transport,
    connect: makeState => createClient<CoreContract>(transport, { makeState }),
    slices,
    calls,
    sent,
    openDialog,
    onDialogEvent: cb => {
      dialogListeners.add(cb);
      return () => void dialogListeners.delete(cb);
    },
    addSource: addSourceOnly,
    get pickResult() {
      return fakeApi.pickResult;
    },
    set pickResult(v: PickPathResult) {
      fakeApi.pickResult = v;
    },
    metersOn: () => meters,
    pushMeters: frame => {
      if (meters) toWindow({ type: 'meters', data: frame });
    },
    buildFrame,
    mutate,
    dispose: stopMeters,
  };
}
