<script setup lang="ts">
import { onMounted } from 'vue';
import DialogTitleBar from './DialogTitleBar.vue';
import { signalDialogReady } from './ready';

// Pages mount this layout only once their data is there (`v-if="state"`): the first complete render.
// The window is hidden until `signalDialogReady` tells main it can be shown (ready.ts).
onMounted(() => void signalDialogReady());

/**
 * Legacy `ModalLayout` in a child window: title bar, optional fixed 200 px section (source preview),
 * scrollable body, 53 px footer with right aligned buttons.
 */
withDefaults(
  defineProps<{ title: string; padded?: boolean; scroll?: boolean; footerHeight?: number }>(),
  { padded: true, scroll: true, footerHeight: 53 },
);
</script>

<template>
  <div class="flex h-full w-full flex-col bg-bg3 text-para" data-testid="dialog">
    <DialogTitleBar :title="title" />
    <div v-if="$slots.fixed" class="h-[200px] shrink-0 bg-section" data-testid="dialog-fixed">
      <slot name="fixed" />
    </div>
    <div
      class="min-h-0 flex-1"
      :class="[scroll ? 'dlg-scroll overflow-y-auto' : 'overflow-hidden', padded && 'dlg-body']"
      data-testid="dialog-body"
    >
      <slot />
    </div>
    <div
      class="relative box-border flex shrink-0 items-center justify-end gap-[8px] border-t border-solid border-line bg-section px-4"
      data-testid="dialog-footer"
      :class="footerHeight < 53 && 'dlg-footer--sm'"
      :style="{ height: footerHeight + 'px' }"
    >
      <slot name="footer" />
    </div>
  </div>
</template>
