<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { t } from '@/ui/i18n';
import DialogLayout from './DialogLayout.vue';
import { closeDialogWindow } from './useDialog';

/**
 * Body of the legacy "Name Scene" / "Rename Source" / "Name Folder" windows: required text input,
 * Close / Done footer, Enter submits. `submit` may reject; the window then stays open.
 */
const props = defineProps<{
  title: string;
  label: string;
  initial: string;
  submit: (name: string) => Promise<unknown> | void;
}>();

const name = ref(props.initial);
const touched = ref(false);
const busy = ref(false);
const input = ref<HTMLInputElement | null>(null);
watch(
  () => props.initial,
  v => (name.value = v),
);
onMounted(() => void nextTick(() => input.value?.focus()));

const invalid = computed(() => touched.value && name.value.trim().length === 0);

async function done() {
  touched.value = true;
  if (!name.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await props.submit(name.value);
    closeDialogWindow();
  } catch (e) {
    console.error('[dialog] submit failed:', e instanceof Error ? e.message : e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <DialogLayout :title="title">
    <form class="m-0" @submit.prevent="done">
      <label class="mb-2 block text-[14px] text-para" for="dlg-name">
        <span class="mr-1 text-[12px]">*</span>{{ label }}
      </label>
      <input
        id="dlg-name"
        ref="input"
        v-model="name"
        data-testid="name-input"
        class="sl-input"
        :class="invalid && '!border-warn'"
        autocomplete="off"
        spellcheck="false"
        @input="touched = true"
      />
      <div v-if="invalid" class="mt-1 text-[14px] text-warn" data-testid="name-error">
        {{ t('This field is required') }}
      </div>
    </form>
    <template #footer>
      <button class="button-default" data-testid="name-cancel" @click="closeDialogWindow">
        {{ t('Close') }}
      </button>
      <button class="button-action" data-testid="name-ok" :disabled="busy" @click="done">
        {{ t('Done') }}
      </button>
    </template>
  </DialogLayout>
</template>
