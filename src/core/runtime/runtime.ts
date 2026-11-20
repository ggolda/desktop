import type { CommandImpl, Contract, SliceKey } from '../../shared/contracts/types';
import type { ClientMessage, ErrorInfo, PatchOp, ServerMessage } from '../../shared/protocol';
import { Bus } from './bus';
import { createTracked } from './tracked';
import type { Transport } from './transport';

type SliceState<C extends Contract, K extends string> = K extends keyof C['slices']
  ? C['slices'][K]
  : never;

export interface SliceFactory<S extends object> {
  /** Called lazily on the first subscription to `<prefix>:<key>`. */
  create(key: string): S;
  /** Called after the last subscriber left (only if `disposeWhenUnused`, default true). */
  dispose?(key: string, state: S): void;
  disposeWhenUnused?: boolean;
}

export interface MetersOptions {
  /** Default 66 ms (~15 Hz). */
  intervalMs?: number;
  /** Produces one frame; only called while at least one window has meters on. */
  sample(): Float32Array | number[];
  /**
   * Called on the edges of "at least one window has meters on" (true on the first, false after the
   * last left). Lets core create the backend volmeters only while somebody looks at them.
   */
  onActiveChange?(active: boolean): void;
}

export interface RuntimeOptions {
  meters?: MetersOptions;
}

interface SliceEntry {
  name: string;
  state: object;
  raw: object;
  rev: number;
  pending: PatchOp[];
  coalesce: Map<string, number>;
  scheduled: boolean;
  subscribers: Set<Connection>;
  factory?: { def: SliceFactory<object>; key: string };
}

/** Who is calling a command; valid only synchronously at the start of a command implementation. */
export interface CallerInfo {
  connId: number;
  windowId: number;
}

export interface AttachMeta {
  windowId: number;
}

interface Connection {
  id: number;
  windowId: number;
  transport: Transport;
  subs: Map<number, SliceEntry>;
  events: Set<string>;
  meters: boolean;
  closed: boolean;
}

function toError(e: unknown): ErrorInfo {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    return typeof code === 'string' ? { message: e.message, code } : { message: e.message };
  }
  return { message: String(e) };
}

