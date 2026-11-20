<script setup lang="ts">
import { computed } from 'vue';
import ConfirmDialog from '@/ui/components/ConfirmDialog.vue';
import SourceIcon from '@/ui/components/SourceIcon.vue';
import VirtualList from '@/ui/components/VirtualList.vue';
import { useRowDnd } from '@/ui/composables/row-dnd';
import { useScenesStore } from '@/ui/stores/scenes';
import { useSourcesStore, type SourceRow } from '@/ui/stores/sources';
import { useEditMenu } from '../composables/edit-menu';

const store = useSourcesStore();
const scenes = useScenesStore();

const dnd = useRowDnd({
  // dragging a selected row moves the whole selection
  dragIds: id => (store.selectedIds.includes(id) ? [...store.selectedIds] : [id]),
  onDrop: (ids, target, where) => store.move(ids, target, where),
});

const removeText = computed(() => {
  const n = store.pendingRemove?.length ?? 0;
  return n > 1 ? `${n} items` : 'this item';
});

const menu = useEditMenu();

function onContext(row: SourceRow) {
  if (!store.selectedIds.includes(row.id)) store.select(row.id);
  menu.popupSource(row.id);
}

function rowTitle(row: SourceRow) {
  if (!row.available && !row.loading)
    return 'This source is unavailable (missing plugin or device)';
  return undefined;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Delete') store.askRemove();
  else if (e.key === 'F2' && store.selectedIds.length === 1)
    store.startRename(store.selectedIds[0]);
}
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col" aria-label="Sources">
    <div class="mb-2 flex shrink-0 items-center" data-name="sourcesControls">
      <span
        class="mr-1 min-w-0 truncate text-[16px] leading-[25.1px] font-medium text-title"
        title="The building blocks of your scene. Also contains widgets."
        >Sources</span
      >
      <i
        class="icon-add-circle icon-button icon-button--lg mr-auto"
        title="Add a new Source to your Scene. Includes widgets."
        data-testid="source-add"
        @click="store.openAddSource()"
      />
      <i
        class="icon-smart-record icon-button icon-button--lg"
        title="Toggle Selective Recording (not available yet)"
      />
      <i
        class="icon-add-folder icon-button icon-button--lg"
        title="Add a Group so you can move multiple Sources at the same time. (not available yet)"
      />
    </div>

    <div
      class="min-h-0 flex-1 overflow-hidden rounded-[4px] bg-section outline-none"
      tabindex="0"
      @keydown="onKey"
    >
      <VirtualList :items="store.rows" :item-height="32" :key-of="r => r.id">
        <template #default="{ item: row }">
          <div
            :data-row-id="row.id"
            data-testid="source-row"
            :data-selected="row.selected || undefined"
            :data-available="row.available"
            :title="rowTitle(row)"
            draggable="true"
            class="group relative flex h-full cursor-pointer items-center pr-3 select-none"
            :class="[
              row.selected ? 'bg-solid-input text-title' : 'hover:bg-[#232d33] hover:text-title',
              !row.available && !row.loading && 'opacity-50',
              row.loading && 'opacity-70',
              dnd.mark.value?.id === row.id &&
                (dnd.mark.value.where === 'before'
                  ? 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-teal'
                  : 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-teal'),
            ]"
            :style="{ paddingLeft: `${10 + row.depth * 16}px` }"
            @click="
              store.select(row.id, {
                ctrl: $event.ctrlKey || $event.metaKey,
                shift: $event.shiftKey,
              })
            "
            @dblclick="store.openProperties(row.id)"
            @contextmenu.prevent="onContext(row)"
            @dragstart="dnd.start($event, row.id)"
            @dragover="dnd.over($event, row.id)"
            @drop="dnd.drop($event, row.id)"
            @dragend="dnd.end()"
          >
            <i
              v-if="row.kind === 'folder'"
              :class="row.collapsed ? 'fas fa-caret-right' : 'fas fa-caret-down'"
              class="absolute w-[10px] cursor-pointer text-[12px] text-icon hover:text-title"
              :style="{ left: `${6 + row.depth * 16}px` }"
              :title="row.collapsed ? 'Expand' : 'Collapse'"
              @click.stop="store.toggleCollapsed(row.id)"
            />
            <SourceIcon
              :type="row.type"
              :manager="row.manager"
              :open="!row.collapsed"
              class="w-[14px] shrink-0"
              :class="row.selected && 'text-title'"
            />
            <span
              class="mr-auto ml-2 min-w-0 flex-1 truncate"
              :class="!row.available && 'italic'"
              >{{ row.name }}</span
            >
            <template v-if="row.kind === 'item'">
              <i
                :class="[
                  row.locked
                    ? 'icon-lock opacity-70'
                    : 'icon-unlock opacity-0 group-hover:opacity-100',
                ]"
                class="ml-2 text-[14px]"
                :title="row.locked ? 'Unlock' : 'Lock'"
                data-testid="source-lock"
                @click.stop="store.toggleLocked(row.id)"
              />
              <i
                :class="[
                  row.visible
                    ? 'icon-view opacity-0 group-hover:opacity-100'
                    : 'icon-hide opacity-70',
                ]"
                class="ml-2 text-[14px]"
                :title="row.visible ? 'Hide' : 'Show'"
                data-testid="source-visible"
                @click.stop="store.toggleVisible(row.id)"
              />
            </template>
            <i
              class="icon-trash ml-2 text-[14px] opacity-0 group-hover:opacity-100"
              title="Remove Source."
              data-testid="source-remove"
              @click.stop="store.askRemove([row.id])"
            />
            <i
              v-if="row.kind === 'item'"
              class="icon-settings ml-2 text-[14px] opacity-0 group-hover:opacity-100"
              title="Source Properties"
              data-testid="source-properties"
              @click.stop="store.openProperties(row.id)"
            />
          </div>
        </template>
      </VirtualList>
      <p
        v-if="store.loaded && store.rows.length === 0"
        class="mt-6 text-center text-sm text-icon opacity-70"
      >
        {{ scenes.activeId ? 'This scene has no sources yet.' : 'No scene selected.' }}
      </p>
    </div>

    <ConfirmDialog
      :open="store.pendingRemove !== null"
      title="Remove source"
      :description="`Are you sure you want to remove ${removeText}?`"
      confirm-label="Remove"
      @confirm="store.confirmRemove()"
      @cancel="store.cancelRemove()"
    />
  </section>
</template>
