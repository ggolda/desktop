import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { commands, useSlice } from '@/ui/core';
import { openDialog } from '@/ui/dialog/open';
import { run } from '@/ui/lib/run';

/** Scene list: live `scenes` slice + window-local UI state (inline edit, pending delete). */
export const useScenesStore = defineStore('scenes', () => {
  const slice = useSlice('scenes');

  const list = computed(() => slice.value?.scenes ?? []);
  const activeId = computed(() => slice.value?.activeSceneId ?? null);
  const loaded = computed(() => slice.value !== undefined);

  // window-local UI state (never sent to core)
  const pendingRemoveId = ref<string | null>(null);

  return {
    list,
    activeId,
    loaded,
    pendingRemoveId,
    canRemove: computed(() => list.value.length > 1),
    makeActive: (id: string) => {
      if (id !== activeId.value) run(commands.scenes.makeActive(id), 'scenes.makeActive');
    },
    /** "+": the Name Scene window (legacy child window); core creates the scene when it is done. */
    add: () => openDialog({ kind: 'name-scene', params: {}, title: 'Name Scene' }),
    duplicate: (id: string) =>
      openDialog({ kind: 'name-scene', params: { duplicateFrom: id }, title: 'Name Scene' }),
    /** Legacy has no inline rename: the Rename Scene window. */
    startRename: (id: string) =>
      openDialog({ kind: 'name-scene', params: { rename: id }, title: 'Rename Scene' }),
    askRemove: (id: string) => (pendingRemoveId.value = id),
    confirmRemove: () => {
      const id = pendingRemoveId.value;
      pendingRemoveId.value = null;
      if (id) run(commands.scenes.remove(id), 'scenes.remove');
    },
    cancelRemove: () => (pendingRemoveId.value = null),
    /** Moves `id` before/after `targetId` and sends the full order. */
    move: (id: string, targetId: string, where: 'before' | 'after') => {
      if (id === targetId) return;
      const ids = list.value.map(s => s.id).filter(i => i !== id);
      const at = ids.indexOf(targetId) + (where === 'after' ? 1 : 0);
      ids.splice(at, 0, id);
      run(commands.scenes.reorder(ids), 'scenes.reorder');
    },
  };
});
