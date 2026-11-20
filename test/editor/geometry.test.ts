import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  cssToCanvas,
  handleAt,
  handlePoints,
  itemsAt,
  selectedItems,
  selectionBounds,
  toCanvas,
} from '@/shared/editor/geometry';
import { geo, item } from './helpers';

describe('coordinate mapping', () => {
  // canvas 1920x1080 drawn in a 960x540 region offset (20, 10) inside the placeholder
  const region = { x: 20, y: 10, width: 960, height: 540 };
  const base = { width: 1920, height: 1080 };
  it('maps CSS px relative to the placeholder to canvas px', () => {
    expect(toCanvas({ x: 20, y: 10 }, region, base)).toEqual({ x: 0, y: 0 });
    expect(toCanvas({ x: 980, y: 550 }, region, base)).toEqual({ x: 1920, y: 1080 });
    expect(toCanvas({ x: 500, y: 280 }, region, base)).toEqual({ x: 960, y: 540 });
    // outside the canvas (letterbox): negative coordinates, still valid
    expect(toCanvas({ x: 0, y: 0 }, region, base)).toEqual({ x: -40, y: -20 });
  });
  it('converts screen distances to canvas distances (snap distance, handle radius)', () => {
    expect(cssToCanvas(10, region, 1920)).toBe(20);
  });
});

describe('hit testing', () => {
  it('returns items front-most first, ignoring hidden, locked and size-less ones', () => {
    const g = geo([
      item('hidden', { visible: false }),
      item('locked', { locked: true }),
      item('nosize', { width: 0, height: 0 }),
      item('top', { x: 10, y: 10 }),
      item('below', { x: 0, y: 0 }),
      item('far', { x: 500, y: 500 }),
    ]);
    expect(itemsAt(g, { x: 20, y: 20 }).map(i => i.id)).toEqual(['top', 'below']);
    expect(itemsAt(g, { x: 5, y: 5 }).map(i => i.id)).toEqual(['below']);
    expect(itemsAt(g, { x: 300, y: 300 })).toEqual([]);
  });
  it('uses scale, crop and flips for the bounds', () => {
    const flipped = item('f', { x: 200, y: 0, scaleX: -2 }); // draws from x=0..200
    expect(boundsOf(flipped)).toEqual({ x: 0, y: 0, width: 200, height: 50 });
    const cropped = item('c', { crop: { left: 10, right: 10, top: 5, bottom: 5 } });
    expect(boundsOf(cropped)).toEqual({ x: 0, y: 0, width: 80, height: 40 });
  });
  it('handles 90 degree rotation: the visual box is swapped', () => {
    const r = item('r', { x: 100, y: 0, rotation: 90 });
    const b = boundsOf(r);
    expect(b.width).toBe(50);
    expect(b.height).toBe(100);
    expect(itemsAt(geo([r]), { x: b.x + 1, y: b.y + 1 }).length).toBe(1);
  });
});

describe('selection helpers', () => {
  const folderGeo = geo(
    [item('a', { parentId: 'f' }), item('b', { parentId: 'f', x: 200 }), item('c', { x: 400 })],
    [{ id: 'f', parentId: null }],
  );
  it('a selected folder selects its children', () => {
    expect(selectedItems(folderGeo, ['f']).map(i => i.id)).toEqual(['a', 'b']);
    expect(selectedItems(folderGeo, ['c']).map(i => i.id)).toEqual(['c']);
    expect(selectedItems(folderGeo, [])).toEqual([]);
  });
  it('bounding box is the union of the visual bounds of editable items', () => {
    const items = selectedItems(folderGeo, ['f', 'c']);
    expect(selectionBounds(items)).toEqual({ x: 0, y: 0, width: 500, height: 50 });
    expect(selectionBounds([item('x', { locked: true })])).toBeNull();
  });
});

describe('resize handles', () => {
  it('finds the handle under the point, per selected item', () => {
    const a = item('a', { x: 100, y: 100 });
    const pts = Object.fromEntries(handlePoints(boundsOf(a)));
    expect(pts.nw).toEqual({ x: 100, y: 100 });
    expect(pts.se).toEqual({ x: 200, y: 150 });
    expect(handleAt([a], { x: 201, y: 151 }, 4)?.name).toBe('se');
    expect(handleAt([a], { x: 150, y: 100 }, 4)?.name).toBe('n');
    expect(handleAt([a], { x: 150, y: 125 }, 4)).toBeNull();
  });
});
