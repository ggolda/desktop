import { describe, expect, it } from 'vitest';
import type { EditorItemGeometry } from '@/shared/contracts';
import { DragSession, type SnapSettings } from '@/shared/editor/drag';
import { boundsOf, selectionBounds } from '@/shared/editor/geometry';
import { type ItemUpdate, cropItem, resizeSelection } from '@/shared/editor/resize';
import { item } from './helpers';

const wide = (id: string, over: Partial<EditorItemGeometry> = {}) =>
  item(id, { width: 200, height: 100, ...over });

const apply = (i: EditorItemGeometry, u: ItemUpdate): EditorItemGeometry => ({
  ...i,
  x: u.position?.x ?? i.x,
  y: u.position?.y ?? i.y,
  scaleX: u.scale?.x ?? i.scaleX,
  scaleY: u.scale?.y ?? i.scaleY,
  crop: { ...i.crop, ...u.crop },
});

const base = { width: 1920, height: 1080 };
// a 960 px wide region for a 1920 canvas: the 10 px snap distance is 20 canvas px
const region = { x: 0, y: 0, width: 960, height: 540 };
const SNAP_OFF: SnapSettings = { enabled: false, distance: 10, screen: true, source: true };

function drag(dragged: EditorItemGeometry, others: EditorItemGeometry[] = [], snap?: SnapSettings) {
  // the pointer grabs the item at (50, 50) from its top-left corner
  return new DragSession({
    dragged,
    moving: [dragged],
    others,
    pointer: { x: dragged.x + 50, y: dragged.y + 50 },
    base,
    region,
    snap,
  });
}

describe('drag with snapping', () => {
  it('moves by the pointer delta when nothing is near', () => {
    const a = wide('a', { x: 300, y: 300 });
    expect(drag(a).move({ x: 390, y: 370 }, false)).toEqual([
      { id: 'a', position: { x: 340, y: 320 } },
    ]);
  });

  it('snaps the left and top edge to the canvas edge within the snap distance', () => {
    const a = wide('a', { x: 300, y: 300 });
    // the item would end at x=12, y=-15: both within 20 canvas px of the canvas edge
    expect(drag(a).move({ x: 62, y: 35 }, false)[0].position).toEqual({ x: 0, y: 0 });
    // 25 px away is outside the snap distance
    expect(drag(a).move({ x: 75, y: 75 }, false)[0].position).toEqual({ x: 25, y: 25 });
  });

  it('snaps the right and bottom edge to the canvas', () => {
    const a = wide('a', { x: 300, y: 300 });
    // right edge at 1920-10, bottom at 1080-15
    expect(
      drag(a).move({ x: 1920 - 10 - 200 + 50, y: 1080 - 15 - 100 + 50 }, false)[0].position,
    ).toEqual({
      x: 1720,
      y: 980,
    });
  });

  it('snaps to the adjacent edge of another source', () => {
    const a = wide('a', { x: 100, y: 100 });
    const other = wide('o', { x: 1000, y: 100 });
    // the dragged right edge lands at 988: snaps to the left edge of the other source (1000)
    expect(drag(a, [other]).move({ x: 788 + 50, y: 100 + 50 }, false)[0].position.x).toBe(800);
    // vertical spans must overlap: an item far below does not attract
    const farBelow = wide('o', { x: 1000, y: 700 });
    expect(drag(a, [farBelow]).move({ x: 788 + 50, y: 150 }, false)[0].position.x).toBe(788);
  });

  it('Ctrl disables snapping, as does the setting', () => {
    const a = wide('a', { x: 300, y: 300 });
    expect(drag(a).move({ x: 62, y: 350 }, true)[0].position.x).toBe(12);
    expect(drag(a, [], SNAP_OFF).move({ x: 62, y: 350 }, false)[0].position.x).toBe(12);
  });

  it('moves the whole selection by the same delta', () => {
    const a = wide('a', { x: 300, y: 300 });
    const b = wide('b', { x: 700, y: 400 });
    const d = new DragSession({
      dragged: a,
      moving: [a, b],
      others: [],
      pointer: { x: 350, y: 350 },
      base,
      region,
      snap: SNAP_OFF,
    });
    expect(d.move({ x: 450, y: 400 }, false)).toEqual([
      { id: 'a', position: { x: 400, y: 350 } },
      { id: 'b', position: { x: 800, y: 450 } },
    ]);
  });
});

