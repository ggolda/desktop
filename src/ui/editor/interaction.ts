// Preview editor interaction (legacy `services/editor.ts` mouse handling), framework-free so it can be
// tested without a DOM. The Vue glue (`useEditorOverlay`) feeds it pointer events and wires `deps`.
//
// Performance: no timers or loops while idle. Geometry is fetched on demand (pointerdown, hover with a
// stale cache). While dragging, transform updates are throttled to <= 30/s with a latest-wins sender and
// the exact final value is sent on pointerup.
import type { EditorGeometry, EditorItemGeometry, PartialTransform } from '@/shared/contracts';
import { DEFAULT_SNAP, DragSession, type SnapSettings } from '@/shared/editor/drag';
import {
  HANDLE_CURSORS,
  type HandleName,
  type OutputRegion,
  type Point,
  cssToCanvas,
  handleAt,
  isEditable,
  itemsAt,
  selectedItems,
  selectionBounds,
  toCanvas,
} from '@/shared/editor/geometry';
import type { Box } from '@/shared/editor/rect';
import { type ItemUpdate, cropItem, resizeSelection } from '@/shared/editor/resize';

export interface PointerInput {
  /** CSS px relative to the display placeholder's top-left. */
  x: number;
  y: number;
  button: number;
  buttons: number;
  /** Ctrl (Cmd on macOS). */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface TransformUpdate {
  id: string;
  transform: PartialTransform;
}

export interface EditorDeps {
  /** Fresh geometry from core (source sizes read now). */
  fetchGeometry(): Promise<EditorGeometry | null>;
  /** Last fetched geometry, may be stale (hover only). */
  cachedGeometry(): EditorGeometry | null;
  region(): OutputRegion | null;
  selection(): { ids: readonly string[] };
  select(ids: string[]): void;
  addToSelection(ids: string[]): void;
  removeFromSelection(ids: string[]): void;
  clearSelection(): void;
  /** One transform command (latest wins, never more than one in flight). */
  sendTransforms(sceneId: string, updates: TransformUpdate[]): Promise<void>;
  /** Right click: the native context menu. `itemIds` empty = the scene menu. */
  openMenu(itemIds: string[]): void;
  setCursor(cursor: string): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  snap?: SnapSettings;
}

export const SEND_INTERVAL_MS = 1000 / 30;
/** Half-size of a resize handle's hit square, screen px (OBS draws the handles 8 px wide). */
export const HANDLE_RADIUS = 6;

type Mode =
  | { kind: 'idle' }
  | { kind: 'pressed'; down: PointerInput; geo: EditorGeometry; canDrag: boolean }
  | { kind: 'drag'; geo: EditorGeometry; session: DragSession }
  | {
      kind: 'resize';
      geo: EditorGeometry;
      handle: HandleName;
      item: EditorItemGeometry;
      start: EditorItemGeometry[];
      box: Box;
      crop: boolean;
    };

const toTransform = (u: ItemUpdate): TransformUpdate => ({
  id: u.id,
  transform: {
    ...(u.position && { position: u.position }),
    ...(u.scale && { scale: u.scale }),
    ...(u.crop && { crop: u.crop }),
  },
});

export class EditorInteraction {
  private mode: Mode = { kind: 'idle' };
  private cursor = 'default';
  private queue: Promise<void> = Promise.resolve();
  private pendingEvents = 0;
  private lastMove: PointerInput | null = null;
  private moveQueued = false;

  // throttled sender
  private latest: { sceneId: string; updates: TransformUpdate[] } | null = null;
  private inflight: Promise<void> | null = null;
  private timer: unknown = null;
  private lastSent = -Infinity;

  constructor(private d: EditorDeps) {}

  get dragging() {
    return this.mode.kind === 'drag' || this.mode.kind === 'resize';
  }

  // ---- event entry points (serialized: an event never overtakes the geometry fetch of pointerdown) --

  pointerDown(e: PointerInput): Promise<void> {
    return this.enqueue(() => this.onDown(e));
  }

  pointerMove(e: PointerInput): Promise<void> {
    this.lastMove = e;
    if (this.mode.kind === 'idle' && this.pendingEvents === 0) {
      this.onHover(e); // local math only, nothing to order
      return Promise.resolve();
    }
    // coalesce: only the latest pointer position is processed when the queue gets there
    if (this.moveQueued) return this.queue;
    this.moveQueued = true;
    return this.enqueue(() => {
      this.moveQueued = false;
      const m = this.lastMove;
      return m ? this.onMove(m) : undefined;
    });
  }

  pointerUp(e: PointerInput): Promise<void> {
    return this.enqueue(() => this.onUp(e));
  }

