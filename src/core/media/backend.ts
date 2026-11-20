// The media backend interface (SPEC 4, m1-design 4). Async, JSON-serializable, id-based: no native
// object crosses this boundary. Only src/core/media/obs/* implements it for OBS (obs-studio-node).
import type {
  CanvasId,
  MeterFrame,
  PartialTransform,
  SceneItemSettings,
  Transform,
} from '../../shared/contracts';

/** `MeterFrame` is imported only for core meter encoding. */
export type { MeterFrame };

export type ItemRef = number;
export interface BackendInfo {
  name: string;
  version?: string;
}
export interface SourceFlags {
  audio: boolean;
  video: boolean;
  async: boolean;
  doNotDuplicate: boolean;
}
export interface SourceHandleInfo extends SourceFlags {
  id: string;
  type: string;
  width: number;
  height: number;
  configurable: boolean;
  muted: boolean;
  volume: number;
  audioMixers: number;
  monitoring: number;
  syncOffsetMs: number;
}
export interface FilterSpec {
  name: string;
  type: string;
  settings: Record<string, unknown>;
  enabled: boolean;
}
export interface SourceSpec {
  id: string;
  type: string;
  settings: Record<string, unknown>;
  muted?: boolean;
  volume?: number;
  syncOffsetMs?: number;
  deinterlaceMode?: number;
  deinterlaceFieldOrder?: number;
  filters?: FilterSpec[];
}
/**
 * One property of a source as the backend reports it: plain data (a fresh read applies the settings,
 * so `modified` callbacks have already run). Conversion to the wire `Property`: properties/convert.ts.
 */
export interface BackendProperty {
  name: string;
  description: string;
  longDescription: string;
  enabled: boolean;
  visible: boolean;
  /** EPropertyType of obs-studio-node. */
  type: number;
  value: unknown;
  /** Int / Float. `slider`: ENumberType.Slider. */
  number?: { slider: boolean; min: number; max: number; step: number };
  /** Text: ETextType, ETextInfoType. */
  text?: { type: number; infoType: number };
  /** Path: EPathType and the raw libobs filter string. */
  path?: { type: number; filter: string; defaultPath: string };
  /** List: EListFormat and the items. */
  list?: { format: number; items: { name: string; value: string | number }[] };
  /** EditableList: EEditableListType and the raw filter string. */
  editable?: { type: number; filter: string; defaultPath: string };
}

export interface ItemSpec extends SceneItemSettings {
  sourceId: string;
  canvas: CanvasId;
  transform: Transform;
}
/** As the backend normalized it. */
export interface ItemInfo {
  ref: ItemRef;
  transform: Transform;
}

export interface CanvasInfo {
  id: CanvasId;
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  fpsNum: number;
  fpsDen: number;
}

export interface BackendEvents {
  /** Coalesced, only real changes. */
  'source-changed': { id: string; width: number; height: number } & SourceFlags;
  crashed: { reason: string };
}

export interface MediaBackend {
  readonly info: BackendInfo;
  init(opts: { appDataPath: string; version: string; installPath: string }): Promise<BackendInfo>;
  /** Order: stop volmeters, remove displays, release scenes/sources, then backend shutdown. */
  shutdown(): Promise<void>;
  on<K extends keyof BackendEvents>(e: K, cb: (p: BackendEvents[K]) => void): () => void;

