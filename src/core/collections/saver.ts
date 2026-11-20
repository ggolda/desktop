// Save scheduling and the save itself (m1-design 3.7). A file is written only when something is dirty
// (C3). Dirty -> trailing debounce 2 s, at most 30 s after the first change. No timer while clean.
import type { Ctx } from '../context';
import type { Json } from './format';

export const DEBOUNCE_MS = 2000;
export const MAX_WAIT_MS = 30_000;

export interface SaveOptions {
  /**
   * Re-read the settings of every source from the backend first and mark the ones that differ dirty
   * (owner decision 3: shutdown and collection switch). Costs one blocking pass.
   */
  reread?: boolean;
}

export interface Saver {
  /** Called by every mutation (through ctx.touch). */
  schedule(): void;
  /** Writes now if anything is dirty. Resolves true when a file was written. */
  flush(opts?: SaveOptions): Promise<boolean>;
  /** Forget a pending timer (collection switch). */
  cancel(): void;
  /** Source types whose settings differed at the last re-read (types only, never values). */
  lastRereadChanged(): string[];
  pending(): boolean;
}

const yieldLoop = () => new Promise<void>(r => setImmediate(r));

export function createSaver(
  ctx: Ctx,
  hooks: {
    /** After a successful write: bump `modified` and persist the manifest. */
    onSaved(id: string): Promise<void>;
  },
): Saver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstDirtyAt = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let changedTypes: string[] = [];

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function readSettings(ids: string[]): Promise<Map<string, Json>> {
    const out = new Map<string, Json>();
    if (!ctx.backendReady) return out;
    let n = 0;
    for (const id of ids) {
      try {
        out.set(id, (await ctx.backend.sources.getSettings(id, { persist: true })) as Json);
      } catch (e) {
        console.error(`[save] could not read settings of ${id}`, e);
      }
      if (++n % 8 === 0) await yieldLoop();
    }
    return out;
  }

  async function reread(): Promise<Map<string, Json>> {
    const doc = ctx.requireDoc();
    changedTypes = [];
    const ids = doc.sources.filter(s => s.status === 'ready').map(s => s.id);
    const all = await readSettings(ids);
    for (const [id, live] of all) {
      const rec = doc.source(id)!;
      const before = rec.raw?.settings ?? rec.createSettings;
      if (JSON.stringify(live) !== JSON.stringify(before)) {
        doc.touchSource(id);
        changedTypes.push(rec.type);
      }
    }
    return all;
  }

  async function run(opts: SaveOptions): Promise<boolean> {
    const doc = ctx.doc;
    if (!doc || ctx.saveBlocked || !ctx.activeId) return false;
    const id = ctx.activeId;
    let known: Map<string, Json> | undefined;
    if (opts.reread && ctx.backendReady && !ctx.loading) known = await reread();
    if (!doc.isDirty()) return false;
    const need = doc.sourcesNeedingSettings();
    const settings = new Map<string, Json>();
    const missing: string[] = [];
    for (const sid of need) {
      const live = known?.get(sid);
      if (live) settings.set(sid, live);
      else missing.push(sid);
    }
    for (const [k, v] of await readSettings(missing)) settings.set(k, v);
    // state may have changed while we read from the backend: serialize last, in one sync step
    const canvases = ctx.slices.canvases.horizontal;
    const text = doc.serialize(settings, {
      horizontal: canvases ? { w: canvases.baseWidth, h: canvases.baseHeight } : undefined,
    });
    doc.clearDirty();
    try {
      await ctx.store.write(id, text);
    } catch (e) {
      console.error('[save] write failed', e);
      doc.touchAll(); // everything is re-emitted from fresh state on the retry
      schedule();
      throw e;
    }
    await hooks.onSaved(id);
    return true;
  }

  function schedule() {
    if (ctx.saveBlocked || !ctx.doc) return;
    const now = Date.now();
    if (!timer) firstDirtyAt = now;
    clearTimer();
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (now - firstDirtyAt)));
    timer = setTimeout(() => {
      timer = null;
      void flush().catch(() => undefined);
    }, delay);
  }

  function flush(opts: SaveOptions = {}): Promise<boolean> {
    clearTimer();
    const p = chain.catch(() => undefined).then(() => run(opts));
    chain = p;
    return p;
  }

  return {
    schedule,
    flush,
    cancel: clearTimer,
    lastRereadChanged: () => [...changedTypes],
    pending: () => timer !== null,
  };
}
