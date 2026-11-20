import type { DisplayView } from '@/shared/contracts';

/** Browser APIs the tracker needs; injected so tests can drive it without a layout engine. */
export interface TrackerEnv {
  ResizeObserver: typeof ResizeObserver;
  IntersectionObserver: typeof IntersectionObserver;
  matchMedia: (q: string) => MediaQueryList;
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  window: Pick<Window, 'devicePixelRatio' | 'addEventListener' | 'removeEventListener'>;
}

export interface Tracker {
  /** Re-measure after something the observers cannot see (occluders changed, ...). */
  refresh(): void;
  /** Last view that was reported (undefined before the first one). */
  last(): DisplayView | undefined;
  dispose(): void;
}

export interface TrackerOptions {
  element: HTMLElement;
  /** Extra elements whose resize can move the element without resizing it (siblings, parents). */
  watch?: (HTMLElement | null | undefined)[];
  /** Overlay open somewhere in the window (see overlay/occluders.ts). */
  occluded: () => boolean;
  /** Called once per change with the coalesced view (microtask), never twice with equal values. */
  onView: (view: DisplayView) => void;
  env?: TrackerEnv;
}

const same = (a: DisplayView, b: DisplayView) =>
  a.visible === b.visible &&
  a.dpr === b.dpr &&
  a.rect.x === b.rect.x &&
  a.rect.y === b.rect.y &&
  a.rect.width === b.rect.width &&
  a.rect.height === b.rect.height;

/**
 * Event driven geometry reporting for a native display placeholder (display protocol step 1):
 * ResizeObserver + IntersectionObserver + a `(resolution: Ndppx)` media query + visibilitychange +
 * window resize. No polling, no rAF: each observer callback marks dirty and one microtask measures.
 */
export function createDisplayTracker(opts: TrackerOptions): Tracker {
  const env: TrackerEnv = opts.env ?? {
    ResizeObserver,
    IntersectionObserver,
    matchMedia: q => window.matchMedia(q),
    document,
    window,
  };
  const el = opts.element;
  let intersecting = true; // until the first IntersectionObserver callback
  let dirty = false;
  let disposed = false;
  let last: DisplayView | undefined;

  const measure = (): DisplayView => {
    const r = el.getBoundingClientRect();
    const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    const visible =
      intersecting &&
      env.document.visibilityState === 'visible' &&
      !opts.occluded() &&
      rect.width > 0 &&
      rect.height > 0;
    return { rect, dpr: env.window.devicePixelRatio || 1, visible };
  };

  const flush = () => {
    dirty = false;
    if (disposed) return;
    const v = measure();
    if (last && same(last, v)) return;
    last = v;
    opts.onView(v);
  };
  const schedule = () => {
    if (dirty || disposed) return;
    dirty = true;
    queueMicrotask(flush);
  };

  const ro = new env.ResizeObserver(schedule);
  ro.observe(el);
  for (const w of opts.watch ?? []) if (w) ro.observe(w);

  const io = new env.IntersectionObserver(entries => {
    const e = entries[entries.length - 1];
    if (e) intersecting = e.isIntersecting;
    schedule();
  });
  io.observe(el);

  // DPR changes (monitor move, zoom) are not reported by ResizeObserver: re-arm a media query per DPR.
  let mql: MediaQueryList | undefined;
  const onDprChange = () => {
    armDpr();
    schedule();
  };
  function armDpr() {
    mql?.removeEventListener('change', onDprChange);
    mql = env.matchMedia(`(resolution: ${env.window.devicePixelRatio || 1}dppx)`);
    mql.addEventListener('change', onDprChange);
  }
  armDpr();

  env.document.addEventListener('visibilitychange', schedule);
  // a window move/resize shifts the rect without resizing the element
  env.window.addEventListener('resize', schedule);

  schedule(); // first report

  return {
    refresh: schedule,
    last: () => last,
    dispose() {
      disposed = true;
      ro.disconnect();
      io.disconnect();
      mql?.removeEventListener('change', onDprChange);
      env.document.removeEventListener('visibilitychange', schedule);
      env.window.removeEventListener('resize', schedule);
    },
  };
}