  canvases: {
    /** Creates the canvas context from the backend's stored video settings if needed. Idempotent. */
    ensure(id: CanvasId): Promise<CanvasInfo>;
    get(id: CanvasId): Promise<CanvasInfo | null>;
    setBaseResolution(id: CanvasId, size: { width: number; height: number }): Promise<void>;
    destroy(id: CanvasId): Promise<void>;
  };
  sources: {
    /** Bulk create (one backend call). Entries missing in the result failed. */
    createMany(specs: SourceSpec[]): Promise<{ ok: SourceHandleInfo[]; failed: string[] }>;
    remove(id: string): Promise<void>;
    /** `persist`: signal `save()` first. */
    getSettings(id: string, opts?: { persist?: boolean }): Promise<Record<string, unknown>>;
    updateSettings(id: string, patch: Record<string, unknown>): Promise<void>;
    /** Input types the backend can create (`InputFactory.types()`). */
    types(): Promise<string[]>;
    /**
     * Fresh property set of a source (the backend re-applies the settings, so visibility, enabled
     * state and list items reflect `modified` callbacks). Bulk: one pass, plain data. Empty when the
     * source has no properties.
     */
    getProperties(id: string): Promise<BackendProperty[]>;
    /** Presses a button property (`IButtonProperty.buttonClicked`). */
    pressButton(id: string, name: string): Promise<void>;
    getInfo(id: string): Promise<SourceHandleInfo | null>;
    /** Current pixel size of inputs, one backend call. Unknown ids are missing from the result. */
    getSizes(ids: string[]): Promise<Record<string, { width: number; height: number }>>;
    getFilters(id: string): Promise<FilterSpec[]>;
    /** Global.setOutputSource */
    assignChannel(channel: number, id: string | null): Promise<void>;
  };
  scenes: {
    create(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    duplicateItems(from: string, to: string): Promise<void>;
    /** Items in bottom-first backend order. Bulk. */
    addItems(sceneId: string, items: ItemSpec[]): Promise<ItemInfo[]>;
    removeItem(sceneId: string, ref: ItemRef): Promise<void>;
    updateItem(
      sceneId: string,
      ref: ItemRef,
      patch: Partial<SceneItemSettings> & { transform?: PartialTransform },
    ): Promise<ItemInfo>;
    /** Full order, top-first (UI order). */
    reorder(sceneId: string, refsTopFirst: ItemRef[]): Promise<void>;
    /** The full set of selected items of the scene; the backend draws the guides (and diffs). */
    setSelected(sceneId: string, refs: ItemRef[]): Promise<void>;
    getItem(sceneId: string, ref: ItemRef): Promise<ItemInfo | null>;
  };
  transitions: {
    create(spec: { id: string; type: string; settings: Record<string, unknown> }): Promise<void>;
    remove(id: string): Promise<void>;
    /** Program switch: `transitionId` null = cut. */
    switchScene(toSceneId: string, transitionId: string | null, durationMs: number): Promise<void>;
  };
  audio: {
    /** Creates the fader and applies the persisted volume (`mul`) through it. */
    attach(id: string, mul?: number): Promise<{ db: number; deflection: number; mul: number }>;
    detach(id: string): Promise<void>;
    setMuted(id: string, muted: boolean): Promise<void>;
    setFader(
      id: string,
      patch: { deflection?: number; db?: number; mul?: number },
    ): Promise<{ db: number; deflection: number; mul: number }>;
    setSettings(
      id: string,
      patch: { forceMono?: boolean; syncOffsetMs?: number; mixers?: number; monitoring?: number },
    ): Promise<void>;
    /** Volmeters exist only while enabled; frames are raw backend data, unmerged. */
    setMetersEnabled(enabled: boolean, ids: string[]): Promise<void>;
    onMeterData(
      cb: (batch: { id: string; peak: number[]; magnitude: number[]; inputPeak: number[] }[]) => void,
    ): () => void;
  };
  displays: {
    create(spec: {
      id: string;
      handle: Uint8Array;
      canvas: CanvasId;
      sourceId?: string;
      mode: 'main' | 'streaming' | 'recording';
      paddingColor?: { r: number; g: number; b: number };
      paddingSize?: number;
      drawUi: boolean;
    }): Promise<void>;
    /** Device pixels relative to the parent window's client area. */
    moveResize(id: string, r: { x: number; y: number; width: number; height: number }): Promise<void>;
    setDrawUi(id: string, draw: boolean): Promise<void>;
    setGuidelines(id: string, on: boolean): Promise<void>;
    setPadding(
      id: string,
      p: { color?: { r: number; g: number; b: number }; size?: number },
    ): Promise<void>;
    /** Device px. */
    getOutputRegion(id: string): Promise<{ x: number; y: number; width: number; height: number }>;
    destroy(id: string): Promise<void>;
  };
}
