import { onScopeDispose, reactive } from 'vue';
import type { Property, PropertyValue } from '@/shared/contracts';
import { commands } from '@/ui/core';

export type FormLayout = 'horizontal' | 'vertical';

/** Commit delay in ms (legacy debounce table, design 1.3; `0` = immediately, `-1` = only on change/blur). */
export function commitDelay(p: Property, layout: FormLayout): number {
  switch (p.kind) {
    case 'slider':
      return layout === 'horizontal' ? 500 : 100;
    case 'color':
      return 500;
    case 'multiline':
      return 300;
    case 'text':
      if (p.name === 'url') return layout === 'horizontal' ? 1000 : -1;
      return 300;
    case 'path-file':
    case 'path-save':
    case 'path-dir':
      return -1; // typed paths are applied on change/blur and by Browse
    case 'password':
    case 'int':
    case 'float':
      return 300;
    default:
      return 0;
  }
}

/**
 * Optimistic edits of one property form. The shown value of a property is the edited one until the
 * command it belongs to has been answered (core patched the slice before it answered); a newer edit
 * keeps its own value. Timers exist only while an edit is waiting for its debounce.
 */
export function usePropertyEdits(sourceId: () => string) {
  const local = reactive<Record<string, PropertyValue>>({});
  const seq = new Map<string, number>();
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; value: PropertyValue }>();

  function send(name: string, value: PropertyValue) {
    const mine = (seq.get(name) ?? 0) + 1;
    seq.set(name, mine);
    commands.properties
      .set(sourceId(), [{ name, value }])
      .catch(e => console.error('[properties] set failed:', e instanceof Error ? e.message : e))
      .finally(() => {
        if (seq.get(name) === mine && !pending.has(name)) delete local[name];
      });
  }

  /** Shows `value` now and sends it after `delay` ms (0: now). */
  function edit(name: string, value: PropertyValue, delay = 0) {
    local[name] = value;
    const old = pending.get(name);
    if (old) clearTimeout(old.timer);
    if (delay <= 0) {
      pending.delete(name);
      send(name, value);
      return;
    }
    pending.set(name, {
      value,
      timer: setTimeout(() => {
        pending.delete(name);
        send(name, value);
      }, delay),
    });
  }

  /** Shows `value` and sends nothing (invalid input kept in the field, e.g. a number out of range). */
  function hold(name: string, value: PropertyValue) {
    const old = pending.get(name);
    if (old) clearTimeout(old.timer);
    pending.delete(name);
    local[name] = value;
  }

  /** Sends every edit that still waits for its debounce (Close / Done / blur / window unload). */
  function flush() {
    for (const [name, p] of [...pending]) {
      clearTimeout(p.timer);
      pending.delete(name);
      send(name, p.value);
    }
  }

  onScopeDispose(flush);
  return {
    local,
    edit,
    hold,
    flush,
    has: (name: string) => name in local,
    hasPending: (name: string) => pending.has(name),
    pendingCount: () => pending.size,
  };
}
