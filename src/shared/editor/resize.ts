// Resize and crop math of the legacy editor (services/editor.ts resize()/crop(), SceneItem.scale*).
// Computed from the state captured at pointerdown so a drag never accumulates rounding or lag; the
// result is an absolute transform per item.
import type { EditorItemGeometry } from '../contracts/editor';
import type { HandleName, Point } from './geometry';
import { rectOf } from './geometry';
import {
  AnchorPoint,
  AnchorPositions,
  type Box,
  type Vec2,
  ScalableRectangle,
  offsetFromOrigin,
  originFromOffset,
} from './rect';

export interface ItemUpdate {
  id: string;
  position?: Partial<Vec2>;
  scale?: Partial<Vec2>;
  crop?: Partial<{ left: number; top: number; right: number; bottom: number }>;
}

/** The anchor is the point opposite the dragged handle; `lockX`/`lockY` freeze one axis (edge handles). */
const HANDLE_OPTIONS: Record<
  HandleName,
  { anchor: AnchorPoint; lockX?: boolean; lockY?: boolean }
> = {
  nw: { anchor: AnchorPoint.SouthEast },
  sw: { anchor: AnchorPoint.NorthEast },
  ne: { anchor: AnchorPoint.SouthWest },
  se: { anchor: AnchorPoint.NorthWest },
  n: { anchor: AnchorPoint.South, lockX: true },
  s: { anchor: AnchorPoint.North, lockX: true },
  e: { anchor: AnchorPoint.West, lockY: true },
  w: { anchor: AnchorPoint.East, lockY: true },
};

const CORNERS = [
  AnchorPoint.SouthEast,
  AnchorPoint.SouthWest,
  AnchorPoint.NorthEast,
  AnchorPoint.NorthWest,
];
const OPPOSITE: Record<number, number> = { 0: 1, 0.5: 0.5, 1: 0 };

/** Smallest scaled size an item can be dragged to (canvas px). Legacy let it collapse to 0. */
const MIN_SIZE = 1;

/** Delta scale of the selection for the pointer position (legacy `resize`). `box` = selection bounds at start. */
export function resizeDelta(
  box: Box,
  handle: HandleName,
  pointer: Point,
  lockRatio: boolean,
): { delta: Vec2; origin: Vec2 } {
  const opts = HANDLE_OPTIONS[handle];
  const origin = AnchorPositions[opts.anchor];
  const anchorPos = offsetFromOrigin(box, origin);
  // the dragged handle sits opposite the anchor; scaleVector is the direction of resizing
  const vx = OPPOSITE[origin.x] - origin.x;
  const vy = OPPOSITE[origin.y] - origin.y;
  let dx = 1;
  let dy = 1;
  if (vx && !opts.lockX) dx = Math.max(Math.abs(pointer.x - anchorPos.x), MIN_SIZE) / box.width;
  if (vy && !opts.lockY) dy = Math.max(Math.abs(pointer.y - anchorPos.y), MIN_SIZE) / box.height;
  if (lockRatio) {
    if (CORNERS.includes(opts.anchor)) dx = dy = Math.max(dx, dy);
    else if (vx) dy = dx;
    else dx = dy;
  }
  return { delta: { x: dx, y: dy }, origin };
}

/**
 * Applies a delta scale to one item around an absolute point (legacy `SceneItem.scaleWithOffset` ->
 * `scale` -> `setScale`). Returns the new absolute position and scale.
 */
export function scaleItemAround(
  item: EditorItemGeometry,
  delta: Vec2,
  offset: Vec2,
): { position: Vec2; scale: Vec2 } {
  const bounds = new ScalableRectangle(rectOf(item));
  bounds.normalize();
  const origin = originFromOffset(
    { x: bounds.x, y: bounds.y, width: bounds.scaledWidth, height: bounds.scaledHeight },
    offset,
  );

  const rect = new ScalableRectangle(rectOf(item));
  let cur: Vec2 = { x: 1, y: 1 };
  rect.normalized(() => (cur = { x: rect.scaleX, y: rect.scaleY }));
  const next = { x: delta.x * cur.x, y: delta.y * cur.y };
  rect.normalized(() => {
    rect.withOrigin(origin, () => {
      rect.scaleX = next.x;
      rect.scaleY = next.y;
    });
  });
  return { position: { x: rect.x, y: rect.y }, scale: { x: rect.scaleX, y: rect.scaleY } };
}

/** Resize of a whole selection from the state at pointerdown. */
export function resizeSelection(
  start: EditorItemGeometry[],
  box: Box,
  handle: HandleName,
  pointer: Point,
  lockRatio: boolean,
): ItemUpdate[] {
  const { delta, origin } = resizeDelta(box, handle, pointer, lockRatio);
  const anchor = offsetFromOrigin(box, origin);
  return start.map(item => ({ id: item.id, ...scaleItemAround(item, delta, anchor) }));
}

/** Legacy crop (Alt + edge handle): only edge handles crop, corners do nothing. */
export function cropItem(
  item: EditorItemGeometry,
  handle: HandleName,
  pointer: Point,
): ItemUpdate | null {
  const opts = HANDLE_OPTIONS[handle];
  const rect = new ScalableRectangle(rectOf(item));
  let changed = false;
  rect.normalized(() => {
    rect.withAnchor(opts.anchor, () => {
      const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
      switch (opts.anchor) {
        case AnchorPoint.East: {
          const croppable = rect.width - rect.crop.right - 2;
          const distance = croppable * rect.scaleX - (rect.x - pointer.x);
          rect.crop.left = Math.round(clamp(distance / rect.scaleX, 0, croppable));
          changed = true;
          break;
        }
        case AnchorPoint.West: {
          const croppable = rect.width - rect.crop.left - 2;
          const distance = croppable * rect.scaleX + (rect.x - pointer.x);
          rect.crop.right = Math.round(clamp(distance / rect.scaleX, 0, croppable));
          changed = true;
          break;
        }
        case AnchorPoint.South: {
          const croppable = rect.height - rect.crop.bottom - 2;
          const distance = croppable * rect.scaleY - (rect.y - pointer.y);
          rect.crop.top = Math.round(clamp(distance / rect.scaleY, 0, croppable));
          changed = true;
          break;
        }
        case AnchorPoint.North: {
          const croppable = rect.height - rect.crop.top - 2;
          const distance = croppable * rect.scaleY + (rect.y - pointer.y);
          rect.crop.bottom = Math.round(clamp(distance / rect.scaleY, 0, croppable));
          changed = true;
          break;
        }
      }
    });
  });
  if (!changed) return null;
  return { id: item.id, position: { x: rect.x, y: rect.y }, crop: { ...rect.crop } };
}
