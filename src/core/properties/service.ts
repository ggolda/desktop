// Source properties (m1-dialogs-design 4): the slice `properties:<dialogId>` and the commands
// `properties.*`. Every change is applied to the backend, then the whole set is re-read: the backend
// re-applies the settings when `source.properties` is read, so `modified` callbacks (visibility,
// enabled state, list items) take effect without calling `modified()` (probe on real OBS, journal).
// The fresh set is diffed into the slice, so the page receives only what changed.
import type {
  FontFace,
  FontValue,
  Property,
  PropertyChange,
  PropertiesState,
} from '../../shared/contracts';
import { type Ctx, assignDeep, coded } from '../context';
import { convertProperties } from './convert';
import { loadSystemFonts } from './fonts';

export interface PropertiesApi {
  /** A dialog starts showing a source: reads its set once, so the first snapshot has data. */
  open(dialogId: string, sourceId: string): Promise<void>;
  /** The dialog is gone: drops its data (the slice goes with its last subscriber). */
  close(dialogId: string): void;
  /** Number of open views (tests, diagnostics). */
  views(): number;
}

interface View {
  sourceId: string;
  /** Latest set (plain data), also the initial state when the page (re)subscribes. */
  items: Property[];
}

interface SourceQueue {
  changes: PropertyChange[];
  waiters: { resolve(): void; reject(e: unknown): void }[];
  scheduled: boolean;
  tail: Promise<void>;
  pending: number;
}

/** Repeat limit of the "list value no longer among its items" fix (legacy recurses without limit). */
const LIST_FIX_ROUNDS = 3;

