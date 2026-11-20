// Startup marks and backend call timing (m1-design 7, owner decision 1: blocking OSN calls are
// accepted for M1 but every call is measured). No timers: everything is recorded at call time.

export interface CallStat {
  count: number;
  totalMs: number;
  maxMs: number;
  /** Calls slower than SLOW_MS. */
  slow: number;
}

export interface PerfStats {
  marks: Record<string, number>;
  /** Longest single backend call = longest event-loop stall we caused. */
  maxStallMs: number;
  maxStallMethod: string;
  backend: Record<string, CallStat>;
}

export const SLOW_MS = 50;

export interface Perf {
  /** Records `name` at the time since core start and logs a `[perf] mark name ms` line. */
  mark(name: string): void;
  /** Records one backend call. */
  record(method: string, ms: number): void;
  stats(): PerfStats;
  now(): number;
}

export function createPerf(opts: { log?: (line: string) => void; t0?: number } = {}): Perf {
  const log = opts.log ?? ((l: string) => console.log(l));
  const t0 = opts.t0 ?? performance.now();
  const marks: Record<string, number> = {};
  const backend: Record<string, CallStat> = {};
  let maxStallMs = 0;
  let maxStallMethod = '';
  return {
    now: () => performance.now() - t0,
    mark(name) {
      const ms = Math.round(performance.now() - t0);
      marks[name] = ms;
      log(`[perf] mark ${name} ${ms}`);
    },
    record(method, ms) {
      const s = (backend[method] ??= { count: 0, totalMs: 0, maxMs: 0, slow: 0 });
      s.count++;
      s.totalMs += ms;
      if (ms > s.maxMs) s.maxMs = ms;
      if (ms > maxStallMs) {
        maxStallMs = ms;
        maxStallMethod = method;
      }
      if (ms > SLOW_MS) {
        s.slow++;
        log(`[perf] slow ${method} ${Math.round(ms)}ms`);
      }
    },
    stats: () => ({
      marks: { ...marks },
      maxStallMs: Math.round(maxStallMs * 10) / 10,
      maxStallMethod,
      backend: Object.fromEntries(
        Object.entries(backend).map(([k, v]) => [
          k,
          { ...v, totalMs: Math.round(v.totalMs * 10) / 10, maxMs: Math.round(v.maxMs * 10) / 10 },
        ]),
      ),
    }),
  };
}

type AnyFn = (...a: unknown[]) => unknown;

/**
 * Wraps every function of a backend namespace tree so its duration is recorded. The adapter's calls
 * are synchronous inside async functions, so the measured time is the time core was blocked.
 */
export function instrument<T extends object>(target: T, perf: Perf, prefix = ''): T {
  return new Proxy(target, {
    get(t, key, recv) {
      const v = Reflect.get(t, key, recv);
      if (typeof key !== 'string') return v;
      const name = prefix ? `${prefix}.${key}` : key;
      if (typeof v === 'function') {
        if (key === 'on' || key === 'onMeterData') return v.bind(t);
        return (...args: unknown[]) => {
          const t0 = performance.now();
          const r = (v as AnyFn).apply(t, args);
          if (r instanceof Promise) {
            return r.finally(() => perf.record(name, performance.now() - t0));
          }
          perf.record(name, performance.now() - t0);
          return r;
        };
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && key !== 'info') {
        return instrument(v as object, perf, name);
      }
      return v;
    },
  });
}
