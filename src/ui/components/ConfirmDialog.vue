<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui';
import { computed } from 'vue';
import { useOccluder } from '@/ui/overlay/occluders';

const props = withDefaults(
  defineProps<{ open: boolean; title: string; description?: string; confirmLabel?: string }>(),
  { description: '', confirmLabel: 'Delete' },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();

// Reka closes the dialog (update:open=false) around our click handler, in either order: decide about
// "cancel" after the click handler had its chance to confirm.
let confirmed = false;
function onConfirm() {
  confirmed = true;
  emit('confirm');
}
function onOpenChange(v: boolean) {
  if (v) return;
  queueMicrotask(() => {
    if (!confirmed) emit('cancel');
    confirmed = false;
  });
}

// A dialog covers the whole window, including the native preview.
useOccluder(computed(() => props.open));
</script>

<template>
  <AlertDialogRoot :open="open" @update:open="onOpenChange">
    <AlertDialogPortal>
      <AlertDialogOverlay class="fixed inset-0 z-50 bg-black/50" />
      <AlertDialogContent
        data-testid="confirm-dialog"
        class="fixed top-1/2 left-1/2 z-50 w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-[4px] bg-bg3 p-6 text-para shadow-lg outline-none"
      >
        <AlertDialogTitle class="m-0 text-base font-medium text-title">{{
          title
        }}</AlertDialogTitle>
        <AlertDialogDescription v-if="description" class="mt-2 text-sm text-para">
          {{ description }}
        </AlertDialogDescription>
        <div class="mt-6 flex justify-end gap-2">
          <AlertDialogCancel
            class="h-8 cursor-pointer rounded-[4px] border-0 bg-button px-4 text-sm font-medium text-para hover:bg-button-hover hover:text-title"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-ok"
            class="h-8 cursor-pointer rounded-[4px] border-0 bg-warn px-4 text-sm font-medium text-white hover:opacity-90"
            @click="onConfirm"
          >
            {{ confirmLabel }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