function coded(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

/**
 * Core side of the window protocol (SPEC 3.1): commands, state slices with patches, bus events and
 * the meters channel. No timers exist while idle: patches flush on a microtask, the meters timer
 * only runs while a window has meters on.
 */
export function createRuntime<C extends Contract>(options: RuntimeOptions = {}) {
  const slices = new Map<string, SliceEntry>();
  const factories = new Map<string, SliceFactory<object>>();
  const commands = new Map<string, Record<string, unknown>>();
  const connections = new Set<Connection>();
  const bus = new Bus<Record<string, unknown>>();
  const busForwarders = new Map<string, () => void>();
  const disconnectListeners = new Set<(connId: number) => void>();
  let nextConnId = 1;
  let currentCaller: CallerInfo | null = null;

  // ---- slices -------------------------------------------------------------------------------

  function flush(entry: SliceEntry) {
    entry.scheduled = false;
    entry.coalesce.clear();
    if (entry.pending.length === 0) return;
    const ops = entry.pending;
    entry.pending = [];
    if (entry.subscribers.size === 0) return;
    entry.rev++;
    for (const conn of entry.subscribers) {
      for (const [sid, e] of conn.subs) {
        if (e === entry) send(conn, { type: 'patch', sid, rev: entry.rev, ops });
      }
    }
  }

  function createEntry(name: string, initial: object, factory?: SliceEntry['factory']) {
    const entry: SliceEntry = {
      name,
      state: {},
      raw: {},
      rev: 0,
      pending: [],
      coalesce: new Map(),
      scheduled: false,
      subscribers: new Set(),
      factory,
    };
    const tracked = createTracked(initial, {
      isActive: () => entry.subscribers.size > 0,
      record(op, coalesceKey) {
        if (coalesceKey !== undefined) {
          const at = entry.coalesce.get(coalesceKey);
          if (at !== undefined) {
            entry.pending[at] = op;
            return;
          }
          entry.coalesce.set(coalesceKey, entry.pending.length);
        } else {
          entry.coalesce.clear();
        }
        entry.pending.push(op);
        if (!entry.scheduled) {
          entry.scheduled = true;
          queueMicrotask(() => flush(entry));
        }
      },
    });
    entry.state = tracked.state;
    entry.raw = tracked.raw;
    return entry;
  }

  /** Defines a slice and returns its state object: mutate it and subscribers get patches. */
  function defineSlice<K extends SliceKey<C>>(
    name: K,
    initial: SliceState<C, K>,
  ): SliceState<C, K> {
    if (slices.has(name)) throw new Error(`slice already defined: ${name}`);
    const entry = createEntry(name, initial);
    slices.set(name, entry);
    return entry.state as SliceState<C, K>;
  }

  /** A parameterized slice family `<prefix>:<key>`, created on first subscription. */
  function defineSliceFactory<P extends string>(
    prefix: P,
    def: SliceFactory<C['slices'][`${P}:${string}`]>,
  ) {
    if (factories.has(prefix)) throw new Error(`slice factory already defined: ${prefix}`);
    factories.set(prefix, def as SliceFactory<object>);
  }

  function resolveSlice(name: string): SliceEntry | undefined {
    const existing = slices.get(name);
    if (existing) return existing;
    const i = name.indexOf(':');
    if (i < 0) return undefined;
    const def = factories.get(name.slice(0, i));
    if (!def) return undefined;
    const key = name.slice(i + 1);
    const entry = createEntry(name, def.create(key), { def, key });
    slices.set(name, entry);
    return entry;
  }

  function detach(conn: Connection, sid: number) {
    const entry = conn.subs.get(sid);
    if (!entry) return;
    conn.subs.delete(sid);
    if ([...conn.subs.values()].includes(entry)) return; // same connection still has another sid
    flush(entry);
    entry.subscribers.delete(conn);
    if (entry.subscribers.size === 0 && entry.factory) {
      const { def, key } = entry.factory;
      if (def.disposeWhenUnused !== false) {
        slices.delete(entry.name);
        def.dispose?.(key, entry.raw);
      }
    }
  }

  // ---- connections --------------------------------------------------------------------------

  function send(conn: Connection, msg: ServerMessage) {
    if (conn.closed) return;
    try {
      conn.transport.post(msg);
    } catch (e) {
      console.error('[runtime] post failed', e);
    }
  }

  async function handleCall(conn: Connection, msg: Extract<ClientMessage, { type: 'call' }>) {
    try {
      const impl = commands.get(msg.target);
      if (!impl) throw coded(`unknown target: ${msg.target}`, 'ENOTARGET');
      const fn = impl[msg.method];
      if (typeof fn !== 'function' || msg.method in Object.prototype) {
        throw coded(`unknown method: ${msg.target}.${msg.method}`, 'ENOMETHOD');
      }
      // `caller()` is valid until the first await of the implementation (R-c).
      currentCaller = { connId: conn.id, windowId: conn.windowId };
      let pending: unknown;
      try {
        pending = (fn as (...a: unknown[]) => unknown).apply(impl, msg.args ?? []);
      } finally {
        currentCaller = null;
      }
      const value = await pending;
      send(conn, { type: 'result', id: msg.id, ok: true, value });
    } catch (e) {
      send(conn, { type: 'result', id: msg.id, ok: false, error: toError(e) });
    }
  }

  function handleSub(conn: Connection, sid: number, slice: string) {
    let entry: SliceEntry | undefined;
    try {
      entry = resolveSlice(slice);
    } catch (e) {
      send(conn, { type: 'sub-error', sid, slice, error: toError(e) });
      return;
    }
    if (!entry) {
      send(conn, {
        type: 'sub-error',
        sid,
        slice,
        error: toError(coded(`unknown slice: ${slice}`, 'ENOSLICE')),
      });
      return;
    }
    if (conn.subs.get(sid) !== entry) detach(conn, sid);
    // Deliver ops recorded earlier in this tick to the others first: the snapshot below already
    // contains them, so this subscriber must not get them again as a patch.
    flush(entry);
    conn.subs.set(sid, entry);
    entry.subscribers.add(conn);
    send(conn, { type: 'snapshot', sid, slice, value: entry.raw, rev: entry.rev });
  }

  function forwardEvent(name: string) {
    if (busForwarders.has(name)) return;
    busForwarders.set(
      name,
      bus.on(name, payload => {
        for (const c of connections) {
          if (c.events.has(name)) send(c, { type: 'event', name, payload });
        }
      }),
    );
  }

  function maybeStopForwarding(name: string) {
    for (const c of connections) if (c.events.has(name)) return;
    busForwarders.get(name)?.();
    busForwarders.delete(name);
  }

  // ---- meters: the generator runs ONLY while somebody listens -------------------------------

  let metersTimer: ReturnType<typeof setInterval> | null = null;
  let metersActive = false;
  function updateMeters() {
    const m = options.meters;
    const wanted = !!m && [...connections].some(c => c.meters);
    if (wanted !== metersActive) {
      metersActive = wanted;
      try {
        m?.onActiveChange?.(wanted);
      } catch (e) {
        console.error('[runtime] meters onActiveChange threw', e);
      }
    }
    if (wanted && !metersTimer) {
      metersTimer = setInterval(() => {
        const data = m.sample();
        for (const c of connections) if (c.meters) send(c, { type: 'meters', data });
      }, m.intervalMs ?? 66);
    } else if (!wanted && metersTimer) {
      clearInterval(metersTimer);
      metersTimer = null;
    }
  }

  function close(conn: Connection) {
    if (conn.closed) return;
    conn.closed = true;
    connections.delete(conn);
    for (const sid of [...conn.subs.keys()]) detach(conn, sid);
    const events = [...conn.events];
    conn.events.clear();
    events.forEach(maybeStopForwarding);
    conn.meters = false;
    updateMeters();
    for (const cb of [...disconnectListeners]) {
      try {
        cb(conn.id);
      } catch (e) {
        console.error('[runtime] onDisconnect listener threw', e);
      }
    }
  }

  function attach(transport: Transport, meta: AttachMeta = { windowId: 0 }) {
    const conn: Connection = {
      id: nextConnId++,
      windowId: meta.windowId,
      transport,
      subs: new Map(),
      events: new Set(),
      meters: false,
      closed: false,
    };
    connections.add(conn);
    transport.onClose(() => close(conn));
    transport.onMessage(msg => {
      switch (msg.type) {
        case 'ping':
          send(conn, { type: 'pong', id: msg.id, t: msg.t, ts: Date.now() });
          break;
        case 'call':
          void handleCall(conn, msg);
          break;
        case 'sub':
          handleSub(conn, msg.sid, msg.slice);
          break;
        case 'unsub':
          detach(conn, msg.sid);
          break;
        case 'on':
          conn.events.add(msg.event);
          forwardEvent(msg.event);
          break;
        case 'off':
          conn.events.delete(msg.event);
          maybeStopForwarding(msg.event);
          break;
        case 'meters-on':
          conn.meters = true;
          updateMeters();
          break;
        case 'meters-off':
          conn.meters = false;
          updateMeters();
          break;
      }
    });
    return {
      connId: conn.id,
      send: (msg: ServerMessage) => send(conn, msg),
      close: () => close(conn),
    };
  }

  function broadcast(msg: ServerMessage) {
    for (const c of connections) send(c, msg);
  }

  function registerCommands<T extends keyof C['commands'] & string>(
    target: T,
    impl: CommandImpl<C, T>,
  ) {
    if (commands.has(target)) throw new Error(`commands already registered: ${target}`);
    commands.set(target, impl as Record<string, unknown>);
  }

  return {
    defineSlice,
    defineSliceFactory,
    registerCommands,
    bus: bus as unknown as Bus<C['events']>,
    attach,
    broadcast,
    /** The calling connection; call it synchronously at the start of a command implementation. */
    caller: (): CallerInfo | null => currentCaller,
    /** Called when a window connection closes. Returns a disposer. */
    onDisconnect(cb: (connId: number) => void) {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    /** Tracked state of a slice that currently exists (parameterized slices exist while subscribed). */
    getSlice<K extends string>(
      name: K,
    ): (K extends keyof C['slices'] ? C['slices'][K] : never) | undefined {
      return slices.get(name)?.state as never;
    },
    /** Diagnostics for tests. */
    stats: () => ({
      connections: connections.size,
      slices: slices.size,
      subscribers: [...slices.values()].reduce((n, s) => n + s.subscribers.size, 0),
      metersRunning: metersTimer !== null,
      busForwarders: busForwarders.size,
    }),
  };
}

export type Runtime<C extends Contract> = ReturnType<typeof createRuntime<C>>;
