import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useSlice } from '@/ui/core';

/**
 * Intended store pattern (SPEC 3.2): a read-only live slice from core + window-local UI state.
 * Writes never touch the slice; they go through commands (`client.call.app.*`).
 */
export const useAppStore = defineStore('app', () => {
  const app = useSlice('app'); // shared, ref-counted subscription; ends when the store is disposed

  // window-local UI state (never sent to core)
  const selectedId = ref<number | null>(null);

  return { app, selectedId };
});
