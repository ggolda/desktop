<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { parseMeterFrame } from '@/ui/audio/meters';
import { popupMenu, type MenuEntry } from '@/ui/composables/native-menu';
import { useElementVisible, useWindowActive } from '@/ui/composables/window-state';
import { useMeters } from '@/ui/core';
import { useAudioStore, type MixerRowData } from '@/ui/stores/audio';
import MixerRow from './MixerRow.vue';

const store = useAudioStore();
const root = ref<HTMLElement | null>(null);

// Meters are subscribed only while the mixer is on screen and the window is visible and focused.
const visible = useElementVisible(root);
const active = useWindowActive();
const metersOn = computed(() => visible.value && active.value && store.rows.length > 0);
const frame = useMeters(metersOn);

type RowHandle = InstanceType<typeof MixerRow>;
const rowRefs = new Map<string, RowHandle>();
const setRow = (id: string, el: unknown) => {
  if (el) rowRefs.set(id, el as RowHandle);
  else rowRefs.delete(id);
};

// Draw straight from the frame callback: core already limits the rate to <= 15 Hz, no rAF loop.
watch(
  frame,
  f => {
    if (!metersOn.value) return;
    const levels = parseMeterFrame(f, store.rev);
    if (!levels) return;
    for (const r of store.rows) {
      const peaks = levels[r.index];
      if (peaks) rowRefs.get(r.id)?.draw(peaks);
    }
  },
  { flush: 'sync' },
);
watch(metersOn, on => {
  if (!on) for (const r of rowRefs.values()) r.clear();
});

const dis = (labels: string[]): MenuEntry[] => labels.map(label => ({ label }));

// legacy mixer item cog menu (EditMenu with showAudioMixerMenu)
function rowMenu(row: MixerRowData) {
  void popupMenu([
    { label: 'Remove', accelerator: 'Delete' },
    { label: 'Rename', action: () => store.startRename(row.id) },
    { label: 'Filters', submenu: dis(['Edit Filters', 'Copy Filters', 'Paste Filters']) },
    { label: 'Properties', action: () => store.openProperties(row.id) },
    'separator',
    { label: 'Projector', submenu: dis(['Create Source Projector', 'Create Output Projector']) },
    { label: 'Performance Mode' },
    'separator',
    { label: 'Undo', accelerator: 'CommandOrControl+Z' },
    { label: 'Redo', accelerator: 'CommandOrControl+Y' },
    'separator',
    { label: 'Hide', action: () => store.setHidden(row.id, true) },
    { label: 'Unhide All', action: () => store.unhideAll() },
  ]);
}

// right click on the panel background
function panelMenu() {
  void popupMenu([{ label: 'Unhide All', action: () => store.unhideAll() }]);
}
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col" aria-label="Mixer">
    <div class="mb-2 flex shrink-0 items-center justify-end">
      <h2
        class="m-0 mr-auto text-[16px] leading-[25.1px] font-medium text-title"
        title="Monitor audio levels. If the bars are moving you are outputting audio."
      >
        Mixer
      </h2>
      <i
        class="icon-settings icon-button"
        title="Advanced Audio Settings (not available yet)"
        aria-label="Advanced audio settings"
        data-testid="mixer-advanced"
      />
    </div>
    <div
      ref="root"
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-[4px] bg-section [scrollbar-gutter:stable]"
      data-testid="mixer"
      :data-meters="metersOn"
      @contextmenu.self.prevent="panelMenu"
    >
      <MixerRow
        v-for="row in store.rows"
        :key="row.id"
        :ref="el => setRow(row.id, el)"
        :row="row"
        @mute="m => store.setMuted(row.id, m)"
        @fader="d => store.setDeflection(row.id, d)"
        @menu="rowMenu(row)"
      />
      <p v-if="store.rows.length === 0" class="mt-6 text-center text-sm text-icon opacity-70">
        No audio sources.
      </p>
    </div>
  </section>
</template>
