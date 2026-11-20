import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';

/**
 * Occluder convention (m1-design 9.1): the native preview is a child HWND that draws over any DOM.
 * Every in-window overlay that can cover it (context menu, popover, dropdown, dialog) registers while
 * it is open; the preview display reports `visible: false` while at least one occluder exists.
 * Conservative on purpose: any open overlay hides the display, no geometry test.
 */
const count = ref(0);

/** True while at least one overlay is open. */
export const occluded = computed(() => count.value > 0);

/** Registers one occluder; call the returned function when the overlay closes (idempotent). */
export function registerOccluder(): () => void {
  count.value++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    count.value--;
  };
}

/** Registers an occluder while `open` is true (and releases it when the scope ends). */
export function useOccluder(open: Readonly<Ref<boolean>>) {
  let release: (() => void) | undefined;
  watch(
    open,
    isOpen => {
      if (isOpen && !release) release = registerOccluder();
      else if (!isOpen && release) {
        release();
        release = undefined;
      }
    },
    { immediate: true, flush: 'sync' },
  );
  onScopeDispose(() => release?.());
}

/** Test helper. */
export function resetOccluders() {
  count.value = 0;
}
