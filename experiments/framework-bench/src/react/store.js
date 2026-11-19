// Tiny keyed external store for useSyncExternalStore: each key has its own listener set, so an
// update notifies only the components subscribed to that key (e.g. one source row, one meter).
import { useSyncExternalStore, useCallback } from 'react';

export function createStore(initial) {
  const values = new Map(Object.entries(initial));
  const listeners = new Map();
  return {
    get: key => values.get(key),
    set(key, value) {
      if (values.get(key) === value) return;
      values.set(key, value);
      const ls = listeners.get(key);
      if (ls) ls.forEach(fn => fn());
    },
    subscribe(key, fn) {
      let ls = listeners.get(key);
      if (!ls) listeners.set(key, (ls = new Set()));
      ls.add(fn);
      return () => ls.delete(fn);
    },
  };
}

// Subscribe to `key`; optional `select` derives a value from it (re-render only when it changes).
export function useStoreKey(store, key, select) {
  const subscribe = useCallback(fn => store.subscribe(key, fn), [store, key]);
  const get = useCallback(() => (select ? select(store.get(key)) : store.get(key)), [store, key, select]);
  return useSyncExternalStore(subscribe, get);
}
