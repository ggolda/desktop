import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import type { SceneNode, SourceType, TransformAction } from '@/shared/contracts';
import { commands, useSlice } from '@/ui/core';
import { openDialog } from '@/ui/dialog/open';
import { run } from '@/ui/lib/run';
import { propertiesTitle } from '@/ui/source-types';
import { useScenesStore } from './scenes';

export interface SourceRow {
  id: string;
  kind: 'item' | 'folder';
  depth: number;
  name: string;
  type: SourceType | 'folder';
  /** `propertiesManager` of the source (widget icons); empty for folders. */
  manager: string;
  /** False when the source is not in the `sources` slice (missing plugin/device, design 3.6) or still loading. */
  available: boolean;
  loading: boolean;
  visible: boolean;
  locked: boolean;
  selected: boolean;
  collapsed: boolean;
}

export interface ClickMods {
  ctrl?: boolean;
  shift?: boolean;
}

/**
 * Items of the active scene: `sceneItems:<activeSceneId>` + `sources` (names/types) + `selection`,
 * flattened into rows (folders collapsible, window-local). Writes go through commands.
 */
export const useSourcesStore = defineStore('sources', () => {
  const scenes = useScenesStore();
  const items = useSlice(() =>
    scenes.activeId ? (`sceneItems:${scenes.activeId}` as const) : undefined,
  );
  const sources = useSlice('sources');
  const selection = useSlice('selection');

  const collapsed = reactive(new Set<string>());
  const pendingRemove = ref<string[] | null>(null);

  const sceneId = computed(() => items.value?.sceneId ?? null);
  const selectedIds = computed(() => {
    const sel = selection.value;
    return sel && sel.sceneId === sceneId.value ? sel.ids : [];
  });

  const rows = computed<SourceRow[]>(() => {
    const nodes: readonly SceneNode[] = items.value?.nodes ?? [];
    const byId = new Map(nodes.map(n => [n.id, n]));
    const selected = new Set(selectedIds.value);
    const out: SourceRow[] = [];
    for (const n of nodes) {
      // depth and hidden-by-collapsed-ancestor
      let depth = 0;
      let hidden = false;
      for (let p = n.parentId; p; p = byId.get(p)?.parentId ?? null) {
        depth++;
        if (collapsed.has(p)) hidden = true;
      }
      if (hidden) continue;
      if (n.kind === 'folder') {
        out.push({
          id: n.id,
          kind: 'folder',
          depth,
          name: n.name,
          type: 'folder',
          manager: '',
          available: true,
          loading: false,
          visible: true,
          locked: false,
          selected: selected.has(n.id),
          collapsed: collapsed.has(n.id),
        });
      } else {
        const src = sources.value?.sources[n.sourceId];
        out.push({
          id: n.id,
          kind: 'item',
          depth,
          name: src?.name ?? n.sourceId,
          type: src?.type ?? 'unknown',
          manager: src?.propertiesManager ?? '',
          available: !!src && src.status === 'ready',
          loading: src?.status === 'loading',
          visible: n.visible,
          locked: n.locked,
          selected: selected.has(n.id),
          collapsed: false,
        });
      }
    }
    return out;
  });

  const withScene = (fn: (sid: string) => Promise<unknown>, what: string) => {
    if (sceneId.value) run(fn(sceneId.value), what);
  };

  return {
    rows,
    sceneId,
    selectedIds,
    /** Visibility of an item even when its row is collapsed away. */
    itemVisible: (id: string) => {
      const n = items.value?.nodes.find(x => x.id === id);
      return n?.kind === 'item' ? n.visible : true;
    },
    /** Locks or unlocks every item of the scene ("Lock Sources" / "Unlock Sources"). */
    setAllLocked: (locked: boolean) => {
      const ids = (items.value?.nodes ?? []).filter(n => n.kind === 'item').map(n => n.id);
      if (ids.length) withScene(s => commands.sceneItems.update(s, ids, { locked }), 'update');
    },
    sourceIdOf: (rowId: string) => {
      const n = items.value?.nodes.find(x => x.id === rowId);
      return n && n.kind === 'item' ? n.sourceId : null;
    },
    nameOf: (id: string) => rows.value.find(r => r.id === id)?.name ?? '',
    selectAll: () => run(commands.selection.selectAll(), 'selection.selectAll'),
    invertSelection() {
      const sel = new Set(selectedIds.value);
      const ids = rows.value.filter(r => !sel.has(r.id)).map(r => r.id);
      run(commands.selection.set(ids), 'selection.set');
    },
    transform: (ids: string[], action: TransformAction) =>
      withScene(s => commands.sceneItems.transformAction(s, ids, action), 'transformAction'),
    setVisible: (ids: string[], visible: boolean) =>
      withScene(s => commands.sceneItems.update(s, ids, { visible }), 'update'),
    pendingRemove,
    loaded: computed(() => items.value !== undefined),

    /** Click / ctrl+click (toggle) / shift+click (range from the last selected row). */
    select(id: string, mods: ClickMods = {}) {
      const ids = rows.value.map(r => r.id);
      if (mods.shift && selection.value?.lastId && ids.includes(selection.value.lastId)) {
        const a = ids.indexOf(selection.value.lastId);
        const b = ids.indexOf(id);
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        run(commands.selection.set(range), 'selection.set');
      } else if (mods.ctrl) {
        const on = selectedIds.value.includes(id);
        run(on ? commands.selection.remove([id]) : commands.selection.add([id]), 'selection');
      } else {
        // always set: a plain click also makes this row the anchor for shift-click ranges
        run(commands.selection.set([id]), 'selection.set');
      }
    },
    clearSelection: () => run(commands.selection.clear(), 'selection.clear'),
    toggleVisible: (id: string) => {
      const row = rows.value.find(r => r.id === id);
      if (row) {
        withScene(s => commands.sceneItems.update(s, [id], { visible: !row.visible }), 'update');
      }
    },
    toggleLocked: (id: string) => {
      const row = rows.value.find(r => r.id === id);
      if (row) {
        withScene(s => commands.sceneItems.update(s, [id], { locked: !row.locked }), 'update');
      }
    },
    toggleCollapsed: (id: string) => {
      if (!collapsed.delete(id)) collapsed.add(id);
    },
    /** "+": the Add Source showcase window. */
    openAddSource: () => openDialog({ kind: 'source-showcase', params: {}, title: 'Add Source' }),
    /** Legacy has no inline rename: Rename Source / Rename Folder windows. */
    startRename(id: string) {
      const node = items.value?.nodes.find(n => n.id === id);
      if (!node) return;
      if (node.kind === 'folder') {
        openDialog({
          kind: 'name-folder',
          params: { sceneId: items.value!.sceneId, renameId: id },
          title: 'Rename Folder',
        });
      } else {
        openDialog({
          kind: 'rename-source',
          params: { sourceId: node.sourceId },
          title: 'Rename Source',
        });
      }
    },
    /** Source Properties window of an item row (double click, menu, gear icon). */
    openProperties(id: string) {
      const node = items.value?.nodes.find(n => n.id === id);
      if (node?.kind !== 'item') return;
      const src = sources.value?.sources[node.sourceId];
      if (!src || src.status !== 'ready') return;
      openDialog({
        kind: 'source-properties',
        params: { sourceId: node.sourceId },
        title: propertiesTitle(src.type),
      });
    },
    /** Asks for confirmation for the selection (or `ids`). */
    askRemove(ids?: string[]) {
      const list = ids ?? [...selectedIds.value];
      if (list.length) pendingRemove.value = list;
    },
    confirmRemove() {
      const ids = pendingRemove.value;
      pendingRemove.value = null;
      // a plain copy: the ref holds a reactive proxy, which a MessagePort cannot clone
      if (ids) withScene(s => commands.sceneItems.remove(s, [...ids]), 'sceneItems.remove');
    },
    cancelRemove: () => (pendingRemove.value = null),
    /** Drag and drop: moves `ids` (the dragged row, or the selection when it was part of it). */
    move(ids: string[], targetId: string, where: 'before' | 'after') {
      if (ids.includes(targetId)) return;
      withScene(s => commands.sceneItems.move(s, ids, { type: where, id: targetId }), 'move');
    },
  };
});
