<script setup lang="ts">
import { ref } from 'vue';
import type { EditableListProperty } from '@/shared/contracts';
import { commands } from '@/ui/core';
import { t } from '@/ui/i18n';

/** Legacy ObsEditableListInput: items with replace / remove, Add Files / Add Directory (or a text entry). */
const props = defineProps<{ p: EditableListProperty; value: unknown; disabled: boolean }>();
const emit = defineEmits<{ edit: [value: string[]] }>();

const items = () => (Array.isArray(props.value) ? (props.value as string[]) : []);
const text = ref('');

const filters = () => props.p.filters.map(f => ({ name: f.name, extensions: [...f.extensions] }));
const base = (path: string) => path.split(/[\\/]/).pop() || path;

async function pick(mode: 'open-files' | 'open-dir' | 'open-file') {
  try {
    const res = await commands.dialogs.pickPath({
      mode,
      defaultPath: props.p.defaultPath || undefined,
      filters: mode === 'open-dir' ? undefined : filters(),
    });
    return res.canceled ? [] : res.paths;
  } catch (e) {
    console.error('[properties] pickPath failed:', e instanceof Error ? e.message : e);
    return [];
  }
}
async function add(mode: 'open-files' | 'open-dir') {
  const paths = await pick(mode);
  if (paths.length) emit('edit', [...items(), ...paths]);
}
async function replace(i: number) {
  const [path] = await pick('open-file');
  if (!path) return;
  const next = [...items()];
  next[i] = path;
  emit('edit', next);
}
function remove(i: number) {
  emit(
    'edit',
    items().filter((_, n) => n !== i),
  );
}
function addText() {
  const v = text.value.trim();
  if (!v) return;
  emit('edit', [...items(), v]);
  text.value = '';
}
</script>

<template>
  <div :data-testid="`prop-${p.name}`">
    <ul
      class="m-0 box-border max-h-[160px] min-h-[64px] list-none overflow-y-auto rounded-[4px] border border-solid border-button p-0"
      :class="disabled && 'opacity-50'"
    >
      <li
        v-for="(item, i) in items()"
        :key="`${i}:${item}`"
        class="group flex h-8 items-center px-3 hover:text-title"
        data-testid="list-item"
        :title="item"
      >
        <span class="min-w-0 flex-1 truncate">{{
          p.listType === 'strings' ? item : base(item)
        }}</span>
        <i
          v-if="p.listType !== 'strings'"
          class="fas fa-pen mr-3 cursor-pointer text-[12px] text-icon opacity-0 group-hover:opacity-100 hover:text-title"
          title="Replace"
          @click="!disabled && replace(i)"
        />
        <i
          class="icon-trash cursor-pointer text-[14px] text-icon opacity-0 group-hover:opacity-100 hover:text-title"
          title="Remove"
          data-testid="list-remove"
          @click="!disabled && remove(i)"
        />
      </li>
    </ul>
    <div class="mt-2 flex gap-2">
      <template v-if="p.listType === 'strings'">
        <input
          v-model="text"
          class="sl-input"
          type="text"
          :disabled="disabled"
          data-testid="list-text"
          @keydown.enter.prevent="addText"
        />
        <button class="button-default" :disabled="disabled" @click="addText">{{ t('Add') }}</button>
      </template>
      <template v-else>
        <button
          class="button-default"
          :disabled="disabled"
          data-testid="list-add-files"
          @click="add('open-files')"
        >
          {{ t('Add Files') }}
        </button>
        <button
          class="button-default"
          :disabled="disabled"
          data-testid="list-add-dir"
          @click="add('open-dir')"
        >
          {{ t('Add Directory') }}
        </button>
      </template>
    </div>
  </div>
</template>
