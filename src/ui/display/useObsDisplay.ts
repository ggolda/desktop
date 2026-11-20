import { onMounted, onScopeDispose, shallowRef, watch } from 'vue';
import type { CanvasId, DisplayCreateOptions, DisplayView } from '@/shared/contracts';
import { commands, useSlice } from '@/ui/core';
import { occluded } from '@/ui/overlay/occluders';
import { createDisplayTracker, type Tracker, type TrackerEnv } from './tracker';

export interface UseObsDisplayOptions extends Omit<DisplayCreateOptions, 'canvas'> {
  /** Elements whose size changes can shift the placeholder (e.g. the dock above/below it). */
  watch?: () => (HTMLElement | null | undefined)[];
  /** Test hook: browser API fakes. */
  env?: TrackerEnv;
  /** Fixed id (default: a new uuid). */
  id?: string;
}

/**
 * Binds a placeholder element to a native OBS display owned by core (display protocol, m1-design 9):
 * bind `el` with `ref="el"`, the rest is automatic. Creates the display on the first measurement
 * with a size, reports `{rect, dpr, visible}` on every change, hides it while an occluder is open and
 * destroys it on unmount. Must run in a component setup / effect scope.
 */
export function useObsDisplay(canvasId: CanvasId, options: UseObsDisplayOptions = {}) {
  const { watch: watchEls, env, id: fixedId, ...createOptions } = options;
  const id = fixedId ?? crypto.randomUUID();
  const el = shallowRef<HTMLElement | null>(null);
  const view = shallowRef<DisplayView>();
  // subscribe only once core knows the display (the slice does not exist before `create`)
  const known = shallowRef(false);
  const state = useSlice(() => (known.value ? (`display:${id}` as const) : undefined));

  let tracker: Tracker | undefined;
  let created = false;
  let destroyed = false;

  const send = (v: DisplayView) => {
    view.value = v;
    if (!created) {
      if (v.rect.width <= 0 || v.rect.height <= 0) return; // nothing to place yet
      created = true;
      commands.display
        .create(id, { renderingMode: 'main', drawUi: true, ...createOptions, canvas: canvasId }, v)
        .then(() => {
          known.value = true;
          // the view may have changed while `create` was in flight: send the latest
          const latest = tracker?.last();
          if (latest && latest !== v && !destroyed) void commands.display.update(id, latest);
        })
        .catch(e => {
          created = false;
          console.error('[display] create failed', e);
        });
    } else {
      void commands.display.update(id, v).catch(() => {});
    }
  };

  onMounted(() => {
    if (!el.value) return;
    tracker = createDisplayTracker({
      element: el.value,
      watch: watchEls?.(),
      occluded: () => occluded.value,
      onView: send,
      env,
    });
  });
  watch(occluded, () => tracker?.refresh(), { flush: 'sync' });

  onScopeDispose(() => {
    destroyed = true;
    tracker?.dispose();
    if (created) void commands.display.destroy(id).catch(() => {});
  });

  return { id, el, view, state };
}
