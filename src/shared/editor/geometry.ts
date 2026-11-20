// Pure editor geometry: pointer <-> canvas mapping, item bounds, hit testing and resize handles.
// Everything is in canvas base-resolution pixels unless noted. Behavior follows legacy
// `services/editor.ts` (isOverSource, getOverSources, generateResizeRegionsForItem).
import type { EditorGeometry, EditorItemGeometry } from '../contracts/editor';
import { type Box, type ScalableRectInit, ScalableRectangle, boundingBox } from './rect';

export interface Point {
  x: number;
  y: number;
}

/** Where the canvas is drawn inside the display placeholder, in CSS px relative to its top-left. */
export interface OutputRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pointer position in CSS px relative to the placeholder -> canvas pixels (legacy convertVectorToBaseSpace). */
export function toCanvas(
  p: Point,
  region: OutputRegion,
  base: { width: number; height: number },
): Point {
  return {
    x: ((p.x - region.x) * base.width) / region.width,
    y: ((p.y - region.y) * base.height) / region.height,
  };
}

/** Canvas distance of `cssPx` screen pixels (snap distance, handle radius). */
export function cssToCanvas(cssPx: number, region: OutputRegion, baseWidth: number): number {
  return (cssPx * baseWidth) / region.width;
}

export const rectOf = (g: EditorItemGeometry): ScalableRectInit => ({
  x: g.x,
  y: g.y,
  width: g.width,
  height: g.height,
  scaleX: g.scaleX,
  scaleY: g.scaleY,
  crop: g.crop,
  rotation: g.rotation,
});

export const scalableOf = (g: EditorItemGeometry) => new ScalableRectangle(rectOf(g));

/** Visual bounds (normalized, scaled, cropped). */
export const boundsOf = (g: EditorItemGeometry): Box => boundingBox(rectOf(g));

/** Legacy `isVisualSource` plus visibility: the editor ignores hidden, locked and size-less items. */
export const isEditable = (g: EditorItemGeometry) =>
  g.visible && !g.locked && g.width > 0 && g.height > 0;

export const containsPoint = (b: Box, p: Point) =>
  !(p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height);

/** Items under the point, front-most first. */
export function itemsAt(geo: EditorGeometry, p: Point): EditorItemGeometry[] {
  return geo.items.filter(i => isEditable(i) && containsPoint(boundsOf(i), p));
}

/** Ids of the items covered by a selection (ids may be folders: their descendants count). */
export function selectedItems(geo: EditorGeometry, ids: readonly string[]): EditorItemGeometry[] {
  if (!ids.length) return [];
  const wanted = new Set(ids);
  const parent = new Map<string, string | null>();
  for (const f of geo.folders) parent.set(f.id, f.parentId);
  const covered = (i: EditorItemGeometry) => {
    if (wanted.has(i.id)) return true;
    for (let p = i.parentId; p; p = parent.get(p) ?? null) if (wanted.has(p)) return true;
    return false;
  };
  return geo.items.filter(covered);
}

/** Union of the visual bounds (legacy `Selection.getBoundingRect`). Null when nothing is editable. */
export function selectionBounds(items: EditorItemGeometry[]): Box | null {
  const list = items.filter(isEditable);
  if (!list.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of list) {
    const b = boundsOf(i);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type HandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_CURSORS: Record<HandleName, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** Handle centers of a box, in legacy order (nw, n, ne, e, se, s, sw, w). */
export function handlePoints(b: Box): [HandleName, Point][] {
  const l = b.x;
  const r = b.x + b.width;
  const t = b.y;
  const bo = b.y + b.height;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return [
    ['nw', { x: l, y: t }],
    ['n', { x: cx, y: t }],
    ['ne', { x: r, y: t }],
    ['e', { x: r, y: cy }],
    ['se', { x: r, y: bo }],
    ['s', { x: cx, y: bo }],
    ['sw', { x: l, y: bo }],
    ['w', { x: l, y: cy }],
  ];
}

/**
 * The resize handle under the point. Like legacy, every selected item has its own eight handles (OBS
 * draws a box per item) and the first match wins; the caller resizes the whole selection.
 * `radius` is the half-size of a handle's hit square in canvas pixels.
 */
export function handleAt(
  selected: EditorItemGeometry[],
  p: Point,
  radius: number,
): { name: HandleName; item: EditorItemGeometry } | null {
  for (const item of selected) {
    if (!isEditable(item)) continue;
    for (const [name, c] of handlePoints(boundsOf(item))) {
      if (Math.abs(p.x - c.x) <= radius && Math.abs(p.y - c.y) <= radius) return { name, item };
    }
  }
  return null;
}
