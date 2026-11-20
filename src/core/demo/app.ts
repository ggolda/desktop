import type { CoreContract, CoreStats } from '../../shared/contracts';
import type { CoreStatus } from '../../shared/protocol';
import type { Runtime } from '../runtime/runtime';

/** Demo slice + commands proving the protocol end to end (replaced by real domain code in M1). */
export function registerAppDemo(
  rt: Runtime<CoreContract>,
  obs: CoreStatus,
  stats: () => CoreStats = () => ({ marks: {}, maxStallMs: 0, maxStallMethod: '', backend: {} }),
) {
  const state = rt.defineSlice('app', { obs, counter: 0, items: [] });
  let nextId = 1;
  let ticks = 0;

  rt.registerCommands('app', {
    increment: () => ++state.counter,
    addItem(name) {
      const id = nextId++;
      state.items.push({ id, name });
      return id;
    },
    renameItem(id, name) {
      const item = state.items.find(i => i.id === id);
      if (!item) throw new Error(`no item ${id}`);
      item.name = name;
    },
    removeItem(id) {
      const i = state.items.findIndex(it => it.id === id);
      if (i >= 0) state.items.splice(i, 1);
    },
    tick() {
      rt.bus.emit('app.tick', { n: ++ticks, ts: Date.now() });
    },
    stats,
  });

  return state;
}

/** Fake meters: two channels, only sampled while a window has meters on. */
export function fakeMeters(): Float32Array {
  const t = Date.now() / 1000;
  return new Float32Array([-30 + 20 * Math.sin(t * 2), -25 + 15 * Math.sin(t * 3 + 1)]);
}