  /** Pointer cancelled or capture lost: drop the gesture; a drag keeps what was already sent. */
  cancel(): Promise<void> {
    return this.enqueue(async () => {
      this.mode = { kind: 'idle' };
      await this.flush();
    });
  }

  /** Double click: select the item itself (inside a folder it picks the item, not the folder). */
  doubleClick(e: PointerInput): Promise<void> {
    return this.enqueue(async () => {
      const geo = await this.d.fetchGeometry();
      const p = geo && this.canvasPoint(e, geo);
      if (!geo || !p) return;
      const over = itemsAt(geo, p);
      if (over.length) this.d.select([over[0].id]);
    });
  }

  private enqueue(fn: () => void | Promise<void>): Promise<void> {
    this.pendingEvents++;
    this.queue = this.queue
      .then(fn)
      .catch(e => console.error('[editor] interaction failed', e))
      .finally(() => this.pendingEvents--);
    return this.queue;
  }

  // ---- helpers ----------------------------------------------------------------------------------

  private canvasPoint(e: { x: number; y: number }, geo: EditorGeometry): Point | null {
    const region = this.d.region();
    if (!region || region.width <= 0 || region.height <= 0) return null;
    return toCanvas(e, region, { width: geo.baseWidth, height: geo.baseHeight });
  }

  private selectedOf(geo: EditorGeometry) {
    return selectedItems(geo, this.d.selection().ids);
  }

  private setCursor(c: string) {
    if (c !== this.cursor) {
      this.cursor = c;
      this.d.setCursor(c);
    }
  }

  private handleHit(geo: EditorGeometry, p: Point) {
    const region = this.d.region();
    if (!region) return null;
    return handleAt(this.selectedOf(geo), p, cssToCanvas(HANDLE_RADIUS, region, geo.baseWidth));
  }

  // ---- hover -------------------------------------------------------------------------------------

  private onHover(e: PointerInput) {
    const geo = this.d.cachedGeometry();
    if (!geo) return this.setCursor('default');
    this.hoverCursor(geo, e);
  }

  private hoverCursor(geo: EditorGeometry, e: PointerInput) {
    const p = this.canvasPoint(e, geo);
    if (!p) return this.setCursor('default');
    const h = this.handleHit(geo, p);
    if (h) return this.setCursor(HANDLE_CURSORS[h.name]);
    this.setCursor(itemsAt(geo, p).length ? 'grab' : 'default');
  }

  // ---- down / move / up --------------------------------------------------------------------------

  private async onDown(e: PointerInput) {
    const geo = await this.d.fetchGeometry();
    if (!geo) return;
    const p = this.canvasPoint(e, geo);
    if (!p) return;

    if (e.button === 0) {
      const h = this.handleHit(geo, p);
      if (h) {
        const start = this.selectedOf(geo).filter(isEditable);
        const box = selectionBounds(start);
        if (box) {
          this.mode = {
            kind: 'resize',
            geo,
            handle: h.name,
            item: h.item,
            start,
            box,
            crop: e.alt,
          };
          this.setCursor(HANDLE_CURSORS[h.name]);
          return;
        }
      }
    }
    // legacy: pressing past every source forbids starting a drag
    this.mode = { kind: 'pressed', down: e, geo, canDrag: itemsAt(geo, p).length > 0 };
    this.hoverCursor(geo, e);
  }

  private async onMove(e: PointerInput) {
    const m = this.mode;
    if (m.kind === 'idle') return this.onHover(e);
    const p = this.canvasPoint(e, m.geo);
    if (!p) return;

    if (m.kind === 'resize') {
      let updates: ItemUpdate[];
      if (m.crop) {
        const u = cropItem(m.item, m.handle, p);
        updates = u ? [u] : [];
      } else {
        updates = resizeSelection(m.start, m.box, m.handle, p, !e.shift);
      }
      this.submit(m.geo.sceneId, updates.map(toTransform));
      return;
    }
    if (m.kind === 'drag') {
      const moved = m.session.move(p, e.ctrl);
      this.submit(
        m.geo.sceneId,
        moved.map(u => ({ id: u.id, transform: { position: u.position } })),
      );
      return;
    }

    // pressed: maybe start dragging (legacy handleMouseMove with the primary button down)
    if (!(e.buttons & 1) || !m.canDrag) return;
    // legacy starts on the first move with the button down; only a zero-distance move event (no
    // actual movement) is ignored so a plain click can never nudge or select-drag. The drag is
    // anchored at the press point, so the first delta is applied (legacy anchored at the first move
    // event and silently lost it).
    if (e.x === m.down.x && e.y === m.down.y) return;
    const geo = m.geo;
    const startP = this.canvasPoint(m.down, geo) ?? p;
    const selected = this.selectedOf(geo).filter(isEditable);
    // legacy priority: selected items first, then the scene (front-most first)
    const hit = [...selected, ...geo.items.filter(isEditable)].find(
      i => itemsAt({ ...geo, items: [i] }, startP).length > 0,
    );
    if (!hit) return;

    const isSelected = selected.some(i => i.id === hit.id);
    // an unselected item inside a folder drags its folder
    const node = !isSelected && hit.parentId ? hit.parentId : hit.id;
    const current = this.d.selection().ids;
    let ids: string[];
    if (m.down.ctrl || isSelected || current.includes(node)) {
      ids = [...new Set([...current, node])];
      this.d.addToSelection([node]);
    } else {
      ids = [node];
      this.d.select([node]);
    }
    const moving = selectedItems(geo, ids).filter(isEditable);
    const dragged = moving.find(i => i.id === hit.id);
    const region = this.d.region();
    if (!dragged || !region) return;
    this.mode = {
      kind: 'drag',
      geo,
      session: new DragSession({
        dragged,
        moving,
        others: geo.items.filter(i => isEditable(i) && !moving.some(x => x.id === i.id)),
        pointer: startP,
        base: { width: geo.baseWidth, height: geo.baseHeight },
        region,
        snap: this.d.snap ?? DEFAULT_SNAP,
      }),
    };
    this.setCursor('grabbing');
    await this.onMove(e);
  }

