import type { SourceCreateSpec } from './sources';
import type { Contract } from './types';

// M1 contract: scenes, scene items (nodes), selection, canvases. See docs/rework/chapter2/m1-design.md.
// Core is the source of truth. Windows subscribe to slices and write only through commands.

/** Output canvas. M1 implements `horizontal`; `vertical` (dual output) is additive (SPEC 4). */
export type CanvasId = 'horizontal' | 'vertical';

export interface Vec2 {
  x: number;
  y: number;
}

/** Crop in source pixels. */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Position and scale in canvas base-resolution pixels (the legacy "absolute" view of the transform). */
export interface Transform {
  position: Vec2;
  /** Unit-less factor, 1 = source size. Negative values mean flipped. */
  scale: Vec2;
  /** Degrees. */
  rotation: number;
  crop: Crop;
}

export interface PartialTransform {
  position?: Partial<Vec2>;
  scale?: Partial<Vec2>;
  rotation?: number;
  crop?: Partial<Crop>;
}

/** Domain names; the numeric file/OSN values are mapped in core (collections/format.ts, media/obs). */
export type ScaleFilter = 'disable' | 'point' | 'bicubic' | 'bilinear' | 'lanczos' | 'area';
export type BlendingMode =
  'normal' | 'additive' | 'subtract' | 'screen' | 'multiply' | 'lighten' | 'darken';
export type BlendingMethod = 'default' | 'srgb-off';

export interface SceneItemSettings {
  visible: boolean;
  locked: boolean;
  streamVisible: boolean;
  recordingVisible: boolean;
  scaleFilter: ScaleFilter;
  blendingMode: BlendingMode;
  blendingMethod: BlendingMethod;
}

export interface SceneItemNode extends SceneItemSettings {
  kind: 'item';
  /** Persistent scene item id (the `id` of the collection file, a uuid). */
  id: string;
  sourceId: string;
  /** Folder id, or null at the root. */
  parentId: string | null;
  canvas: CanvasId;
  transform: Transform;
}

export interface SceneFolderNode {
  kind: 'folder';
  id: string;
  name: string;
  parentId: string | null;
  canvas: CanvasId;
}

export type SceneNode = SceneItemNode | SceneFolderNode;

export interface SceneInfo {
  /** Same string as the scene's source id (`scene_<uuid>` for scenes created by the app). */
  id: string;
  name: string;
}

export interface ScenesState {
  /** Null only while no collection is loaded. */
  activeSceneId: string | null;
  /** In list order (the order of `scenes.items` in the collection file). */
  scenes: SceneInfo[];
}

/** Items of one scene, in display order: index 0 is the top of the list (front-most in the canvas). */
export interface SceneItemsState {
  sceneId: string;
  /** Flat list: a folder is followed by its descendants, `parentId` gives the tree. */
  nodes: SceneNode[];
}

/** Selection of the active scene. Core owns it because OBS draws the selection guides. */
export interface SelectionState {
  sceneId: string | null;
  ids: string[];
  lastId: string | null;
}

export interface CanvasState {
  id: CanvasId;
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  fpsNum: number;
  fpsDen: number;
}

export type MoveDestination =
  | { type: 'before' | 'after'; id: string }
  | { type: 'top' | 'bottom' }
  /** Into a folder, at its top. */
  | { type: 'into'; folderId: string };

export type TransformAction =
  | { type: 'reset' | 'flipX' | 'flipY' | 'stretch' | 'fit' | 'center' }
  | { type: 'rotate'; deg: number };

export interface SceneItemPatch extends Partial<SceneItemSettings> {
  transform?: PartialTransform;
}

export interface ScenesContract extends Contract {
  slices: {
    scenes: ScenesState;
    selection: SelectionState;
    canvases: Partial<Record<CanvasId, CanvasState>>;
    [k: `sceneItems:${string}`]: SceneItemsState;
  };
  commands: {
    scenes: {
      /** Returns the new scene id. `duplicateFrom` copies its items (new item ids, same sources). */
      create(name: string, opts?: { duplicateFrom?: string; makeActive?: boolean }): string;
      remove(sceneId: string): void;
      rename(sceneId: string, name: string): void;
      /** Switches the program scene using the collection's transitions (default: cut). */
      makeActive(sceneId: string): void;
      /** Full new order of scene ids. */
      reorder(sceneIds: string[]): void;
    };
    sceneItems: {
      /** Adds an existing source to a scene. Returns the new item id. */
      add(
        sceneId: string,
        sourceId: string,
        opts?: { canvas?: CanvasId; select?: boolean },
      ): string;
      /** Creates a source and adds it in one step (the "Add source" flow). */
      addNew(
        sceneId: string,
        spec: SourceCreateSpec,
        opts?: { canvas?: CanvasId; select?: boolean },
      ): { sourceId: string; itemId: string };
      /** Removes items and folders (a folder removes its children). */
      remove(sceneId: string, nodeIds: string[]): void;
      /** Applies the same settings patch to several items. */
      update(sceneId: string, itemIds: string[], patch: SceneItemPatch): void;
      /** Per-item transforms in one round trip (multi-selection drag/resize, throttled by the UI). */
      transform(sceneId: string, updates: { id: string; transform: PartialTransform }[]): void;
      /** Moves items by a delta in canvas pixels (arrow-key nudge: atomic, no read-modify-write in the UI). */
      translate(sceneId: string, itemIds: string[], delta: Vec2): void;
      transformAction(sceneId: string, itemIds: string[], action: TransformAction): void;
      move(sceneId: string, nodeIds: string[], to: MoveDestination): void;
      /** Creates a folder; `nodeIds` (optional) are moved into it. Returns the folder id. */
      createFolder(sceneId: string, name: string, nodeIds?: string[]): string;
      renameFolder(sceneId: string, folderId: string, name: string): void;
    };
    selection: {
      set(ids: string[]): void;
      add(ids: string[]): void;
      remove(ids: string[]): void;
      selectAll(): void;
      clear(): void;
    };
  };
  events: {
    'scene.added': { id: string; name: string };
    'scene.removed': { id: string };
    'scene.renamed': { id: string; name: string };
    'scene.switched': { fromId: string | null; toId: string };
    'sceneItem.added': { sceneId: string; id: string; sourceId: string };
    'sceneItem.removed': { sceneId: string; id: string; sourceId: string };
    'sceneItem.updated': { sceneId: string; id: string };
  };
}
