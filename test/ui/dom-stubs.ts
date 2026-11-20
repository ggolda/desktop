import { vi } from 'vitest';

/** Controllable IntersectionObserver / ResizeObserver / canvas for happy-dom component tests. */
export class FakeIO {
  static all = new Set<FakeIO>();
  static intersecting = true;
  els = new Set<Element>();
  constructor(private cb: (e: Partial<IntersectionObserverEntry>[]) => void) {
    FakeIO.all.add(this);
  }
  observe(el: Element) {
    this.els.add(el);
    queueMicrotask(() => this.fire(FakeIO.intersecting));
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
    FakeIO.all.delete(this);
  }
  fire(isIntersecting: boolean) {
    for (const el of this.els) this.cb([{ isIntersecting, target: el }]);
  }
  static setIntersecting(v: boolean) {
    FakeIO.intersecting = v;
    for (const io of FakeIO.all) io.fire(v);
  }
}

export class FakeRO {
  static all = new Set<FakeRO>();
  els = new Set<Element>();
  constructor(private cb: () => void) {
    FakeRO.all.add(this);
  }
  observe(el: Element) {
    this.els.add(el);
  }
  unobserve(el: Element) {
    this.els.delete(el);
  }
  disconnect() {
    this.els.clear();
    FakeRO.all.delete(this);
  }
  fire() {
    this.cb();
  }
  static fireAll() {
    for (const ro of FakeRO.all) ro.fire();
  }
}

export interface FakeCtx {
  fillRect: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  fillStyle: string;
}

/** Installs observers, a 2d context stub and non-zero widths. Returns the contexts created. */
export function installDomStubs() {
  FakeIO.all.clear();
  FakeRO.all.clear();
  FakeIO.intersecting = true;
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.stubGlobal('ResizeObserver', FakeRO);
  const ctxs: FakeCtx[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => {
    const ctx: FakeCtx = { fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' };
    ctxs.push(ctx);
    return ctx;
  }) as never);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  return { ctxs };
}

export function setFocus(focused: boolean) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
  window.dispatchEvent(new Event(focused ? 'focus' : 'blur'));
}