describe('resize', () => {
  const a = wide('a', { x: 100, y: 100 }); // visual box 100,100 200x100

  it('the se corner keeps the north-west corner fixed and the aspect ratio', () => {
    const box = selectionBounds([a])!;
    const r = apply(a, resizeSelection([a], box, 'se', { x: 500, y: 250 }, true)[0]);
    const b = boundsOf(r);
    expect(b.x).toBeCloseTo(100);
    expect(b.y).toBeCloseTo(100);
    // dx = 400/200 = 2, dy = 150/100 = 1.5: the ratio lock takes the larger
    expect(r.scaleX).toBeCloseTo(2);
    expect(r.scaleY).toBeCloseTo(2);
  });

  it('Shift (lock off) scales the axes separately', () => {
    const box = selectionBounds([a])!;
    const r = apply(a, resizeSelection([a], box, 'se', { x: 500, y: 250 }, false)[0]);
    expect(r.scaleX).toBeCloseTo(2);
    expect(r.scaleY).toBeCloseTo(1.5);
  });

  it('edge handles change one axis, with the ratio lock the other one follows', () => {
    const box = selectionBounds([a])!;
    const free = apply(a, resizeSelection([a], box, 'e', { x: 500, y: 999 }, false)[0]);
    expect(free.scaleX).toBeCloseTo(2);
    expect(free.scaleY).toBeCloseTo(1);
    const locked = apply(a, resizeSelection([a], box, 'e', { x: 500, y: 999 }, true)[0]);
    expect(locked.scaleY).toBeCloseTo(2);
  });

  it('the nw handle anchors the south-east corner', () => {
    const box = selectionBounds([a])!;
    const r = apply(a, resizeSelection([a], box, 'nw', { x: 200, y: 150 }, true)[0]);
    const b = boundsOf(r);
    expect(b.x + b.width).toBeCloseTo(300);
    expect(b.y + b.height).toBeCloseTo(200);
    expect(r.scaleX).toBeCloseTo(0.5);
  });

  it('a flipped item keeps its flip and its visual anchor', () => {
    const f = wide('f', { x: 300, y: 100, scaleX: -1 }); // visual x 100..300
    const box = selectionBounds([f])!;
    const r = apply(f, resizeSelection([f], box, 'se', { x: 500, y: 200 }, false)[0]);
    expect(r.scaleX).toBeLessThan(0);
    const b = boundsOf(r);
    expect(b.x).toBeCloseTo(100);
    expect(b.width).toBeCloseTo(400);
  });

  it('scales a multi selection around the selection box', () => {
    const b2 = wide('b', { x: 400, y: 100 });
    const box = selectionBounds([a, b2])!; // 100..600 x 100..200
    const ups = resizeSelection([a, b2], box, 'se', { x: 1100, y: 200 }, false);
    const ra = apply(a, ups[0]);
    const rb = apply(b2, ups[1]);
    expect(ra.scaleX).toBeCloseTo(2);
    expect(boundsOf(ra).x).toBeCloseTo(100);
    expect(boundsOf(rb).x).toBeCloseTo(100 + (400 - 100) * 2);
  });

  it('never collapses below 1 canvas px', () => {
    const box = selectionBounds([a])!;
    const r = apply(a, resizeSelection([a], box, 'se', { x: 100, y: 100 }, false)[0]);
    expect(boundsOf(r).width).toBeGreaterThanOrEqual(1);
  });
});

describe('crop (Alt + edge handle)', () => {
  const a = wide('a', { x: 100, y: 100 });
  it('the east handle crops the right side, the west handle the left', () => {
    // legacy keeps 2 px of the source uncroppable, so dragging the edge to x=250 crops 48 px
    const e = cropItem(a, 'e', { x: 250, y: 150 })!;
    expect(e.crop?.right).toBe(48);
    expect(e.position).toEqual({ x: 100, y: 100 });
    const w = cropItem(a, 'w', { x: 150, y: 150 })!;
    expect(w.crop?.left).toBe(48);
    expect(w.position?.x).toBe(148);
  });
  it('corner handles do not crop', () => {
    expect(cropItem(a, 'se', { x: 250, y: 150 })).toBeNull();
  });
  it('the crop is clamped to the source size', () => {
    const e = cropItem(a, 'e', { x: -500, y: 150 })!;
    expect(e.crop?.right).toBe(198);
  });
});
