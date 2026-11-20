// Preview displays (m1-design 9). A window reports its placeholder rect; core creates and moves the
// native display. Views are coalesced per display, hidden displays are sized to 0x0 and destroyed
// after 10 s ("nothing hidden for speed"). No polling anywhere.
import type {
  CanvasId,
  DisplayCreateOptions,
  DisplayRect,
  DisplayState,
  DisplayView,
} from '../../shared/contracts';
import { type Ctx, coded } from '../context';
import type { MainRpc } from '../main-rpc';

export interface DisplayApi {
  /** Backend became ready: pending creates continue. */
  backendReady(): void;
  /** Output regions depend on the canvas size: re-read them (collection switch, resolution change). */
  refreshRegions(): Promise<void>;
  destroyAll(): Promise<void>;
}

const HIDDEN_DESTROY_MS = 10_000;

interface Rec {
  id: string;
  connId: number;
  windowId: number;
  options: DisplayCreateOptions;
  view: DisplayView;
  state: DisplayState;
  created: boolean;
  /** Last rect sent to the backend, device px. */
  applied: { x: number; y: number; width: number; height: number } | null;
  scheduled: boolean;
  chain: Promise<void>;
  hideTimer: ReturnType<typeof setTimeout> | null;
  dead: boolean;
}

export function createDisplays(ctx: Ctx, mainRpc: MainRpc): DisplayApi {
  const { rt, backend } = ctx;
  const recs = new Map<string, Rec>();
  const handles = new Map<number, Uint8Array>();
  /** Displays waiting for the backend. A destroyed display wakes its own waiter (shutdown never hangs). */
  const readyWaiters = new Map<Rec, () => void>();

  const absent = (id: string, canvas: CanvasId = 'horizontal'): DisplayState => ({
    id,
    status: 'absent',
    canvas,
    outputRegion: null,
  });

  rt.defineSliceFactory('display', {
    create: key => structuredClone(recs.get(key)?.state ?? absent(key)),
  });

  function setState(rec: Rec, patch: Partial<DisplayState>) {
    Object.assign(rec.state, patch);
    const live = rt.getSlice(`display:${rec.id}`);
    if (!live) return;
    for (const [k, v] of Object.entries(patch)) {
      (live as unknown as Record<string, unknown>)[k] = v;
    }
    if ('error' in patch && patch.error === undefined) delete live.error;
  }

  const waitReady = (rec: Rec) =>
    ctx.backendReady && !ctx.loading
      ? Promise.resolve()
      : new Promise<void>(r => readyWaiters.set(rec, r));

  const toDevice = (r: DisplayRect, dpr: number) => ({
    x: Math.round(r.x * dpr),
    y: Math.round(r.y * dpr),
    width: Math.max(0, Math.round(r.width * dpr)),
    height: Math.max(0, Math.round(r.height * dpr)),
  });

  async function readRegion(rec: Rec) {
    const r = await backend.displays.getOutputRegion(rec.id);
    const dpr = rec.view.dpr || 1;
    setState(rec, {
      outputRegion: { x: r.x / dpr, y: r.y / dpr, width: r.width / dpr, height: r.height / dpr },
    });
  }

  async function createNative(rec: Rec) {
    let handle = handles.get(rec.windowId);
    if (!handle) {
      handle = await mainRpc.call('window.nativeHandle', rec.windowId);
      handles.set(rec.windowId, handle);
    }
    if (rec.dead) return;
    await backend.displays.create({
      id: rec.id,
      handle,
      canvas: rec.options.canvas ?? 'horizontal',
      sourceId: rec.options.sourceId,
      mode: rec.options.renderingMode ?? 'main',
      paddingColor: rec.options.paddingColor,
      paddingSize: rec.options.paddingSize,
      drawUi: rec.options.drawUi ?? false,
    });
    rec.created = true;
    rec.applied = null;
  }

  async function destroyNative(rec: Rec) {
    if (!rec.created) return;
    rec.created = false;
    rec.applied = null;
    await backend.displays.destroy(rec.id).catch(e => console.error('[display] destroy failed', e));
  }

  /** Brings the native display in line with the latest view. Serialized per display. */
  async function apply(rec: Rec) {
    if (rec.dead) return;
    const v = rec.view;
    try {
      if (!v.visible) {
        if (rec.created && rec.applied?.width !== 0) {
          const a = rec.applied ?? { x: 0, y: 0, width: 0, height: 0 };
          await backend.displays.moveResize(rec.id, { x: a.x, y: a.y, width: 0, height: 0 });
          rec.applied = { x: a.x, y: a.y, width: 0, height: 0 };
        }
        if (rec.created) {
          setState(rec, { status: 'hidden' });
          rec.hideTimer ??= setTimeout(() => {
            rec.hideTimer = null;
            rec.chain = rec.chain.then(async () => {
              if (rec.dead || rec.view.visible) return;
              await destroyNative(rec);
              setState(rec, { status: 'absent', outputRegion: null });
            });
          }, HIDDEN_DESTROY_MS);
        } else if (rec.state.status !== 'absent') {
          setState(rec, { status: 'absent' });
        }
        return;
      }
      if (rec.hideTimer) {
        clearTimeout(rec.hideTimer);
        rec.hideTimer = null;
      }
      if (!rec.created) {
        setState(rec, { status: 'pending' });
        await waitReady(rec);
        if (rec.dead) return;
        await createNative(rec);
        if (rec.dead) return;
      }
      const next = toDevice(v.rect, v.dpr);
      const prev = rec.applied;
      if (
        !prev ||
        prev.x !== next.x ||
        prev.y !== next.y ||
        prev.width !== next.width ||
        prev.height !== next.height
      ) {
        await backend.displays.moveResize(rec.id, next);
        rec.applied = next;
        if (!prev || prev.width !== next.width || prev.height !== next.height)
          await readRegion(rec);
      }
      if (rec.state.status !== 'ready') setState(rec, { status: 'ready', error: undefined });
    } catch (e) {
      setState(rec, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** One apply per microtask turn: only the latest view of a burst is used. */
  function schedule(rec: Rec) {
    if (rec.scheduled) return;
    rec.scheduled = true;
    queueMicrotask(() => {
      rec.scheduled = false;
      rec.chain = rec.chain.then(() => apply(rec));
    });
  }

  async function destroyRec(rec: Rec) {
    rec.dead = true;
    readyWaiters.get(rec)?.();
    readyWaiters.delete(rec);
    if (rec.hideTimer) clearTimeout(rec.hideTimer);
    rec.hideTimer = null;
    recs.delete(rec.id);
    await rec.chain.catch(() => undefined);
    await destroyNative(rec);
    setState(rec, { status: 'absent', outputRegion: null });
    if (![...recs.values()].some(r => r.windowId === rec.windowId)) handles.delete(rec.windowId);
  }

  rt.onDisconnect(connId => {
    for (const rec of [...recs.values()]) if (rec.connId === connId) void destroyRec(rec);
  });

  rt.registerCommands('display', {
    create(id, options, view) {
      const caller = rt.caller(); // valid only before the first await (runtime R-c)
      if (!caller) throw coded('display.create needs a window caller', 'ENOCALLER');
      if (recs.has(id)) throw coded(`display exists: ${id}`, 'EEXIST');
      const canvas = options.canvas ?? 'horizontal';
      if (canvas !== 'horizontal') throw coded('only the horizontal canvas exists', 'EUNSUPPORTED');
      const rec: Rec = {
        id,
        connId: caller.connId,
        windowId: caller.windowId,
        options,
        view,
        state: absent(id, canvas),
        created: false,
        applied: null,
        scheduled: false,
        chain: Promise.resolve(),
        hideTimer: null,
        dead: false,
      };
      recs.set(id, rec);
      setState(rec, { status: view.visible ? 'pending' : 'absent' });
      schedule(rec);
    },
    update(id, view) {
      const rec = recs.get(id);
      if (!rec) return;
      rec.view = view;
      schedule(rec);
    },
    async setOptions(id, patch) {
      const rec = recs.get(id);
      if (!rec) throw coded(`unknown display: ${id}`, 'ENOENT');
      Object.assign(rec.options, {
        ...(patch.drawUi !== undefined && { drawUi: patch.drawUi }),
        ...(patch.paddingColor && { paddingColor: patch.paddingColor }),
        ...(patch.paddingSize !== undefined && { paddingSize: patch.paddingSize }),
      });
      await rec.chain;
      if (!rec.created) return;
      if (patch.drawUi !== undefined) await backend.displays.setDrawUi(id, patch.drawUi);
      if (patch.guidelines !== undefined)
        await backend.displays.setGuidelines(id, patch.guidelines);
      if (patch.paddingColor || patch.paddingSize !== undefined) {
        await backend.displays.setPadding(id, {
          color: patch.paddingColor,
          size: patch.paddingSize,
        });
      }
    },
    async destroy(id) {
      const rec = recs.get(id);
      if (rec) await destroyRec(rec);
    },
  });

  return {
    backendReady() {
      const w = [...readyWaiters.values()];
      readyWaiters.clear();
      for (const r of w) r();
    },
    async refreshRegions() {
      for (const rec of recs.values()) {
        if (rec.created && rec.applied && rec.applied.width > 0) {
          rec.chain = rec.chain.then(() => readRegion(rec)).catch(() => undefined);
        }
      }
    },
    async destroyAll() {
      await Promise.all([...recs.values()].map(destroyRec));
    },
  };
}
