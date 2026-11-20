import {
  readonly,
  toValue,
  type MaybeRefOrGetter,
  shallowReadonly,
  shallowRef,
  watch,
  type DeepReadonly,
  type Ref,
  type ShallowRef,
} from 'vue';
import type { Contract, SliceKey } from '../../shared/contracts/types';
import type { CoreClient } from './client';

/**
 * Vue bindings for a CoreClient. Every composable must run inside an effect scope (component setup,
 * Pinia setup store, `effectScope().run`): its subscription ends with the scope. The client is a ref
 * so composables can be created before the port is connected.
 */
export function createCoreComposables<C extends Contract>(
  clientRef: Readonly<Ref<CoreClient<C> | undefined>>,
) {
  /**
   * Read-only live view of a slice (undefined until the snapshot arrives or while disconnected).
   * Several components share one core subscription (ref-counted in the client). Patches are applied to
   * a deep reactive object, so a rename re-renders only what reads that field.
   * The name may be a getter/ref (`sceneItems:<activeId>`): the subscription follows it, and a
   * `undefined` name means no subscription.
   */
  function useSlice<K extends SliceKey<C>>(
    nameSource: MaybeRefOrGetter<K | undefined>,
  ): Readonly<ShallowRef<DeepReadonly<C['slices'][K]> | undefined>> {
    const view = shallowRef<DeepReadonly<C['slices'][K]> | undefined>();
    watch(
      [clientRef, () => toValue(nameSource)] as const,
      ([client, name], _old, onCleanup) => {
        if (!client || !name) return;
        const stop = client.subscribe(name, state => {
          view.value = readonly(state) as DeepReadonly<C['slices'][K]>; // same proxy while patching
        });
        onCleanup(() => {
          stop();
          view.value = undefined;
        });
      },
      { immediate: true, flush: 'sync' },
    );
    return shallowReadonly(view);
  }

  /** Calls `cb` for each core bus event while the scope lives (the core only forwards subscribed events). */
  function useEvent<E extends keyof C['events'] & string>(
    event: E,
    cb: (payload: C['events'][E]) => void,
  ) {
    watch(
      clientRef,
      (client, _old, onCleanup) => {
        if (client) onCleanup(client.on(event, cb));
      },
      { immediate: true, flush: 'sync' },
    );
  }

  /** Latest meters frame while `enabled` is true; the core sampler stops when it is false. */
  function useMeters(enabled: Readonly<Ref<boolean>>) {
    const data = shallowRef<Float32Array | number[]>([]);
    watch(
      [clientRef, enabled],
      ([client, on], _old, onCleanup) => {
        if (!client || !on) return;
        onCleanup(client.meters(d => (data.value = d)));
      },
      { immediate: true, flush: 'sync' },
    );
    return shallowReadonly(data);
  }

  return { useSlice, useEvent, useMeters };
}