  private async onUp(e: PointerInput) {
    const m = this.mode;
    if (m.kind === 'resize' || m.kind === 'drag') {
      // the exact final value comes from the release position
      await this.onMove(e);
      this.mode = { kind: 'idle' };
      await this.flush();
      this.hoverCursor(m.geo, e);
      return;
    }
    this.mode = { kind: 'idle' };
    if (m.kind !== 'pressed') return;
    this.click(m.geo, e);
    this.hoverCursor(m.geo, e);
  }

  /** A press and release without drag or resize: selection, deselection or the context menu. */
  private click(geo: EditorGeometry, e: PointerInput) {
    const p = this.canvasPoint(e, geo);
    if (!p) return;
    const over = itemsAt(geo, p);
    const ids = this.d.selection().ids;
    const selected = this.selectedOf(geo);
    const overSelected = selected.find(i => over.some(o => o.id === i.id));

    if (e.button === 0) {
      if (!over.length) return this.d.clearSelection();
      const top = over[0];
      if (e.ctrl) {
        // Ctrl adds or removes from a multi selection
        if (selected.some(i => i.id === top.id)) this.deselectItem(geo, top, ids);
        else this.d.addToSelection([top.id]);
      } else if (overSelected && over.length > 1) {
        // clicking the selection again cycles through the items stacked under the cursor
        const at = over.findIndex(o => o.id === overSelected.id);
        this.d.select([over[(at + 1) % over.length].id]);
      } else {
        this.d.select([top.id]);
      }
    } else if (e.button === 2) {
      if (overSelected) this.d.openMenu(ids.length ? [...ids] : [overSelected.id]);
      else if (over.length) {
        this.d.select([over[0].id]);
        this.d.openMenu([over[0].id]);
      } else this.d.openMenu([]);
    }
  }

  /** Removes one item from a selection that may hold it through a folder. */
  private deselectItem(geo: EditorGeometry, item: EditorItemGeometry, ids: readonly string[]) {
    if (ids.includes(item.id)) return this.d.removeFromSelection([item.id]);
    // selected through a folder: keep its other children selected explicitly
    this.d.select(
      selectedItems(geo, ids)
        .filter(i => i.id !== item.id)
        .map(i => i.id),
    );
  }

  // ---- throttled sender ---------------------------------------------------------------------------

  private submit(sceneId: string, updates: TransformUpdate[]) {
    if (!updates.length) return;
    this.latest = { sceneId, updates };
    this.schedule();
  }

  private schedule() {
    if (this.inflight || this.timer !== null) return;
    const wait = Math.max(0, SEND_INTERVAL_MS - (this.d.now() - this.lastSent));
    if (wait <= 0) this.send();
    else
      this.timer = this.d.setTimer(() => {
        this.timer = null;
        this.send();
      }, wait);
  }

  private send() {
    const job = this.latest;
    if (!job) return;
    this.latest = null;
    this.lastSent = this.d.now();
    this.inflight = this.d
      .sendTransforms(job.sceneId, job.updates)
      .catch(e => console.error('[editor] transform failed', e))
      .finally(() => {
        this.inflight = null;
        if (this.latest) this.schedule();
      });
  }

  /** Sends whatever is pending and waits for it (pointerup: the exact final value). */
  async flush() {
    if (this.timer !== null) {
      this.d.clearTimer(this.timer);
      this.timer = null;
    }
    while (this.inflight || this.latest) {
      if (!this.inflight) this.send();
      await this.inflight;
    }
  }
}
