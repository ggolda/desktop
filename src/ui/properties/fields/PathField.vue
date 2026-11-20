<script setup lang="ts">
import type { PathProperty } from '@/shared/contracts';
import { commands } from '@/ui/core';
import { t } from '@/ui/i18n';

/** Legacy ObsPathInput: text input + Browse (native open / save / folder dialog parented to this window). */
const props = defineProps<{ p: PathProperty; value: unknown; disabled: boolean }>();
const emit = defineEmits<{ input: [value: string]; change: [value: string] }>();

async function browse() {
  const mode =
    props.p.kind === 'path-dir'
      ? 'open-dir'
      : props.p.kind === 'path-save'
        ? 'save-file'
        : 'open-file';
  try {
    const res = await commands.dialogs.pickPath({
      mode,
      defaultPath: String(props.value || props.p.defaultPath || '') || undefined,
      filters: props.p.filters.map(f => ({ name: f.name, extensions: [...f.extensions] })),
    });
    if (!res.canceled && res.paths[0]) emit('change', res.paths[0]);
  } catch (e) {
    console.error('[properties] pickPath failed:', e instanceof Error ? e.message : e);
  }
}
</script>

<template>
  <div class="flex" :data-testid="`prop-${p.name}`">
    <input
      class="sl-input !rounded-r-none"
      type="text"
      spellcheck="false"
      :value="String(value ?? '')"
      :disabled="disabled"
      data-testid="path-input"
      @input="emit('input', ($event.target as HTMLInputElement).value)"
      @change="emit('change', ($event.target as HTMLInputElement).value)"
    />
    <button
      class="m-0 h-8 shrink-0 cursor-pointer rounded-r-[4px] border-0 bg-button px-2 text-[14px] font-medium text-para hover:bg-button-hover hover:text-title disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="disabled"
      data-testid="path-browse"
      @click="browse"
    >
      {{ t('Browse') }}
    </button>
  </div>
</template>
