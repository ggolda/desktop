import type { CommandProxy, Contract, SliceKey } from '../../shared/contracts/types';
import { applyOps } from '../../shared/patch';
import type { ClientMessage, CoreStatus, ErrorInfo, ServerMessage } from '../../shared/protocol';

/** What the client needs from the window's MessagePort (DOM ports and test ports are adapted). */
export interface ClientTransport {
  post(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): void;
  close?(): void;
}

export class CoreCallError extends Error {
  code?: string;
  constructor(info: ErrorInfo) {
    super(info.message);
    this.name = 'CoreCallError';
    this.code = info.code;
  }
}

export interface ClientOptions {
  /** Wraps snapshots (pass Vue's `reactive` in windows). Patches are applied through the wrapper. */
  makeState?: (v: object) => object;
}

/** Client-side view of one slice: shared by all listeners, ref-counted against the core. */
export interface SliceHandle<S extends object> {
  readonly name: string;
  /** Undefined until the first snapshot arrives. */
  readonly state: S | undefined;
  readonly rev: number;
  /** cb runs after every snapshot and every applied patch. Returns the unsubscribe function. */
  subscribe(cb: (state: S) => void): () => void;
}

export interface CoreClient<C extends Contract> {
  /** `client.call.<target>.<method>(...args)`: typed, async, runs in core. */
  call: CommandProxy<C>;
  slice<K extends SliceKey<C>>(name: K): SliceHandle<C['slices'][K]>;
  subscribe<K extends SliceKey<C>>(name: K, cb: (state: C['slices'][K]) => void): () => void;
  on<E extends keyof C['events'] & string>(
    event: E,
    cb: (payload: C['events'][E]) => void,
  ): () => void;
  /** Meters channel: the core generator runs only while at least one listener exists. */
  meters(cb: (data: Float32Array | number[]) => void): () => void;
  onStatus(cb: (status: CoreStatus) => void): () => void;
  ping(): Promise<number>;
  /** Rejects pending calls and detaches. */
  close(): void;
  /** Diagnostics for tests. */
  stats(): { pendingCalls: number; activeSubs: number; resubscribes: number };
}

interface SliceInternal {
  handle: SliceHandle<object>;
  sid: number;
  listeners: Set<(state: object) => void>;
  stale: boolean; // waiting for a (re)snapshot; patches are ignored
  setState(v: object | undefined, rev: number): void;
}

