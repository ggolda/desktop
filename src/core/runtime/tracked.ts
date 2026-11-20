import type { PatchOp, PatchPath } from '../../shared/protocol';

// Change-tracking state objects for slices (SPEC 3.2).
//
// Why not @vue/reactivity: it exposes effects (read tracking), not mutation hooks; deriving patches
// would need a deep watcher plus a diff on every change. This proxy records the mutation itself, so a
// rename of one item in a 60-item array becomes `['s', ['items', 17, 'name'], 'x']` and nothing else.
//
// Supported values: plain objects, arrays, primitives. Map/Set/Date/class instances are stored as
// opaque leaf values (replace them, don't mutate them in place). An object must live in one place
// only (no aliasing within one slice).

type Obj = Record<string | symbol, unknown>;
interface Parent {
  parent: object;
  key: string | number;
}

const RAW = Symbol('raw');
const ARRAY_MUTATORS = new Set<string | symbol>(['push', 'pop', 'shift', 'unshift', 'splice']);

function isTrackable(v: unknown): v is object {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function toRaw<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  return ((v as Obj)[RAW] as T | undefined) ?? v;
}

/** Deep copy (also unwraps tracked proxies) so recorded ops are immune to later mutation. */
function snapshot<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  const raw = toRaw(v) as unknown as Obj;
  if (Array.isArray(raw)) return raw.map(snapshot) as T;
  if (!isTrackable(raw)) return structuredClone(raw) as T;
  const out: Obj = {};
  for (const k of Object.keys(raw)) out[k] = snapshot(raw[k]);
  return out as T;
}

export interface Tracked<T extends object> {
  /** Mutate this; reads work as on a plain object. */
  state: T;
  /** The untracked object (for snapshots). */
  raw: T;
}

/**
 * @param onOp called synchronously for every recorded op (already coalesced by the caller if wanted)
 */
export function createTracked<T extends object>(
  initial: T,
  hooks: {
    /** Return false to skip recording (nobody listening). */
    isActive(): boolean;
    record(op: PatchOp, coalesceKey?: string): void;
  },
): Tracked<T> {
  const rootRaw = snapshot(initial);
  const proxies = new WeakMap<object, object>();
  const parents = new WeakMap<object, Parent>();

  function pathOf(target: object): PatchPath | null {
    const rev: (string | number)[] = [];
    let cur = target;
    while (cur !== rootRaw) {
      const info = parents.get(cur);
      if (!info) return null;
      const p = info.parent as Obj;
      let key: string | number = info.key;
      if (p[key] !== cur) {
        // moved (array shift/splice) or replaced: find the current key
        if (Array.isArray(p)) key = (p as unknown[]).indexOf(cur);
        else key = Object.keys(p).find(k => p[k] === cur) ?? -1;
        if (key === -1) return null; // detached
        info.key = key;
      }
      rev.push(key);
      cur = info.parent;
    }
    return rev.reverse();
  }

  function adopt(parent: object, key: string | number, child: unknown) {
    if (isTrackable(child)) parents.set(child, { parent, key });
  }

  function wrap<V extends object>(raw: V): V {
    let p = proxies.get(raw);
    if (!p) {
      p = new Proxy(raw, handler);
      proxies.set(raw, p);
    }
    return p as V;
  }

  function arrayMethod(target: unknown[], name: string) {
    return (...args: unknown[]) => {
      const len = target.length;
      let start: number;
      let del: number;
      let items: unknown[];
      switch (name) {
        case 'push':
          [start, del, items] = [len, 0, args];
          break;
        case 'unshift':
          [start, del, items] = [0, 0, args];
          break;
        case 'pop':
          if (len === 0) return undefined;
          [start, del, items] = [len - 1, 1, []];
          break;
        case 'shift':
          if (len === 0) return undefined;
          [start, del, items] = [0, 1, []];
          break;
        default: {
          const s = Math.trunc(Number(args[0])) || 0;
          start = s < 0 ? Math.max(len + s, 0) : Math.min(s, len);
          if (args.length === 0) del = 0;
          else if (args.length === 1) del = len - start;
          else del = Math.min(Math.max(Math.trunc(Number(args[1])) || 0, 0), len - start);
          items = args.slice(2);
        }
      }
      items = items.map(toRaw);
      const removed = target.splice(start, del, ...items);
      items.forEach((it, i) => adopt(target, start + i, it));
      // shifted elements get their key fixed lazily in pathOf()
      if (hooks.isActive()) {
        const path = pathOf(target);
        if (path) hooks.record(['x', path, start, del, items.map(snapshot)]);
      }
      switch (name) {
        case 'push':
        case 'unshift':
          return target.length;
        case 'splice':
          return removed;
        default:
          return removed[0];
      }
    };
  }

  const handler: ProxyHandler<object> = {
    get(target, key) {
      if (key === RAW) return target;
      if (Array.isArray(target) && ARRAY_MUTATORS.has(key))
        return arrayMethod(target, key as string);
      const v = Reflect.get(target, key);
      if (isTrackable(v)) {
        if (typeof key === 'string') adopt(target, Array.isArray(target) ? Number(key) : key, v);
        return wrap(v);
      }
      return v;
    },
    set(target, key, value) {
      if (typeof key === 'symbol') return Reflect.set(target, key, value);
      const t = target as Obj;
      const raw = toRaw(value);
      const isArr = Array.isArray(target);
      if (isArr && key === 'length') {
        if (t.length === raw) return true;
        const ok = Reflect.set(target, key, raw);
        const path = hooks.isActive() && pathOf(target);
        if (path) hooks.record(['l', path, raw as number]);
        return ok;
      }
      const had = Object.hasOwn(t, key);
      if (had && Object.is(t[key], raw)) return true;
      const ok = Reflect.set(target, key, raw);
      const k = isArr ? Number(key) : key;
      adopt(target, k, raw);
      if (hooks.isActive()) {
        const path = pathOf(target);
        if (path) {
          path.push(k);
          const primitive = raw === null || typeof raw !== 'object';
          hooks.record(
            ['s', path, primitive ? raw : snapshot(raw)],
            primitive ? path.join('\0') : undefined,
          );
        }
      }
      return ok;
    },
    deleteProperty(target, key) {
      if (typeof key === 'symbol' || !Object.hasOwn(target, key))
        return Reflect.deleteProperty(target, key);
      const ok = Reflect.deleteProperty(target, key);
      if (hooks.isActive()) {
        const path = pathOf(target);
        if (path) hooks.record(['d', [...path, Array.isArray(target) ? Number(key) : key]]);
      }
      return ok;
    },
  };

  return { state: wrap(rootRaw), raw: rootRaw };
}
