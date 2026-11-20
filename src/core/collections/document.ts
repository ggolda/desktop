// CollectionDocument (m1-design 2.1, 3.3): the parsed collection file kept next to the live state.
// Unchanged nodes are re-emitted from the original JSON; changed nodes are the legacy shape overlaid
// on the original object, so unknown keys survive and key order stays. Nothing is rebuilt from
// backend state except what a command changed.
import { randomUUID } from 'node:crypto';
import type {
  BlendingMethod,
  BlendingMode,
  CanvasId,
  SceneItemSettings,
  ScaleFilter,
  Transform,
} from '../../shared/contracts';
import { parseCollection, serializeJson } from './codec';
import {
  BLENDING_METHODS,
  BLENDING_MODES,
  CURRENT,
  FOLDER_KEYS,
  ITEM_KEYS,
  type Json,
  SCALE_FILTERS,
  SCENE_KEYS,
  SOURCE_KEYS,
  WINDOWS_SOURCE_TYPES,
  emptyHotkeys,
  msToTimeSpec,
  timeSpecToMs,
} from './format';

// ---- records ------------------------------------------------------------------------------

/**
 * `pending`: not created in the backend yet (collection loading or new); `ready`: exists;
 * `unavailable`: unsupported type, kept verbatim; `failed`: the backend could not create it, kept
 * verbatim.
 */
export type SourceStatus = 'pending' | 'ready' | 'unavailable' | 'failed';

export interface SourceRec {
  id: string;
  name: string;
  type: string;
  /** The node as read from the file (null for sources created in this session). */
  raw: Json | null;
  status: SourceStatus;
  propertiesManager: string;
  propertiesManagerSettings: Json;
  channel?: number;
  volume: number;
  muted: boolean;
  deinterlaceMode: number;
  deinterlaceFieldOrder: number;
  forceMono: boolean;
  syncOffsetMs: number;
  audioMixers: number;
  monitoring: number;
  mixerHidden: boolean;
  /** Source has audio keys in the file, or the backend reported audio. */
  hasAudio: boolean;
  hasVideo: boolean;
  width: number;
  height: number;
  configurable: boolean;
  /** Settings the source was created with; the fallback at save when the backend cannot be read. */
  createSettings: Json;
  /** `filters` node, preserved verbatim (editing is M2). */
  filtersRaw: Json | null;
  /** True when a raw audio default was absent and must be derived from the backend. */
  audioDefaultsPending: boolean;
}

export interface ItemRec {
  kind: 'item';
  id: string;
  raw: Json | null;
  sourceId: string;
  parentId: string | null;
  canvas: CanvasId;
  /** Foreign (other canvas), duplicate, or references an unavailable source: kept, never shown. */
  hidden: boolean;
  settings: SceneItemSettings;
  transform: Transform;
  cropRef?: { referenceWidth: number; referenceHeight: number };
  /** Backend handle while the item exists there. */
  ref?: number;
}

export interface FolderRec {
  kind: 'folder';
  id: string;
  raw: Json | null;
  name: string;
  parentId: string | null;
  canvas: CanvasId;
  hidden: boolean;
  childrenIds: string[];
}

export type NodeRec = ItemRec | FolderRec;

export interface SceneRec {
  id: string;
  name: string;
  raw: Json | null;
  /** UI order: index 0 is the top of the list. The file stores the reverse (bottom first). */
  nodes: NodeRec[];
  hotkeysRaw: Json | null;
}

export interface TransitionRec {
  id: string;
  name: string;
  type: string;
  duration: number;
  settings: Json;
  propertiesManagerSettings: Json;
  raw: Json | null;
}

export interface TransitionsRec {
  items: TransitionRec[];
  connections: { fromSceneId: string; toSceneId: string; transitionId: string }[];
  defaultTransitionId: string;
  raw: Json | null;
}

export interface DocumentWarnings {
  unavailable: { id: string; type: string }[];
}

// ---- helpers ------------------------------------------------------------------------------

