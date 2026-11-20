// Shared wiring of the core domain services (composition root: createCore in core.ts).
import type {
  AudioSourceState,
  AudioState,
  CollectionsState,
  CoreContract,
  SceneNode,
  ScenesState,
  SelectionState,
  SourceInfo,
  SourcesState,
  CanvasState,
  CanvasId,
} from '../shared/contracts';
import type { CollectionStore } from './collections/store';
import {
  type CollectionDocument,
  type NodeRec,
  type SceneRec,
  type SourceRec,
} from './collections/document';
import { MONITORING_TYPES } from './collections/format';
import type { AudioApi } from './audio/service';
import type { CollectionsApi } from './collections/service';
import type { DialogsApi } from './dialogs/service';
import type { DisplayApi } from './display/service';
import type { PropertiesApi } from './properties/service';
import type { MediaBackend } from './media/backend';
import type { ScenesApi } from './scenes/service';
import type { SelectionApi } from './scenes/selection';
import type { SourcesApi } from './sources/service';
import type { TransitionsApi } from './transitions/service';
import type { Perf } from './perf';
import type { Runtime } from './runtime/runtime';

export type CoreRuntime = Runtime<CoreContract>;

export function coded(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

/** Domain services, resolved lazily because they call each other. */
export interface Services {
  collections: CollectionsApi;
  sources: SourcesApi;
  scenes: ScenesApi;
  selection: SelectionApi;
  audio: AudioApi;
  transitions: TransitionsApi;
  display: DisplayApi;
  dialogs: DialogsApi;
  properties: PropertiesApi;
}

export interface Slices {
  collections: CollectionsState;
  scenes: ScenesState;
  selection: SelectionState;
  canvases: Partial<Record<CanvasId, CanvasState>>;
  sources: SourcesState;
  audio: AudioState;
}

/** What the services share. Created once by createCore; `doc` changes on every collection switch. */
export interface Ctx {
  rt: CoreRuntime;
  backend: MediaBackend;
  perf: Perf;
  userData: string;
  /** `shared-resources` directory (capture placeholder image). */
  sharedResources: string;
  store: CollectionStore;
  slices: Slices;
  /** The open collection (document phase done). Null before the first one is opened. */
  doc: CollectionDocument | null;
  /** True during both phases of a collection load. */
  loading: boolean;
  /** backend.init finished. */
  backendReady: boolean;
  /** Collection id of `doc`. */
  activeId: string | null;
  /** Migration could not be completed: this collection is not saved this session. */
  saveBlocked: boolean;
  /** Mutations call these: mark the node dirty in the document and schedule the save. */
  touch: {
    source(id: string): void;
    scene(id: string): void;
    item(id: string): void;
    transitions(): void;
    structure(): void;
  };
  /** Throws ENOTREADY / ELOADING unless backend objects can be used. */
  requireMedia(): void;
  requireDoc(): CollectionDocument;
}

// ---- views: record -> slice shape ----------------------------------------------------------

export function sourceInfo(rec: SourceRec): SourceInfo {
  const info: SourceInfo = {
    id: rec.id,
    name: rec.name,
    type: rec.type,
    status: rec.status === 'ready' ? 'ready' : 'loading',
    audio: rec.hasAudio,
    video: rec.hasVideo,
    width: rec.width,
    height: rec.height,
    configurable: rec.configurable,
    propertiesManager: rec.propertiesManager,
  };
  if (rec.channel !== undefined) info.channel = rec.channel;
  return info;
}

export function sceneSourceInfo(scene: SceneRec, ready: boolean): SourceInfo {
  return {
    id: scene.id,
    name: scene.name,
    type: 'scene',
    status: ready ? 'ready' : 'loading',
    audio: false,
    video: true,
    width: 0,
    height: 0,
    configurable: false,
    propertiesManager: 'default',
  };
}

export function nodeView(n: NodeRec): SceneNode {
  if (n.kind === 'folder') {
    return {
      kind: 'folder',
      id: n.id,
      name: n.name,
      parentId: n.parentId,
      canvas: n.canvas,
    };
  }
  return {
    kind: 'item',
    id: n.id,
    sourceId: n.sourceId,
    parentId: n.parentId,
    canvas: n.canvas,
    ...n.settings,
    transform: {
      position: { ...n.transform.position },
      scale: { ...n.transform.scale },
      rotation: n.transform.rotation,
      crop: { ...n.transform.crop },
    },
  };
}

export function visibleNodes(scene: SceneRec): NodeRec[] {
  return scene.nodes.filter(n => !n.hidden);
}

/** Audio slice entry of a source record; `fader` values come from the backend. */
export function audioView(
  rec: SourceRec,
  fader: { db: number; deflection: number; mul: number },
): AudioSourceState {
  return {
    id: rec.id,
    muted: rec.muted,
    mul: fader.mul,
    db: Number.isFinite(fader.db) ? fader.db : -100,
    deflection: Math.round(fader.deflection * 100) / 100,
    forceMono: rec.forceMono,
    syncOffsetMs: rec.syncOffsetMs,
    mixers: rec.audioMixers,
    monitoring: MONITORING_TYPES[rec.monitoring] ?? 'none',
    hidden: rec.mixerHidden,
  };
}

/**
 * Writes `src` into the tracked object `dst` leaf by leaf, so a slice emits one patch per changed
 * value instead of replacing the object. Arrays are replaced when their JSON differs.
 */
export function assignDeep(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const k of Object.keys(src)) {
    const s = src[k];
    const d = dst[k];
    if (s !== null && typeof s === 'object' && !Array.isArray(s)) {
      if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
        assignDeep(d as Record<string, unknown>, s as Record<string, unknown>);
      } else dst[k] = s;
    } else if (Array.isArray(s)) {
      if (JSON.stringify(d) !== JSON.stringify(s)) dst[k] = s;
    } else dst[k] = s;
  }
  for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
}
