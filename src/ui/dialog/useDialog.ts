import type { DeepReadonly } from 'vue';
import { computed, watchEffect } from 'vue';
import type { DialogKind, DialogState } from '@/shared/contracts';
import { useSlice } from '@/ui/core';

export type DialogOf<K extends DialogKind> = DeepReadonly<Extract<DialogState, { kind: K }>>;

/** The page learns its dialog id from `?dialog=<id>` (design 3.3). */
export const dialogIdFromUrl = () => new URLSearchParams(location.search).get('dialog') ?? '';

/** Closes this dialog window (the dev fake page has no window bridge). */
export function closeDialogWindow() {
  if (window.reborn?.window) window.reborn.window.close();
  else window.close();
}

/**
 * Subscribes `dialog:<id>` (the first message of the page) and exposes it typed by kind. `state` is
 * undefined until the snapshot arrives; `document.title` follows the dialog title.
 */
export function useDialog<K extends DialogKind>(id: string = dialogIdFromUrl()) {
  const slice = useSlice(() => (id ? (`dialog:${id}` as const) : undefined));
  const state = computed(() => slice.value as DialogOf<K> | undefined);
  watchEffect(() => {
    if (state.value) document.title = state.value.title;
  });
  return { id, state, close: closeDialogWindow };
}