/**
 * `raw` keys that we own are replaced, keys missing in `raw` are added, everything else survives.
 * Known keys come in legacy order; unknown keys follow in their original order.
 */
export function overlay(raw: Json | null, fresh: Json, order: string[]): Json {
  const out: Json = {};
  for (const k of order) {
    if (k in fresh && fresh[k] !== undefined) out[k] = fresh[k];
    else if (raw && k in raw) out[k] = raw[k];
  }
  if (raw) for (const k of Object.keys(raw)) if (!(k in out) && !order.includes(k)) out[k] = raw[k];
  return out;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function defaultTransform(): Transform {
  return {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  };
}

export function defaultItemSettings(): SceneItemSettings {
  return {
    visible: true,
    locked: false,
    streamVisible: true,
    recordingVisible: true,
    scaleFilter: 'disable',
    blendingMode: 'normal',
    blendingMethod: 'default',
  };
}

function pick<T extends string>(list: T[], v: unknown, d: T): T {
  return typeof v === 'number' && list[v] !== undefined ? list[v] : d;
}

function itemFromRaw(raw: Json): ItemRec {
  const crop = (raw.crop ?? {}) as Json;
  const canvas: CanvasId = raw.display === 'vertical' ? 'vertical' : 'horizontal';
  return {
    kind: 'item',
    id: String(raw.id),
    raw,
    sourceId: String(raw.sourceId),
    parentId: null,
    canvas,
    hidden: canvas !== 'horizontal',
    settings: {
      visible: raw.visible !== false,
      locked: raw.locked === true,
      streamVisible: raw.streamVisible !== false,
      recordingVisible: raw.recordingVisible !== false,
      scaleFilter: pick<ScaleFilter>(SCALE_FILTERS, raw.scaleFilter, 'disable'),
      blendingMode: pick<BlendingMode>(BLENDING_MODES, raw.blendingMode, 'normal'),
      blendingMethod: pick<BlendingMethod>(BLENDING_METHODS, raw.blendingMethod, 'default'),
    },
    transform: {
      position: { x: num(raw.x, 0), y: num(raw.y, 0) },
      scale: { x: num(raw.scaleX, 1), y: num(raw.scaleY, 1) },
      rotation: num(raw.rotation, 0),
      crop: {
        left: num(crop.left, 0),
        top: num(crop.top, 0),
        right: num(crop.right, 0),
        bottom: num(crop.bottom, 0),
      },
    },
    cropRef:
      typeof crop.referenceWidth === 'number' && typeof crop.referenceHeight === 'number'
        ? { referenceWidth: crop.referenceWidth, referenceHeight: crop.referenceHeight }
        : undefined,
  };
}

function folderFromRaw(raw: Json): FolderRec {
  const canvas: CanvasId = raw.display === 'vertical' ? 'vertical' : 'horizontal';
  return {
    kind: 'folder',
    id: String(raw.id),
    raw,
    name: String(raw.name ?? ''),
    parentId: null,
    canvas,
    hidden: canvas !== 'horizontal',
    childrenIds: Array.isArray(raw.childrenIds) ? raw.childrenIds.map(String) : [],
  };
}

function sourceFromRaw(raw: Json): SourceRec {
  const type = String(raw.type);
  const hasAudio = raw.audioMixers !== undefined;
  return {
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    type,
    raw,
    status: WINDOWS_SOURCE_TYPES.includes(type) ? 'pending' : 'unavailable',
    propertiesManager:
      typeof raw.propertiesManager === 'string' ? raw.propertiesManager : 'default',
    propertiesManagerSettings: (raw.propertiesManagerSettings ?? {}) as Json,
    channel: typeof raw.channel === 'number' ? raw.channel : undefined,
    volume: num(raw.volume, 1),
    muted: raw.muted === true,
    deinterlaceMode: num(raw.deinterlaceMode, 0),
    deinterlaceFieldOrder: num(raw.deinterlaceFieldOrder, 0),
    forceMono: raw.forceMono === true,
    syncOffsetMs: timeSpecToMs(raw.syncOffset),
    audioMixers: num(raw.audioMixers, 255),
    monitoring: num(raw.monitoringType, 0),
    mixerHidden: raw.mixerHidden === true,
    hasAudio,
    hasVideo: true,
    width: 0,
    height: 0,
    configurable: true,
    createSettings: (raw.settings ?? {}) as Json,
    filtersRaw: (raw.filters ?? null) as Json | null,
    audioDefaultsPending: !hasAudio,
  };
}

export function newSourceRec(init: {
  id: string;
  name: string;
  type: string;
  settings?: Json;
  channel?: number;
  propertiesManager?: string;
  propertiesManagerSettings?: Json;
}): SourceRec {
  return {
    id: init.id,
    name: init.name,
    type: init.type,
    raw: null,
    status: 'pending',
    propertiesManager: init.propertiesManager ?? 'default',
    propertiesManagerSettings: init.propertiesManagerSettings ?? {},
    channel: init.channel,
    volume: 1,
    muted: false,
    deinterlaceMode: 0,
    deinterlaceFieldOrder: 0,
    forceMono: false,
    syncOffsetMs: 0,
    audioMixers: 255,
    monitoring: 0,
    mixerHidden: false,
    hasAudio: false,
    hasVideo: true,
    width: 0,
    height: 0,
    configurable: true,
    createSettings: init.settings ?? {},
    filtersRaw: null,
    audioDefaultsPending: true,
  };
}

export function newItemRec(init: { id?: string; sourceId: string; canvas?: CanvasId }): ItemRec {
  return {
    kind: 'item',
    id: init.id ?? randomUUID(),
    raw: null,
    sourceId: init.sourceId,
    parentId: null,
    canvas: init.canvas ?? 'horizontal',
    hidden: false,
    settings: defaultItemSettings(),
    transform: defaultTransform(),
  };
}

export function newFolderRec(name: string, canvas: CanvasId = 'horizontal'): FolderRec {
  return {
    kind: 'folder',
    id: randomUUID(),
    raw: null,
    name,
    parentId: null,
    canvas,
    hidden: false,
    childrenIds: [],
  };
}

/** Recomputes `parentId` of every node from the folders' `childrenIds`. */
export function reindexParents(scene: SceneRec): void {
  const parentOf = new Map<string, string>();
  for (const n of scene.nodes) {
    if (n.kind === 'folder') for (const c of n.childrenIds) parentOf.set(c, n.id);
  }
  for (const n of scene.nodes) n.parentId = parentOf.get(n.id) ?? null;
}

// ---- document -----------------------------------------------------------------------------

export class CollectionDocument {
  /** The text of the file as last read or written (null: created in this session). */
  text: string | null;
  root: Json;
  readonly sources: SourceRec[] = [];
  readonly scenes: SceneRec[] = [];
  transitions: TransitionsRec = { items: [], connections: [], defaultTransitionId: '', raw: null };
  readonly warnings: DocumentWarnings = { unavailable: [] };
  readonly sourceById = new Map<string, SourceRec>();
  readonly sceneById = new Map<string, SceneRec>();
  schemaVersion: number;
  /** v < 5 or `relativeCoordinates !== true`: the coordinate migration must be saved (C6). */
  needsMigration: boolean;
  /** Active scene id as stored in the file (the scene with `active: true`). */
  activeSceneId: string | null = null;

  private dirtySources = new Set<string>();
  private dirtyScenes = new Set<string>();
  private dirtyItems = new Set<string>();
  private dirtyTransitions = false;
  private dirtyRoot = false;
  private dirtyStructure = false;
  private forceAll = false;

  private constructor(text: string | null, root: Json) {
    this.text = text;
    this.root = root;
    this.schemaVersion = typeof root.schemaVersion === 'number' ? root.schemaVersion : 1;
    this.needsMigration =
      text !== null && (this.schemaVersion < 5 || root.relativeCoordinates !== true);
    if (text === null) this.dirtyStructure = true;
  }

  static parse(text: string): CollectionDocument {
    const root = parseCollection(text);
    const doc = new CollectionDocument(text, root);
    doc.build();
    return doc;
  }

  /** A brand-new collection: no scenes yet, services add the defaults through commands. */
  static empty(): CollectionDocument {
    const root: Json = {};
    const doc = new CollectionDocument(null, root);
    return doc;
  }

  private build() {
    const root = this.root;
    // sources
    const seen = new Set<string>();
    const channels = new Set<number>();
    for (const raw of (root.sources?.items ?? []) as Json[]) {
      if (!raw || typeof raw !== 'object' || raw.id == null) continue;
      const rec = sourceFromRaw(raw);
      if (seen.has(rec.id)) {
        // E3: duplicate id. Keep it verbatim, never create it.
        rec.status = 'unavailable';
        this.sources.push(rec);
        continue;
      }
      seen.add(rec.id);
      if (rec.channel !== undefined) {
        if (channels.has(rec.channel)) {
          rec.channel = undefined; // E3: duplicate channel
          this.dirtySources.add(rec.id);
        } else channels.add(rec.channel);
      }
      if (rec.status === 'unavailable')
        this.warnings.unavailable.push({ id: rec.id, type: rec.type });
      this.sources.push(rec);
      this.sourceById.set(rec.id, rec);
    }
    // scenes
    let activeId: string | null = null;
    for (const raw of (root.scenes?.items ?? []) as Json[]) {
      if (!raw || typeof raw !== 'object' || raw.id == null) continue;
      const scene: SceneRec = {
        id: String(raw.id),
        name: String(raw.name ?? raw.id),
        raw,
        nodes: [],
        hotkeysRaw: (raw.hotkeys ?? null) as Json | null,
      };
      const ids = new Set<string>();
      const fileItems = (raw.sceneItems?.items ?? []) as Json[];
      for (let i = fileItems.length - 1; i >= 0; i--) {
        const n = fileItems[i];
        if (!n || typeof n !== 'object' || n.id == null) continue;
        const rec = n.sceneNodeType === 'folder' ? folderFromRaw(n) : itemFromRaw(n);
        if (ids.has(rec.id)) rec.hidden = true;
        else ids.add(rec.id);
        scene.nodes.push(rec);
      }
      reindexParents(scene);
      this.scenes.push(scene);
      this.sceneById.set(scene.id, scene);
      if (raw.active === true && activeId === null) activeId = scene.id;
    }
    // items whose source is missing or unavailable are kept but never shown (SPEC 5.5)
    for (const sc of this.scenes) {
      for (const n of sc.nodes) {
        if (n.kind !== 'item') continue;
        const src = this.sourceById.get(n.sourceId);
        if (!this.sceneById.has(n.sourceId) && (!src || src.status === 'unavailable'))
          n.hidden = true;
      }
    }
    this.activeSceneId = activeId ?? this.scenes[0]?.id ?? null;
    if (this.scenes.length && activeId === null) this.dirtyRoot = true;
    // transitions
    this.transitions = this.buildTransitions(root.transitions as Json | undefined);
  }

  private buildTransitions(raw: Json | undefined): TransitionsRec {
    const out: TransitionsRec = {
      items: [],
      connections: [],
      defaultTransitionId: '',
      raw: raw ?? null,
    };
    if (!raw) return out;
    let list = raw.transitions as Json[] | undefined;
    if (!Array.isArray(list) && raw.type !== undefined) {
      // schema v1: a single global transition without connections (nodes/transitions.ts:89)
      list = [
        {
          id: null,
          name: 'Global Transition',
          type: raw.type,
          duration: raw.duration,
          settings: raw.settings,
          propertiesManagerSettings: raw.propertiesManagerSettings,
        },
      ];
      this.dirtyTransitions = true;
    }
    for (const t of list ?? []) {
      if (!t || typeof t !== 'object') continue;
      if (t.id == null) this.dirtyTransitions = true;
      out.items.push({
        id: t.id ?? randomUUID(),
        name: String(t.name ?? 'Transition'),
        type: String(t.type ?? 'cut_transition'),
        duration: num(t.duration, 300),
        settings: (t.settings ?? {}) as Json,
        propertiesManagerSettings: (t.propertiesManagerSettings ?? {}) as Json,
        raw: t,
      });
    }
    for (const c of (raw.connections ?? []) as Json[]) {
      out.connections.push({
        fromSceneId: String(c.fromSceneId),
        toSceneId: String(c.toSceneId),
        transitionId: String(c.transitionId),
      });
    }
    out.defaultTransitionId =
      typeof raw.defaultTransitionId === 'string' ? raw.defaultTransitionId : '';
    return out;
  }

  // ---- lookups ----------------------------------------------------------------------------

  source(id: string): SourceRec | undefined {
    return this.sourceById.get(id);
  }
  scene(id: string): SceneRec | undefined {
    return this.sceneById.get(id);
  }
  /** Scene node by id (items and folders), searching one scene. Hidden nodes are never returned. */
  node(sceneId: string, nodeId: string): NodeRec | undefined {
    return this.sceneById.get(sceneId)?.nodes.find(n => n.id === nodeId && !n.hidden);
  }
  /** Source ids that exist as scenes are not in `sources`. */
  addSource(rec: SourceRec) {
    this.sources.push(rec);
    this.sourceById.set(rec.id, rec);
    this.dirtyStructure = true;
    this.dirtySources.add(rec.id);
  }
  removeSource(id: string) {
    const i = this.sources.findIndex(s => s.id === id);
    if (i >= 0) this.sources.splice(i, 1);
    this.sourceById.delete(id);
    this.dirtySources.delete(id);
    this.dirtyStructure = true;
  }
  addScene(rec: SceneRec) {
    this.scenes.push(rec);
    this.sceneById.set(rec.id, rec);
    this.dirtyStructure = true;
    this.dirtyScenes.add(rec.id);
  }
  removeScene(id: string) {
    const i = this.scenes.findIndex(s => s.id === id);
    if (i >= 0) this.scenes.splice(i, 1);
    this.sceneById.delete(id);
    this.dirtyScenes.delete(id);
    this.dirtyStructure = true;
  }

  // ---- dirty tracking ---------------------------------------------------------------------

  touchSource(id: string) {
    this.dirtySources.add(id);
  }
  touchScene(id: string) {
    this.dirtyScenes.add(id);
  }
  touchItem(id: string) {
    this.dirtyItems.add(id);
  }
  touchTransitions() {
    this.dirtyTransitions = true;
  }
  touchRoot() {
    this.dirtyRoot = true;
  }
  touchStructure() {
    this.dirtyStructure = true;
  }
  /** Used by the migration save and by tests (C4): every node is re-emitted from fresh state. */
  touchAll() {
    this.forceAll = true;
  }
  isDirty(): boolean {
    return (
      this.forceAll ||
      this.dirtyStructure ||
      this.dirtyRoot ||
      this.dirtyTransitions ||
      this.dirtySources.size > 0 ||
      this.dirtyScenes.size > 0 ||
      this.dirtyItems.size > 0
    );
  }
  /** Sources whose settings must be read from the backend before `serialize`. */
  sourcesNeedingSettings(): string[] {
    return this.sources
      .filter(s => s.status === 'ready' && (this.forceAll || this.dirtySources.has(s.id) || !s.raw))
      .map(s => s.id);
  }
  isSourceDirty(id: string): boolean {
    return this.forceAll || this.dirtySources.has(id);
  }
  clearDirty() {
    this.dirtySources.clear();
    this.dirtyScenes.clear();
    this.dirtyItems.clear();
    this.dirtyTransitions = false;
    this.dirtyRoot = false;
    this.dirtyStructure = false;
    this.forceAll = false;
  }

  // ---- serialization ----------------------------------------------------------------------

  private emitSource(s: SourceRec, settings: Map<string, Json>): Json {
    const dirty = this.forceAll || this.dirtySources.has(s.id) || !s.raw;
    if (!dirty || s.status === 'unavailable' || s.status === 'failed') return s.raw as Json;
    const fresh: Json = {
      id: s.id,
      name: s.name,
      type: s.type,
      volume: s.volume,
      channel: s.channel,
      muted: s.muted,
      deinterlaceMode: s.deinterlaceMode,
      deinterlaceFieldOrder: s.deinterlaceFieldOrder,
      filters: s.filtersRaw ?? { items: [] },
      propertiesManager: s.propertiesManager,
      propertiesManagerSettings: s.propertiesManagerSettings,
    };
    const live = settings.get(s.id);
    if (live) fresh.settings = live;
    else if (!s.raw) fresh.settings = s.createSettings;
    if (!s.raw) fresh.hotkeys = emptyHotkeys();
    if (s.hasAudio) {
      fresh.forceMono = s.forceMono;
      fresh.syncOffset = msToTimeSpec(s.syncOffsetMs);
      fresh.audioMixers = s.audioMixers;
      fresh.monitoringType = s.monitoring;
      fresh.mixerHidden = s.mixerHidden;
    }
    const out = overlay(s.raw, fresh, SOURCE_KEYS);
    if (s.channel === undefined) delete out.channel;
    s.raw = out;
    return out;
  }

  private emitItem(n: NodeRec, sceneId: string): Json {
    const dirty = this.forceAll || this.dirtyItems.has(n.id) || !n.raw;
    if (!dirty || n.hidden) return n.raw as Json;
    if (n.kind === 'folder') {
      return (n.raw = overlay(
        n.raw,
        {
          id: n.id,
          name: n.name,
          sceneNodeType: 'folder',
          sceneId,
          resourceId: `SceneItemFolder${JSON.stringify([sceneId, n.id])}`,
          parentId: n.parentId ?? '',
          childrenIds: n.childrenIds,
          display: n.canvas,
        },
        FOLDER_KEYS,
      ));
    }
    const t = n.transform;
    const fresh: Json = {
      id: n.id,
      sourceId: n.sourceId,
      x: t.position.x,
      y: t.position.y,
      scaleX: t.scale.x,
      scaleY: t.scale.y,
      visible: n.settings.visible,
      crop: { ...t.crop, ...(n.cropRef ?? {}) },
      locked: n.settings.locked,
      rotation: t.rotation,
      streamVisible: n.settings.streamVisible,
      recordingVisible: n.settings.recordingVisible,
      scaleFilter: SCALE_FILTERS.indexOf(n.settings.scaleFilter),
      blendingMode: BLENDING_MODES.indexOf(n.settings.blendingMode),
      blendingMethod: BLENDING_METHODS.indexOf(n.settings.blendingMethod),
      sceneNodeType: 'item',
      display: n.canvas,
    };
    if (!n.raw) fresh.hotkeys = emptyHotkeys();
    return (n.raw = overlay(n.raw, fresh, ITEM_KEYS));
  }

  private emitScene(s: SceneRec): Json {
    const itemsDirty =
      this.forceAll ||
      this.dirtyScenes.has(s.id) ||
      !s.raw ||
      s.nodes.some(n => this.dirtyItems.has(n.id));
    if (!itemsDirty) return s.raw as Json;
    const files = [...s.nodes].reverse().map(n => this.emitItem(n, s.id));
    const rawItems = (s.raw?.sceneItems ?? null) as Json | null;
    const wrapper: Json = rawItems
      ? {
          ...rawItems,
          schemaVersion: this.forceAll ? CURRENT.sceneItems : rawItems.schemaVersion,
          items: files,
        }
      : { schemaVersion: CURRENT.sceneItems, nodeType: 'SceneItemsNode', items: files };
    return (s.raw = overlay(
      s.raw,
      {
        hotkeys: s.raw ? undefined : emptyHotkeys(),
        filters: s.raw?.filters ?? {
          schemaVersion: CURRENT.sceneFilters,
          nodeType: 'SceneFiltersNode',
          items: [],
        },
        sceneItems: wrapper,
        id: s.id,
        name: s.name,
        active: s.id === this.activeSceneId,
      },
      SCENE_KEYS,
    ));
  }

  private emitTransitions(): Json {
    const t = this.transitions;
    if (!this.dirtyTransitions && !this.forceAll && t.raw) return t.raw;
    return (t.raw = overlay(
      t.raw && t.raw.transitions ? t.raw : null,
      {
        schemaVersion: CURRENT.transitions,
        nodeType: 'TransitionsNode',
        transitions: t.items.map(
          i =>
            (i.raw = overlay(
              i.raw,
              {
                id: i.id,
                name: i.name,
                type: i.type,
                duration: i.duration,
                settings: i.settings,
                propertiesManagerSettings: i.propertiesManagerSettings,
              },
              ['id', 'name', 'type', 'duration', 'settings', 'propertiesManagerSettings'],
            )),
        ),
        connections: t.connections.map(c => ({ ...c })),
        defaultTransitionId: t.defaultTransitionId,
      },
      ['schemaVersion', 'nodeType', 'transitions', 'connections', 'defaultTransitionId'],
    ));
  }

  /**
   * The text to write. Returns the original text when nothing is dirty (C2, C3). `settings` holds the
   * freshly read backend settings of the sources listed by `sourcesNeedingSettings()`.
   * `canvases` supplies the base resolutions for a fresh or upgraded root.
   */
  serialize(
    settings: Map<string, Json> = new Map(),
    canvases?: { horizontal?: { w: number; h: number }; vertical?: { w: number; h: number } },
  ): string {
    if (!this.isDirty() && this.text !== null) return this.text;
    const raw = this.root;
    const rawSources = (raw.sources ?? null) as Json | null;
    const rawScenes = (raw.scenes ?? null) as Json | null;
    const up = this.forceAll;
    const hRes = canvases?.horizontal ?? { w: 1280, h: 720 };
    const vRaw = raw.baseResolutions?.vertical as Json | undefined;
    const fresh: Json = {
      schemaVersion: CURRENT.root,
      nodeType: 'RootNode',
      sources: rawSources
        ? { ...rawSources, schemaVersion: up ? CURRENT.sources : rawSources.schemaVersion }
        : { schemaVersion: CURRENT.sources, nodeType: 'SourcesNode' },
      scenes: rawScenes
        ? { ...rawScenes, schemaVersion: up ? CURRENT.scenes : rawScenes.schemaVersion }
        : { schemaVersion: CURRENT.scenes, nodeType: 'ScenesNode' },
      transitions: this.emitTransitions(),
      hotkeys: raw.hotkeys ?? emptyHotkeys(),
      guestCam: raw.guestCam ?? {
        schemaVersion: CURRENT.guestCam,
        nodeType: 'GuestCamNode',
        audioSourceId: '',
        videoSourceId: '',
      },
      relativeCoordinates: true,
      baseResolution: raw.baseResolution ?? { baseWidth: hRes.w, baseHeight: hRes.h },
      baseResolutions: raw.baseResolutions ?? {
        horizontal: { baseWidth: hRes.w, baseHeight: hRes.h },
        vertical: vRaw ?? {
          baseWidth: canvases?.vertical?.w ?? 720,
          baseHeight: canvases?.vertical?.h ?? 1280,
        },
      },
      selectiveRecording: raw.selectiveRecording ?? false,
      dualOutputMode: raw.dualOutputMode ?? false,
      operatingSystem: raw.operatingSystem ?? process.platform,
    };
    fresh.sources.items = this.sources.map(s => this.emitSource(s, settings));
    fresh.scenes.items = this.scenes.map(s => this.emitScene(s));
    const order = [
      'schemaVersion',
      'nodeType',
      'sources',
      'scenes',
      'transitions',
      'hotkeys',
      'guestCam',
      'relativeCoordinates',
      'baseResolution',
      'baseResolutions',
      'selectiveRecording',
      'dualOutputMode',
      'operatingSystem',
    ];
    const emitted = overlay(raw, fresh, order);
    const text = serializeJson(emitted);
    // from now on the emitted nodes are the "original": a later save must not resurrect old values
    this.root = emitted;
    this.text = text;
    return text;
  }
}
