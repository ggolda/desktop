// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayView } from '@/shared/contracts';
import { createDisplayTracker, type TrackerEnv } from '@/ui/display/tracker';

class IO {
  static last: IO;
  constructor(public cb: (e: Partial<IntersectionObserverEntry>[]) => void) {
    IO.last = this;
  }
  observe() {}
  disconnect() {}
}
class RO {
  static last: RO;
  constructor(public cb: () => void) {
    RO.last = this;
  }
  observe() {}
  disconnect() {}
}

function setup(opts: { occluded?: () => boolean } = {}) {
  const el = document.createElement('div');
  let rect = { x: 10, y: 20, width: 800, height: 450 };
  el.getBoundingClientRect = () => rect as DOMRect;
  const mqls: { q: string; l: Set<() => void> }[] = [];
  const doc = new EventTarget() as unknown as TrackerEnv['document'] &
    EventTarget & { visibilityState: string };
  doc.visibilityState = 'visible';
  const win = new EventTarget() as unknown as TrackerEnv['window'] &
    EventTarget & { devicePixelRatio: number };
  win.devicePixelRatio = 1;
  const env: TrackerEnv = {
    ResizeObserver: RO as never,
    IntersectionObserver: IO as never,
    matchMedia: q => {
      const entry = { q, l: new Set<() => void>() };
      mqls.push(entry);
      return {
        addEventListener: (_: string, l: () => void) => entry.l.add(l),
        removeEventListener: (_: string, l: () => void) => entry.l.delete(l),
      } as unknown as MediaQueryList;
    },
    document: doc,
    window: win,
  };
  const views: DisplayView[] = [];
  const tracker = createDisplayTracker({
    element: el,
    occluded: opts.occluded ?? (() => false),
    onView: v => views.push(v),
    env,
  });
  return {
    tracker,
    views,
    mqls,
    doc,
    win,
    setRect: (r: Partial<typeof rect>) => (rect = { ...rect, ...r }),
    io: () => IO.last,
    ro: () => RO.last,
  };
}

const tick = () => Promise.resolve();

describe('display tracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports the first view with rect, dpr and visible, and nothing is polled', async () => {
    const t = setup();
    await tick();
    expect(t.views).toEqual([
      { rect: { x: 10, y: 20, width: 800, height: 450 }, dpr: 1, visible: true },
    ]);
    expect(vi.getTimerCount()).toBe(0); // no timers, no rAF
    expect(t.mqls[0].q).toBe('(resolution: 1dppx)');
  });

  it('coalesces several observer callbacks into one report and skips unchanged views', async () => {
    const t = setup();
    await tick();
    t.setRect({ width: 900 });
    t.ro().cb();
    t.ro().cb();
    t.io().cb([{ isIntersecting: true }]);
    await tick();
    expect(t.views).toHaveLength(2);
    expect(t.views[1].rect.width).toBe(900);
    t.ro().cb(); // nothing changed
    await tick();
    expect(t.views).toHaveLength(2);
  });

  it('is not visible when scrolled out, when the window is hidden, or when the rect is empty', async () => {
    const t = setup();
    await tick();
    t.io().cb([{ isIntersecting: false }]);
    await tick();
    expect(t.views.at(-1)?.visible).toBe(false);
    t.io().cb([{ isIntersecting: true }]);
    await tick();
    expect(t.views.at(-1)?.visible).toBe(true);
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(t.views.at(-1)?.visible).toBe(false);
    t.doc.visibilityState = 'visible';
    t.setRect({ width: 0 });
    t.ro().cb();
    await tick();
    expect(t.views.at(-1)?.visible).toBe(false);
  });

  it('re-measures a DPR change from the resolution media query and re-arms it', async () => {
    const t = setup();
    await tick();
    t.win.devicePixelRatio = 1.5;
    for (const l of [...t.mqls[0].l]) l();
    await tick();
    expect(t.views.at(-1)?.dpr).toBe(1.5);
    expect(t.mqls.at(-1)?.q).toBe('(resolution: 1.5dppx)');
    expect(t.mqls[0].l.size).toBe(0); // old query detached
  });

  it('hides while an occluder is open after refresh()', async () => {
    let open = false;
    const t = setup({ occluded: () => open });
    await tick();
    expect(t.views.at(-1)?.visible).toBe(true);
    open = true;
    t.tracker.refresh();
    await tick();
    expect(t.views.at(-1)?.visible).toBe(false);
    open = false;
    t.tracker.refresh();
    await tick();
    expect(t.views.at(-1)?.visible).toBe(true);
  });

  it('window resize triggers a report (position changes without a size change)', async () => {
    const t = setup();
    await tick();
    t.setRect({ x: 50 });
    t.win.dispatchEvent(new Event('resize'));
    await tick();
    expect(t.views.at(-1)?.rect.x).toBe(50);
  });

  it('stops reporting after dispose', async () => {
    const t = setup();
    await tick();
    t.tracker.dispose();
    t.setRect({ width: 1 });
    t.ro().cb();
    await tick();
    expect(t.views).toHaveLength(1);
  });
});
