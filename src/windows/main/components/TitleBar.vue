<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useCoreStore } from '@/ui/stores/core';

// legacy titlebar: 30 px, app icon, "Streamlabs Desktop - <version>", sync / minimize / maximize / close
const core = useCoreStore();
const logo = new URL('../../../../media/images/icon.ico', import.meta.url).href;
const title = computed(() => {
  const v = core.status?.versions.app;
  return v ? `Streamlabs Desktop - ${v}` : 'Streamlabs Desktop';
});

const maximized = ref(false);
let off: (() => void) | undefined;
onMounted(() => {
  const w = window.reborn?.window;
  if (!w) return;
  void w.isMaximized().then(v => (maximized.value = v));
  off = w.onMaximizedChange(v => (maximized.value = v));
});
onBeforeUnmount(() => off?.());

const win = () => window.reborn?.window;
const reload = () => window.location.reload();
</script>

<template>
  <div
    class="flex h-[30px] shrink-0 items-center bg-titlebar"
    data-testid="titlebar"
    data-name="title-bar"
  >
    <img class="box-border w-[32px] pl-4" :src="logo" alt="" draggable="false" />
    <div
      class="drag-region flex-1 truncate pl-[10px] text-icon select-none"
      @dblclick="win()?.maximize()"
    >
      {{ title }}
    </div>
    <div class="no-drag flex items-center">
      <i
        class="fas fa-sync mr-4 cursor-pointer text-[14px] text-icon transition-colors hover:text-title"
        title="Reload"
        @click="reload"
      />
      <i
        class="icon-subtract mr-4 cursor-pointer text-[14px] text-icon transition-colors hover:text-title"
        title="Minimize"
        data-testid="win-minimize"
        @click="win()?.minimize()"
      />
      <i
        :class="maximized ? 'far fa-window-restore' : 'icon-expand-1'"
        class="mr-4 cursor-pointer text-[14px] text-icon transition-colors hover:text-title"
        :title="maximized ? 'Restore' : 'Maximize'"
        data-testid="win-maximize"
        @click="win()?.maximize()"
      />
      <i
        class="icon-close mr-4 cursor-pointer text-[14px] text-icon transition-colors hover:text-title"
        title="Close"
        data-testid="win-close"
        @click="win()?.close()"
      />
    </div>
  </div>
</template>
