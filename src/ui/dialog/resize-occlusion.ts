import { onScopeDispose } from 'vue';
import { registerOccluder } from '@/ui/overlay/occluders';

/**
 * Legacy hides the dialog's preview display for 200 ms while the window is being resized (the native
 * window would lag behind the DOM). The timer exists only between a resize event and its end.
 */
export function useResizeOcclusion(ms = 200) {
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    release ??= registerOccluder();
    clearTimeout(timer);
    timer = setTimeout(() => {
      release?.();
      release = undefined;
    }, ms);
  };
  window.addEventListener('resize', onResize);
  onScopeDispose(() => {
    window.removeEventListener('resize', onResize);
    clearTimeout(timer);
    release?.();
  });
}
