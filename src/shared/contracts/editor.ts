import type { CanvasId, Crop } from './scenes';
import type { Contract } from './types';

// M1 contract: preview editor overlay (SPEC R10, m1-design 9.6). The window hit-tests and computes
// drags locally; core only answers "what is where right now" on demand and applies transforms through
// `sceneItems.transform`. Nothing here is kept current by timers.

/** One scene item as the editor needs it: transform plus the source size right now. */
export interface EditorItemGeometry {
  id: string;
  sourceId: string;
  /** Folder id or null at the root. */
  parentId: string | null;
  /** Canvas base-resolution pixels. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, normalized to 0..360. */
  rotation: number;
  crop: Crop;
  /** Source size in pixels at the time of the call (0 while unknown, e.g. a capture that has no frame). */
  width: number;
  height: number;
  visible: boolean;
  locked: boolean;
}

export interface EditorGeometry {
  sceneId: string;
  canvas: CanvasId;
  baseWidth: number;
  baseHeight: number;
  /** Items in display order, front-most first (same order as the sources list). */
  items: EditorItemGeometry[];
  /** Folders of the scene (for selecting a folder through its children). */
  folders: { id: string; parentId: string | null }[];
}

export interface EditorContract extends Contract {
  slices: Record<never, never>;
  commands: {
    editor: {
      /**
       * Geometry of the active scene for hit testing and drags. Source sizes are read from the backend
       * during the call. Null while no scene/canvas exists.
       */
      getGeometry(canvas?: CanvasId): EditorGeometry | null;
    };
  };
  events: Record<never, never>;
}
