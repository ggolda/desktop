import { onScopeDispose, readonly, ref, shallowRef, watch, type Ref } from 'vue';

/**
 * True while the window is visible (not minimized/hidden) AND focused. Meters and other live data pause
 * when it is false (a streamer is usually in a game, see the performance rules). Event driven.
 */
export function useWindowActive() {
  const read = () => document.visibilityState === 'visible' && document.hasFocus();
  const active = ref(read());
  const update = () => (active.value = read());
  document.addEventListener('visibilitychange', update);
  window.addEventListener('focus', update);
  window.addEventListener('blur', update);
  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('focus', update);
    window.removeEventListener('blur', update);
  });
  return readonly(active);
}

/** True while the element intersects the viewport (IntersectionObserver; false when unmounted). */
export function useElementVisible(target: Readonly<Ref<HTMLElement | null | undefined>>) {
  const visible = shallowRef(false);
  watch(
    target,
    (el, _old, onCleanup) => {
      if (!el) {
        visible.value = false;
        return;
      }
      const io = new IntersectionObserver(entries => {
        const e = entries[entries.length - 1];
        if (e) visible.value = e.isIntersecting;
      });
      io.observe(el);
      onCleanup(() => io.disconnect());
    },
    { immediate: true, flush: 'post' },
  );
  return readonly(visible);
}
