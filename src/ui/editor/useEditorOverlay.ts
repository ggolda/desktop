import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import type { CanvasId, EditorGeometry } from '@/shared/contracts';
import type { OutputRegion } from '@/shared/editor/geometry';
import { selectedItems } from '@/shared/editor/geometry';
import { commands, useSlice } from '@/ui/core';
import { run } from '@/ui/lib/run';
import { occluded } from '@/ui/overlay/occluders';
import { useScenesStore } from '@/ui/stores/scenes';
import { useSourcesStore } from '@/ui/stores/sources';
import { EditorInteraction, type PointerInput } from './interaction';

/** Hover refetch of a stale geometry happens at most this often (only while the pointer moves). */
const REFRESH_MIN_MS = 250;

export interface UseEditorOverlayOptions {
  canvas: CanvasId;
  /** Where the canvas is drawn inside the display placeholder (display slice `outputRegion`). */
  region: () => OutputRegion | null | undefined;
  /** Right click: native context menu. `itemIds` empty = the scene menu. */
  onMenu: (itemIds: string[]) => void;
}

/**
 * Preview editing overlay (SPEC R10): pointer selection, drag, resize, crop, snapping, cursors, arrow
 * key nudge and Delete. Bind `el` to the transparent `div` above the native display. No timers or
 * loops while idle; geometry is fetched from core on demand (editor.getGeometry).
 */
export function useEditorOverlay(opts: UseEditorOverlayOptions) {
  const el: Ref<HTMLElement | null> = ref(null);
  const cursor = ref('default');
  const selection = useSlice('selection');
  const scenes = useScenesStore();
  const sources = useSourcesStore();
  const items = useSlice(() =>
    scenes.activeId ? (`sceneItems:${scenes.activeId}` as const) : undefined,
  );
  const srcSlice = useSlice('sources');
  const canvases = useSlice('canvases');

  let cache: EditorGeometry | null = null;
  let stale = true;
  let fetching: Promise<EditorGeometry | null> | null = null;
  let lastFetch = -Infinity;

  async function fetchGeometry() {
    // a fresh fetch started before this call may predate the change: always ask again at pointerdown
    const p = commands.editor.getGeometry(opts.canvas);
    fetching = p;
    lastFetch = performance.now();
    try {
      const g = await p;
      if (fetching === p) {
        cache = g;
        stale = false;
      }
      return g;
    } finally {
      if (fetching === p) fetching = null;
    }
  }

  // Anything that moves or resizes an item makes the cached geometry stale. Event driven: no polling.
  watch(
    [() => items.value?.nodes, () => srcSlice.value?.sources, () => canvases.value],
    () => (stale = true),
    { flush: 'sync', deep: true },
  );
  watch(
    () => scenes.activeId,
    () => {
      cache = null;
      stale = true;
    },
  );

  const inter = new EditorInteraction({
    fetchGeometry,
    cachedGeometry() {
      if (stale && !fetching && performance.now() - lastFetch > REFRESH_MIN_MS) {
        fetchGeometry().catch(() => undefined);
      }
      return cache;
    },
    region: () => opts.region() ?? null,
    selection: () => ({ ids: selection.value?.ids ?? [] }),
    select: ids => run(commands.selection.set(ids), 'selection.set'),
    addToSelection: ids => run(commands.selection.add(ids), 'selection.add'),
    removeFromSelection: ids => run(commands.selection.remove(ids), 'selection.remove'),
    clearSelection: () => run(commands.selection.clear(), 'selection.clear'),
    sendTransforms: (sceneId, updates) => commands.sceneItems.transform(sceneId, updates),
    openMenu: ids => opts.onMenu(ids),
    setCursor: c => (cursor.value = c),
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  });

  const input = (e: PointerEvent | MouseEvent): PointerInput => {
    const r = el.value!.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      button: e.button,
      buttons: e.buttons,
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
      alt: e.altKey,
    };
  };

  const handlers = {
    onPointerdown(e: PointerEvent) {
      if (!el.value) return;
      el.value.setPointerCapture?.(e.pointerId);
      void inter.pointerDown(input(e));
    },
    onPointermove(e: PointerEvent) {
      if (el.value) void inter.pointerMove(input(e));
    },
    onPointerup(e: PointerEvent) {
      if (!el.value) return;
      if (el.value.hasPointerCapture?.(e.pointerId)) el.value.releasePointerCapture(e.pointerId);
      void inter.pointerUp(input(e));
    },
    onPointercancel() {
      void inter.cancel();
    },
    onDblclick(e: MouseEvent) {
      if (el.value) void inter.doubleClick(input(e));
    },
    onContextmenu(e: Event) {
      e.preventDefault(); // the menu opens on pointerup, like legacy (mouseup, button 2)
    },
  };

  // ---- keyboard: arrows nudge the selection by 1 canvas px, Delete removes it (legacy shortcuts) ----

  let acc = { x: 0, y: 0 };
  let nudging = false;
  function pumpNudge() {
    if (nudging || (!acc.x && !acc.y)) return;
    const geo = cache;
    const sceneId = geo?.sceneId;
    const ids = geo ? selectedItems(geo, selection.value?.ids ?? []) : [];
    const delta = acc;
    acc = { x: 0, y: 0 };
    // legacy: nothing moves while any selected item is locked
    if (!sceneId || !ids.length || ids.some(i => i.locked)) return;
    nudging = true;
    commands.sceneItems
      .translate(
        sceneId,
        ids.map(i => i.id),
        delta,
      )
      .catch(e => console.error('[editor] nudge failed', e))
      .finally(() => {
        nudging = false;
        pumpNudge();
      });
  }

  const NUDGE: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  async function onKeydown(e: KeyboardEvent) {
    // legacy shortcuts match the exact key combination: Shift/Ctrl/Alt+key do nothing
    if (occluded.value || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
      return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const n = NUDGE[e.key];
    if (n) {
      if (!selection.value?.ids.length) return;
      e.preventDefault();
      acc = { x: acc.x + n[0], y: acc.y + n[1] };
      if (!cache || stale) await fetchGeometry().catch(() => undefined);
      pumpNudge();
    } else if (e.key === 'Delete') {
      // legacy: Delete -> globalSelection.remove(), which asks for confirmation (same as the list)
      sources.askRemove();
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    void inter.cancel();
  });

  return { el, cursor, handlers, interaction: inter };
}
