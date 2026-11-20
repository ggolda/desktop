<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { commands } from '@/ui/core';
import DialogLayout from '@/ui/dialog/DialogLayout.vue';
import SourcePreview from '@/ui/dialog/SourcePreview.vue';
import { closeDialogWindow, useDialog } from '@/ui/dialog/useDialog';
import { t } from '@/ui/i18n';

// legacy AddSource: "Add Existing Source" (list + 200x200 preview) or "Add New Source" (name)
const { id, state } = useDialog<'add-source'>();

const name = ref('');
const useNew = ref(false); // "Add a new source instead"
const selectedId = ref('');
const error = ref('');
const busy = ref(false);
const input = ref<HTMLInputElement | null>(null);

watch(
  state,
  s => {
    if (!s) return;
    if (!name.value) name.value = s.data.suggestedName;
    if (!selectedId.value) selectedId.value = s.data.existing[0]?.id ?? '';
  },
  { immediate: true },
);

const existing = computed(() => state.value?.data.existing ?? []);
const isScene = computed(() => state.value?.data.entry.sourceType === 'scene');
const canCreateNew = computed(() => existing.value.length > 0 && !isScene.value);
const isNew = computed(() => !isScene.value && (useNew.value || existing.value.length === 0));

watch(isNew, v => {
  if (v) void nextTick(() => input.value?.focus());
});
// the input exists once the dialog data has arrived (and again after the "new source" toggle)
watch(input, el => el?.focus());

// an empty name rejects with ENAME; the scene cycle error is a native error box shown by main
const messages: Record<string, string> = { ENAME: 'This field is required' };

async function submit() {
  if (busy.value) return;
  error.value = '';
  if (isNew.value) {
    if (!name.value.trim()) {
      error.value = t(messages.ENAME);
      return;
    }
  } else if (!selectedId.value) {
    return;
  }
  busy.value = true;
  try {
    // core creates the source and replaces this dialog by Source Properties, or closes it
    await commands.dialogs.submitAddSource(
      id,
      isNew.value
        ? { mode: 'new', name: name.value.trim() }
        : { mode: 'existing', sourceId: selectedId.value },
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    error.value = t(messages[code ?? ''] ?? (e instanceof Error ? e.message : 'Error'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <DialogLayout v-if="state" :title="state.title">
    <div class="flex" data-testid="add-source">
      <template v-if="!isNew">
        <div>
          <h4 class="mt-0 mb-[0.5em] text-[14px] leading-[22px] font-bold text-title">
            {{ t('Add Existing Source') }}
          </h4>
          <ul
            class="m-0 mr-6 box-border h-[170px] w-[270px] list-none overflow-y-auto bg-section p-0"
            role="listbox"
            data-testid="existing-list"
          >
            <li
              v-for="s in existing"
              :key="s.id"
              class="sl-menu-item"
              role="option"
              :aria-selected="s.id === selectedId"
              :data-id="s.id"
              @click="selectedId = s.id"
              @dblclick="submit"
            >
              {{ s.name }}
            </li>
          </ul>
        </div>
        <div v-if="selectedId" class="h-[200px] w-[200px] shrink-0">
          <SourcePreview :key="selectedId" :source-id="selectedId" />
        </div>
      </template>
      <form v-else class="m-0 -mt-[18px] w-full" @submit.prevent="submit">
        <h4 class="mt-0 mb-[13px] text-[14px] leading-[22px] font-bold text-title">
          {{ t('Add New Source') }}
        </h4>
        <label class="mb-3 block text-[14px] text-para" for="dlg-source-name">
          <span class="mr-1 text-[12px]">*</span>{{ t('Please enter the name of the source') }}
        </label>
        <input
          id="dlg-source-name"
          ref="input"
          v-model="name"
          data-testid="name-input"
          class="sl-input !w-[76%]"
          autocomplete="off"
          spellcheck="false"
        />
      </form>
    </div>
    <div v-if="error" class="mt-2 text-[14px] text-warn" data-testid="add-error">{{ error }}</div>

    <template #footer>
      <label
        v-if="canCreateNew"
        class="mr-auto flex cursor-pointer items-center gap-2 text-[14px]"
        data-testid="new-instead"
      >
        <span>{{ t('Add a new source instead') }}</span>
        <button
          type="button"
          role="switch"
          class="sl-toggle"
          :aria-checked="useNew"
          @click="useNew = !useNew"
        />
      </label>
      <button class="button-default" data-testid="add-cancel" @click="closeDialogWindow">
        {{ t('Cancel') }}
      </button>
      <button class="button-action" data-testid="add-submit" :disabled="busy" @click="submit">
        {{ t('Add Source') }}
      </button>
    </template>
  </DialogLayout>
</template>