export function createProperties(
  ctx: Ctx,
  opts: { fontLoader?: () => Promise<FontFace[]> } = {},
): PropertiesApi {
  const { rt, backend, perf } = ctx;
  const views = new Map<string, View>();
  const queues = new Map<string, SourceQueue>();
  let fonts: Promise<FontFace[]> | null = null;

  rt.defineSliceFactory('properties', {
    create(key): PropertiesState {
      const v = views.get(key);
      if (!v) throw coded(`unknown properties view: ${key}`, 'ENOENT');
      return { sourceId: v.sourceId, rev: 0, items: structuredClone(v.items) };
    },
  });

  function requireSource(sourceId: string) {
    ctx.requireMedia();
    const rec = ctx.requireDoc().source(sourceId);
    if (!rec || rec.status !== 'ready') throw coded(`unknown source: ${sourceId}`, 'ENOENT');
    return rec;
  }

  const sameShape = (a: Property[], b: Property[]) =>
    a.length === b.length && a.every((p, i) => p.name === b[i].name && p.kind === b[i].kind);

  /** Diffs a fresh set into every view of the source. */
  function applyFresh(sourceId: string, fresh: Property[]) {
    for (const [id, v] of views) {
      if (v.sourceId !== sourceId) continue;
      v.items = fresh;
      const live = rt.getSlice(`properties:${id}`);
      if (!live) continue;
      if (sameShape(live.items, fresh)) {
        fresh.forEach((p, i) =>
          assignDeep(
            live.items[i] as unknown as Record<string, unknown>,
            p as unknown as Record<string, unknown>,
          ),
        );
      } else live.items = structuredClone(fresh);
      live.rev++;
    }
  }

  /** Re-reads the set; list values that fell out of their items go to the first item (legacy). */
  async function reread(sourceId: string): Promise<Property[]> {
    let fresh = convertProperties(await backend.sources.getProperties(sourceId));
    for (let round = 0; round < LIST_FIX_ROUNDS; round++) {
      const fix: Record<string, unknown> = {};
      for (const p of fresh) {
        if (p.kind === 'list' && p.items.length && !p.items.some(i => i.value === p.value)) {
          fix[p.name] = p.items[0].value;
        }
      }
      if (!Object.keys(fix).length) break;
      await backend.sources.updateSettings(sourceId, fix);
      fresh = convertProperties(await backend.sources.getProperties(sourceId));
    }
    applyFresh(sourceId, fresh);
    return fresh;
  }

  function settingsOf(changes: PropertyChange[], known: Map<string, Property['kind']>) {
    const settings: Record<string, unknown> = {};
    for (const c of changes) {
      const kind = known.get(c.name);
      if (kind === 'button' || kind === 'unsupported' || kind === 'info') continue;
      if (kind === 'font') {
        const f = (c.value ?? {}) as FontValue;
        const font: Record<string, unknown> = {};
        for (const k of ['face', 'style', 'size', 'flags'] as const) {
          if (f[k] !== undefined) font[k] = f[k];
        }
        settings[c.name] = font;
        settings.custom_font = f.path ?? ''; // the Google font path is an app-level setting
      } else if (kind === 'editable-list') {
        settings[c.name] = ((c.value as string[]) ?? []).map(value => ({
          value,
          selected: false,
          hidden: false,
        }));
      } else settings[c.name] = c.value;
    }
    return settings;
  }

  async function knownKinds(sourceId: string) {
    let items: Property[] | undefined;
    for (const v of views.values()) if (v.sourceId === sourceId) items = v.items;
    items ??= convertProperties(await backend.sources.getProperties(sourceId));
    return new Map(items.map(p => [p.name, p.kind]));
  }

  async function applyChanges(sourceId: string, changes: PropertyChange[]) {
    const t0 = performance.now();
    const settings = settingsOf(changes, await knownKinds(sourceId));
    if (Object.keys(settings).length) await backend.sources.updateSettings(sourceId, settings);
    ctx.touch.source(sourceId);
    await reread(sourceId);
    rt.bus.emit('source.updated', { id: sourceId });
    perf.record('properties.set', performance.now() - t0);
  }

  function queueOf(sourceId: string): SourceQueue {
    let q = queues.get(sourceId);
    if (!q) {
      q = { changes: [], waiters: [], scheduled: false, tail: Promise.resolve(), pending: 0 };
      queues.set(sourceId, q);
    }
    return q;
  }

  /** Runs `fn` after everything queued before it for this source (OSN calls block the loop). */
  function serial(sourceId: string, fn: () => Promise<void>): Promise<void> {
    const q = queueOf(sourceId);
    q.pending++;
    const run = q.tail.then(fn);
    q.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      if (--q.pending === 0 && queues.get(sourceId) === q) queues.delete(sourceId);
    });
  }

  function set(sourceId: string, changes: PropertyChange[]): Promise<void> {
    requireSource(sourceId);
    const q = queueOf(sourceId);
    // Changes arriving while an earlier call runs are merged into one update and one re-read.
    return new Promise<void>((resolve, reject) => {
      q.changes.push(...changes);
      q.waiters.push({ resolve, reject });
      if (q.scheduled) return;
      q.scheduled = true;
      void serial(sourceId, async () => {
        q.scheduled = false;
        const batch = q.changes.splice(0);
        const waiters = q.waiters.splice(0);
        try {
          await applyChanges(sourceId, batch);
          waiters.forEach(w => w.resolve());
        } catch (e) {
          waiters.forEach(w => w.reject(e));
        }
      });
    });
  }

  rt.registerCommands('properties', {
    set,
    press(sourceId, name) {
      requireSource(sourceId);
      return serial(sourceId, async () => {
        await backend.sources.pressButton(sourceId, name);
        ctx.touch.source(sourceId);
        await reread(sourceId);
        rt.bus.emit('source.updated', { id: sourceId });
      });
    },
    refresh(sourceId) {
      requireSource(sourceId);
      return serial(sourceId, async () => {
        await reread(sourceId);
      });
    },
    async fonts() {
      fonts ??= (opts.fontLoader ?? loadSystemFonts)();
      try {
        return await fonts;
      } catch (e) {
        fonts = null;
        throw e;
      }
    },
  });

  return {
    async open(dialogId, sourceId) {
      requireSource(sourceId);
      const items = convertProperties(await backend.sources.getProperties(sourceId));
      views.set(dialogId, { sourceId, items });
    },
    close(dialogId) {
      views.delete(dialogId);
      if (views.size === 0) fonts = null; // the font list lives only while a properties dialog does
    },
    views: () => views.size,
  };
}
