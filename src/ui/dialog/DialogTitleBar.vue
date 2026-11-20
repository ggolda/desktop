<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

// legacy child window TitleBar: 30 px, app icon, title, refresh (reloads the page), minimize, maximize, close
defineProps<{ title: string }>();
const logo = new URL('../../../media/images/icon.ico', import.meta.url).href;

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
const close = () => (win() ? win()!.close() : window.close());
</script>

<template>
  <div class="flex h-[30px] shrink-0 items-center bg-titlebar" data-testid="dialog-titlebar">
    <img class="box-border w-[32px] pl-4" :src="logo" alt="" draggable="false" />
    <div
      class="drag-region flex-1 truncate pl-[10px] text-icon select-none"
      data-testid="dialog-title"
      @dblclick="win()?.maximize()"
    >
      {{ title }}
    </div>
    <div class="no-drag flex items-center">
      <i
        class="fas fa-sync mr-4 cursor-pointer text-[14px] text-icon transition-colors hover:text-title"
        title="Reload"
        data-testid="dialog-reload"
        @click="reload"
      />
      <i
        class="icon-subtract mr-4 cursor-pointer text-[14px] text-icon transition-colors hover:text-title"
        title="Minimize"
        @click="win()?.minimize()"
      />
      <i
        :class="maximized ? 'far fa-window-restore' : 'icon-expand-1'"
        class="mr-4 cursor-pointer text-[14px] text-icon transition-colors hover:text-title"
        :title="maximized ? 'Restore' : 'Maximize'"
        @click="win()?.maximize()"
      />
      <i
        class="icon-close mr-4 cursor-pointer text-[14px] text-icon transition-colors hover:text-title"
        title="Close"
        data-testid="dialog-close-x"
        @click="close"
      />
    </div>
  </div>
</template>
