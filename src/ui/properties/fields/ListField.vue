<script setup lang="ts">
import { computed } from 'vue';
import type { ListProperty } from '@/shared/contracts';
import { t } from '@/ui/i18n';

/** Legacy ObsListInput: dropdown; values go back in the item's own type. Resolution lists accept `WxH`. */
const props = defineProps<{ p: ListProperty; value: unknown; disabled: boolean }>();
const emit = defineEmits<{ edit: [value: string | number]; invalid: [raw: string] }>();

const resolution = computed(() => props.p.name === 'resolution');
const index = computed(() => props.p.items.findIndex(i => i.value === props.value));
const label = (name: string) =>
  name === '' && props.p.items.length > 1 ? t('Select Option') : t(name);

function onSelect(e: Event) {
  const i = Number((e.target as HTMLSelectElement).value);
  const item = props.p.items[i];
  if (item) emit('edit', item.value);
}
function onResolution(e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (/^\d+x\d+$/i.test(raw)) emit('edit', raw);
  else emit('invalid', raw);
}
</script>

<template>
  <template v-if="resolution">
    <input
      class="sl-input"
      :list="`dl-${p.name}`"
      :value="String(value ?? '')"
      :disabled="disabled"
      :data-testid="`prop-${p.name}`"
      @change="onResolution"
    />
    <datalist :id="`dl-${p.name}`">
      <option v-for="i in p.items" :key="String(i.value)" :value="String(i.value)">
        {{ i.name }}
      </option>
    </datalist>
  </template>
  <select
    v-else
    class="sl-input sl-input--solid"
    :disabled="disabled"
    :value="index"
    :data-testid="`prop-${p.name}`"
    @change="onSelect"
  >
    <option v-if="index < 0" :value="-1" disabled hidden></option>
    <option v-for="(i, n) in p.items" :key="`${n}:${i.value}`" :value="n">
      {{ label(i.name) }}
    </option>
  </select>
</template>
