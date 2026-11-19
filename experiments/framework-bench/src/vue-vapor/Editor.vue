<script setup vapor>
import ScenesList from './ScenesList.vue';
import SourceRow from './SourceRow.vue';
import MixerRow from './MixerRow.vue';
import StatsFooter from './StatsFooter.vue';

defineProps({ state: Object });
const BTN = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
</script>

<template>
  <div class="flex flex-col h-screen bg-neutral-900 text-neutral-200 text-sm font-sans select-none">
    <header class="flex items-center gap-2 px-3 h-10 border-b border-neutral-800">
      <span class="font-semibold mr-auto">Studio</span>
      <button :class="BTN">Go Live</button>
      <button :class="BTN">Record</button>
      <button :class="BTN">Settings</button>
    </header>
    <div class="flex flex-1 min-h-0">
      <ScenesList :state="state" />
      <div class="flex-1 flex items-center justify-center bg-black">
        <div class="aspect-video w-4/5 bg-neutral-950 border border-neutral-800"></div>
      </div>
      <section class="w-72 flex flex-col border-l border-neutral-800">
        <div class="px-3 py-2 text-xs uppercase text-neutral-400">Sources</div>
        <ul class="flex-1 overflow-auto m-0 p-0 list-none">
          <SourceRow v-for="src in state.sources" :key="src.id" :source="src" />
        </ul>
      </section>
    </div>
    <section class="h-40 border-t border-neutral-800 px-3 py-2 flex flex-col gap-2">
      <div class="text-xs uppercase text-neutral-400">Mixer</div>
      <MixerRow v-for="m in state.mixer" :key="m.id" :item="m" />
    </section>
    <StatsFooter :stats="state.stats" />
  </div>
</template>
