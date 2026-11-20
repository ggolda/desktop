<script setup lang="ts">
import { computed } from 'vue';
import ConfirmDialog from '@/ui/components/ConfirmDialog.vue';
import VirtualList from '@/ui/components/VirtualList.vue';
import { popupMenu } from '@/ui/composables/native-menu';
import { useRowDnd } from '@/ui/composables/row-dnd';
import { useScenesStore } from '@/ui/stores/scenes';

const store = useScenesStore();

const dnd = useRowDnd({
  dragIds: id => [id],
  onDrop: ([id], target, where) => store.move(id, target, where),
});

// Menu items as in legacy (SceneSelector context menu). Not implemented yet: disabled.
function showMenu(id: string) {
  store.makeActive(id);
  void popupMenu([
    { label: 'Duplicate', action: () => store.duplicate(id) },
    { label: 'Rename', action: () => store.startRename(id) },
    { label: 'Remove', action: store.canRemove ? () => store.askRemove(id) : undefined },
    { label: 'Filters' },
    { label: 'Create Scene Projector' },
  ]);
}

const pendingName = computed(
  () => store.list.find(s => s.id === store.pendingRemoveId)?.name ?? 'this scene',
);
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col" aria-label="Scenes">
    <div class="mb-2 flex shrink-0 items-center" data-name="sceneSelector">
      <span
        class="mr-1 flex min-w-0 items-center text-[16px] leading-[25.1px] font-medium text-title"
        title="Scene Collections (not available yet)"
      >
        <svg
          class="mr-1 shrink-0 text-icon"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          aria-hidden="true"
        >
          <path d="M1.5 3.25 5 6.75l3.5-3.5" />
        </svg>
        <span class="truncate">Scenes</span>
      </span>
      <i
        class="icon-add-circle icon-button icon-button--lg mr-auto"
        title="Add a new Scene."
        data-testid="scene-add"
        @click="store.add()"
      />
      <i
        class="icon-transition icon-button icon-button--lg"
        title="Edit Scene Transitions. (not available yet)"
        aria-hidden="true"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-hidden rounded-[4px] bg-section">
      <VirtualList :items="store.list" :item-height="32" :key-of="s => s.id">
        <template #default="{ item: scene }">
          <div
            :data-row-id="scene.id"
            data-testid="scene-row"
            role="button"
            tabindex="0"
            draggable="true"
            class="group relative flex h-full cursor-pointer items-center pr-1 pl-4 select-none"
            :class="[
              scene.id === store.activeId
                ? 'bg-solid-input text-title'
                : 'hover:bg-[#232d33] hover:text-title',
              dnd.mark.value?.id === scene.id &&
                (dnd.mark.value.where === 'before'
                  ? 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-teal'
                  : 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-teal'),
            ]"
            :aria-current="scene.id === store.activeId ? 'true' : undefined"
            @click="store.makeActive(scene.id)"
            @keydown.enter="store.makeActive(scene.id)"
            @keydown.f2.prevent="store.startRename(scene.id)"
            @contextmenu.prevent="showMenu(scene.id)"
            @dragstart="dnd.start($event, scene.id)"
            @dragover="dnd.over($event, scene.id)"
            @drop="dnd.drop($event, scene.id)"
            @dragend="dnd.end()"
          >
            <span class="min-w-0 flex-1 truncate">{{ scene.name }}</span>
            <i
              class="icon-trash mr-2 text-[14px] text-title opacity-0 group-hover:opacity-100"
              title="Remove Scene."
              data-testid="scene-remove"
              @click.stop="store.canRemove && store.askRemove(scene.id)"
            />
          </div>
        </template>
      </VirtualList>
    </div>

    <ConfirmDialog
      :open="store.pendingRemoveId !== null"
      title="Remove scene"
      :description="`Are you sure you want to remove ${pendingName}? Its sources stay available.`"
      confirm-label="Remove"
      @confirm="store.confirmRemove()"
      @cancel="store.cancelRemove()"
    />
  </section>
</template>