export function createClient<C extends Contract>(
  transport: ClientTransport,
  options: ClientOptions = {},
): CoreClient<C> {
  const makeState = options.makeState ?? ((v: object) => v);
  let nextCallId = 1;
  let nextSid = 1;
  let resubscribes = 0;
  let closed = false;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  const pings = new Map<number, number>();
  const slices = new Map<string, SliceInternal>();
  const bySid = new Map<number, SliceInternal>();
  const eventListeners = new Map<string, Set<(p: never) => void>>();
  const meterListeners = new Set<(d: Float32Array | number[]) => void>();
  const statusListeners = new Set<(s: CoreStatus) => void>();
  let lastStatus: CoreStatus | undefined;

  const post = (msg: ClientMessage) => {
    if (!closed) transport.post(msg);
  };

  function getSlice(name: string): SliceInternal {
    const s = slices.get(name);
    if (s) return s;
    let state: object | undefined;
    let rev = 0;
    const internal: SliceInternal = {
      sid: nextSid++,
      listeners: new Set(),
      stale: true,
      setState(v, r) {
        state = v;
        rev = r;
      },
      handle: {
        name,
        get state() {
          return state;
        },
        get rev() {
          return rev;
        },
        subscribe(cb) {
          internal.listeners.add(cb);
          if (internal.listeners.size === 1) {
            internal.stale = true;
            bySid.set(internal.sid, internal);
            post({ type: 'sub', sid: internal.sid, slice: name });
          } else if (state !== undefined) {
            cb(state);
          }
          return () => {
            if (!internal.listeners.delete(cb) || internal.listeners.size > 0) return;
            bySid.delete(internal.sid);
            internal.stale = true;
            state = undefined; // do not keep serving state that is no longer being updated
            post({ type: 'unsub', sid: internal.sid });
          };
        },
      },
    };
    slices.set(name, internal);
    return internal;
  }

  function resubscribe(s: SliceInternal) {
    resubscribes++;
    s.stale = true;
    post({ type: 'sub', sid: s.sid, slice: s.handle.name });
  }

  function notify(s: SliceInternal) {
    for (const cb of [...s.listeners]) {
      try {
        cb(s.handle.state as object);
      } catch (e) {
        console.error('[core-client] slice listener threw', e);
      }
    }
  }

  transport.onMessage(msg => {
    switch (msg.type) {
      case 'result': {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new CoreCallError(msg.error));
        break;
      }
      case 'snapshot': {
        const s = bySid.get(msg.sid);
        if (!s) return;
        s.stale = false;
        s.setState(makeState(msg.value as object), msg.rev);
        notify(s);
        break;
      }
      case 'patch': {
        const s = bySid.get(msg.sid);
        if (!s || s.stale) return;
        if (msg.rev <= s.handle.rev) return; // duplicate
        if (msg.rev !== s.handle.rev + 1) return resubscribe(s); // gap: fetch a fresh snapshot
        applyOps(s.handle.state as object, msg.ops);
        s.setState(s.handle.state, msg.rev);
        notify(s);
        break;
      }
      case 'sub-error':
        console.error(`[core-client] cannot subscribe to ${msg.slice}: ${msg.error.message}`);
        break;
      case 'event':
        for (const l of [...(eventListeners.get(msg.name) ?? [])]) {
          try {
            (l as (p: unknown) => void)(msg.payload);
          } catch (e) {
            console.error(`[core-client] listener for ${msg.name} threw`, e);
          }
        }
        break;
      case 'meters':
        for (const l of [...meterListeners]) l(msg.data);
        break;
      case 'status':
        lastStatus = msg.status;
        for (const l of [...statusListeners]) l(msg.status);
        break;
      case 'pong': {
        const t0 = pings.get(msg.id);
        pings.delete(msg.id);
        if (t0 !== undefined) pendingPing.get(msg.id)?.(performance.now() - t0);
        pendingPing.delete(msg.id);
        break;
      }
    }
  });

  const pendingPing = new Map<number, (ms: number) => void>();

  function invoke(target: string, method: string, args: unknown[]): Promise<unknown> {
    if (closed) return Promise.reject(new Error('core client closed'));
    return new Promise((resolve, reject) => {
      const id = nextCallId++;
      pending.set(id, { resolve, reject });
      post({ type: 'call', id, target, method, args });
    });
  }

  const call = new Proxy(
    {},
    {
      get(_, target) {
        if (typeof target !== 'string' || target === 'then') return undefined;
        return new Proxy(
          {},
          {
            get(_t, method) {
              if (typeof method !== 'string' || method === 'then') return undefined;
              return (...args: unknown[]) => invoke(target, method, args);
            },
          },
        );
      },
    },
  ) as CommandProxy<C>;

  function addListener<T>(set: Set<T>, l: T, first: () => void, last: () => void) {
    set.add(l);
    if (set.size === 1) first();
    return () => {
      if (set.delete(l) && set.size === 0) last();
    };
  }

  return {
    call,
    slice: name => getSlice(name).handle as never,
    subscribe: (name, cb) => getSlice(name).handle.subscribe(cb as (s: object) => void),
    on(event, cb) {
      let set = eventListeners.get(event);
      if (!set) eventListeners.set(event, (set = new Set()));
      return addListener(
        set,
        cb as (p: never) => void,
        () => post({ type: 'on', event }),
        () => post({ type: 'off', event }),
      );
    },
    meters: cb =>
      addListener(
        meterListeners,
        cb,
        () => post({ type: 'meters-on' }),
        () => post({ type: 'meters-off' }),
      ),
    onStatus(cb) {
      statusListeners.add(cb);
      if (lastStatus) cb(lastStatus);
      return () => void statusListeners.delete(cb);
    },
    ping() {
      return new Promise<number>(resolve => {
        const id = nextCallId++;
        pings.set(id, performance.now());
        pendingPing.set(id, resolve);
        post({ type: 'ping', id, t: Date.now() });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const p of pending.values()) p.reject(new Error('core client closed'));
      pending.clear();
      transport.close?.();
    },
    stats: () => ({ pendingCalls: pending.size, activeSubs: bySid.size, resubscribes }),
  };
}
