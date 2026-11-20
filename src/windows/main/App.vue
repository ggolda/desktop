<script setup lang="ts">
import { useElementSize } from '@vueuse/core';
import { computed, onMounted, reactive, ref } from 'vue';
import { useCoreStore } from '@/ui/stores/core';
import MiniFeed from './components/MiniFeed.vue';
import MixerPanel from './components/MixerPanel.vue';
import NavBar from './components/NavBar.vue';
import PreviewArea from './components/PreviewArea.vue';
import ResizeBar from './components/ResizeBar.vue';
import ScenesPanel from './components/ScenesPanel.vue';
import SourcesPanel from './components/SourcesPanel.vue';
import StudioFooter from './components/StudioFooter.vue';
import TitleBar from './components/TitleBar.vue';

const core = useCoreStore();
onMounted(() => void core.connect());

// Legacy default editor layout: preview, Mini Feed (18 %) and the dock (27 %) of the rows area. The
// two resize bars change those fractions; they are UI-only state, kept in localStorage.
const KEY = 'sl.editor.layout';
const MIN = { feed: 90, dock: 110, preview: 120 };
const fractions = reactive({ feed: 0.18, dock: 0.27 });
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<typeof fractions> | null;
  if (saved && saved.feed! > 0 && saved.feed! < 1) fractions.feed = saved.feed!;
  if (saved && saved.dock! > 0 && saved.dock! < 1) fractions.dock = saved.dock!;
} catch {
  // no storage: defaults
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(fractions));
  } catch {
    // private window / blocked storage: layout just is not remembered
  }
}

const rows = ref<HTMLElement | null>(null);
const { height: rowsH } = useElementSize(rows);
const dockMax = computed(() => Math.max(MIN.dock, rowsH.value - MIN.feed - MIN.preview));
const dockH = computed(() =>
  Math.round(Math.max(MIN.dock, Math.min(dockMax.value, fractions.dock * rowsH.value))),
);
const feedMax = computed(() => Math.max(MIN.feed, rowsH.value - dockH.value - MIN.preview));
const feedH = computed(() =>
  Math.round(Math.max(MIN.feed, Math.min(feedMax.value, fractions.feed * rowsH.value))),
);
const setDock = (px: number) => (fractions.dock = px / rowsH.value);
const setFeed = (px: number) => (fractions.feed = px / rowsH.value);
</script>

<template>
  <div class="flex h-full w-full flex-col bg-bg3 text-para">
    <TitleBar />
    <NavBar active="editor" />
    <div class="flex min-h-0 flex-1 flex-col bg-bg3">
      <main ref="rows" class="flex min-h-0 flex-1 flex-col" data-testid="rows">
        <div class="box-border min-h-0 flex-1 px-2 py-4"><PreviewArea /></div>

        <div
          class="relative box-border shrink-0 px-2 pb-4"
          :style="{ height: `${feedH}px` }"
          data-testid="minifeed-cell"
        >
          <ResizeBar
            :value="feedH"
            :min="MIN.feed"
            :max="feedMax"
            @input="setFeed"
            @stop="persist"
          />
          <MiniFeed />
        </div>

        <div
          class="relative box-border grid shrink-0 grid-cols-3 grid-rows-[minmax(0,1fr)] px-2"
          :style="{ height: `${dockH}px` }"
          data-testid="dock"
        >
          <ResizeBar
            :value="dockH"
            :min="MIN.dock"
            :max="dockMax"
            @input="setDock"
            @stop="persist"
          />
          <div class="box-border h-full min-h-0 min-w-0 px-2 pb-4"><ScenesPanel /></div>
          <div class="box-border h-full min-h-0 min-w-0 px-2 pb-4"><SourcesPanel /></div>
          <div class="box-border h-full min-h-0 min-w-0 px-2 pb-4"><MixerPanel /></div>
        </div>
      </main>
      <StudioFooter />
    </div>
  </div>
</template>
