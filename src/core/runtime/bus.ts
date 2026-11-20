// Typed in-core event emitter. Forwarding to windows is done by the runtime (only subscribed events).

export class Bus<E extends Record<string, unknown>> {
  private listeners = new Map<keyof E, Set<(payload: never) => void>>();

  emit<K extends keyof E>(name: K, payload: E[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const l of [...set]) {
      try {
        (l as (p: E[K]) => void)(payload);
      } catch (e) {
        console.error(`[bus] listener for ${String(name)} threw`, e);
      }
    }
  }

  /** Returns a disposer. */
  on<K extends keyof E>(name: K, listener: (payload: E[K]) => void): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    const l = listener as (p: never) => void;
    set.add(l);
    return () => {
      set.delete(l);
      if (set.size === 0 && this.listeners.get(name) === set) this.listeners.delete(name);
    };
  }

  hasListeners(name: keyof E): boolean {
    return this.listeners.has(name);
  }
}
