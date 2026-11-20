// Dragging with snapping: port of legacy `util/DragHandler.ts`. Takes the geometry captured at the
// start of the drag and yields absolute positions, so there is no live read-modify-write.
import type { EditorItemGeometry } from '../contracts/editor';
import { type OutputRegion, type Point, cssToCanvas, rectOf } from './geometry';
import { ScalableRectangle } from './rect';

/** Legacy defaults of the OBS General settings (`SnappingEnabled`, `SnapDistance`, ...). */
export interface SnapSettings {
  enabled: boolean;
  /** Screen pixels (CSS px). */
  distance: number;
  screen: boolean;
  source: boolean;
}
export const DEFAULT_SNAP: SnapSettings = {
  enabled: true,
  distance: 10,
  screen: true,
  source: true,
};

/** A source edge: `depth` is the coordinate across, `offset`/`length` the span along. */
interface Edge {
  depth: number;
  offset: number;
  length: number;
}
interface EdgeSet {
  top: Edge[];
  bottom: Edge[];
  left: Edge[];
  right: Edge[];
}

const overlap = (a: Edge, b: Edge) =>
  !(a.offset + a.length < b.offset || b.offset + b.length < a.offset);

function nearest(source: Edge, targets: Edge[]): number {
  let min = Infinity;
  for (const t of targets) {
    if (!overlap(t, source)) continue;
    const d = t.depth - source.depth;
    if (Math.abs(d) < Math.abs(min)) min = d;
  }
  return min;
}

function edgesOf(r: ScalableRectangle) {
  r.normalize();
  const w = r.scaledWidth;
  const h = r.scaledHeight;
  return {
    left: { depth: r.x, offset: r.y, length: h },
    top: { depth: r.y, offset: r.x, length: w },
    right: { depth: r.x + w, offset: r.y, length: h },
    bottom: { depth: r.y + h, offset: r.x, length: w },
  };
}

export interface DragStart {
  /** The item under the cursor that started the drag. */
  dragged: EditorItemGeometry;
  /** Everything that moves with it (the selection), at its start state. */
  moving: EditorItemGeometry[];
  /** All other editable items (snap targets). */
  others: EditorItemGeometry[];
  /** Pointer in canvas px at the start. */
  pointer: Point;
  base: { width: number; height: number };
  region: OutputRegion;
  snap?: SnapSettings;
}

export class DragSession {
  private mouseOffset: Point;
  private targets: EdgeSet;
  private snapDistance: number;
  private snapOn: boolean;

  constructor(private s: DragStart) {
    const snap = s.snap ?? DEFAULT_SNAP;
    this.snapOn = snap.enabled;
    this.snapDistance = cssToCanvas(snap.distance, s.region, s.base.width);
    const rect = new ScalableRectangle(rectOf(s.dragged));
    rect.normalize();
    this.mouseOffset = { x: s.pointer.x - rect.x, y: s.pointer.y - rect.y };

    this.targets = { left: [], top: [], right: [], bottom: [] };
    if (snap.screen) {
      const { width: bw, height: bh } = s.base;
      this.targets.left.push({ depth: 0, offset: 0, length: bh });
      this.targets.top.push({ depth: 0, offset: 0, length: bw });
      this.targets.right.push({ depth: bw, offset: 0, length: bh });
      this.targets.bottom.push({ depth: bh, offset: 0, length: bw });
    }
    if (snap.source) {
      for (const o of s.others) {
        const e = edgesOf(new ScalableRectangle(rectOf(o)));
        // the dragged right edge snaps to the left edge of others, and so on
        this.targets.left.push(e.right);
        this.targets.top.push(e.bottom);
        this.targets.right.push(e.left);
        this.targets.bottom.push(e.top);
      }
    }
  }

  /** New absolute positions for the moving items. Holding Ctrl disables snapping (legacy). */
  move(pointer: Point, ctrl: boolean): { id: string; position: Point }[] {
    const rect = new ScalableRectangle(rectOf(this.s.dragged));
    const denormalize = rect.normalize();
    rect.x = pointer.x - this.mouseOffset.x;
    rect.y = pointer.y - this.mouseOffset.y;

    if (this.snapOn && !ctrl) {
      const e = edgesOf(
        new ScalableRectangle({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          scaleX: rect.scaleX,
          scaleY: rect.scaleY,
          crop: rect.crop,
          rotation: 0,
        }),
      );
      const l = nearest(e.left, this.targets.left);
      const r = nearest(e.right, this.targets.right);
      const t = nearest(e.top, this.targets.top);
      const b = nearest(e.bottom, this.targets.bottom);
      let sx = 0;
      let sy = 0;
      if (Math.abs(l) <= Math.abs(r)) {
        if (Math.abs(l) < this.snapDistance) sx = l;
      } else if (Math.abs(r) < this.snapDistance) sx = r;
      if (Math.abs(t) <= Math.abs(b)) {
        if (Math.abs(t) < this.snapDistance) sy = t;
      } else if (Math.abs(b) < this.snapDistance) sy = b;
      rect.x += sx;
      rect.y += sy;
    }
    denormalize();

    const dx = rect.x - this.s.dragged.x;
    const dy = rect.y - this.s.dragged.y;
    return this.s.moving.map(i => ({ id: i.id, position: { x: i.x + dx, y: i.y + dy } }));
  }
}
