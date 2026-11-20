<script setup lang="ts">
import { computed, onMounted } from 'vue';
import type { FontProperty, FontValue } from '@/shared/contracts';
import { t } from '@/ui/i18n';
import FormRow from '../FormRow.vue';
import { fontFamilies, flagsForStyle, loadSystemFonts } from '../fonts';
import BoolField from './BoolField.vue';
import SliderField from './SliderField.vue';

/**
 * Legacy ObsFontInput: "Use Google Font", Font Family, Font Style and Font Size. Renders its own rows.
 * System families come from the Local Font Access API (see ../fonts.ts); Google fonts need a service
 * that does not exist yet, so that switch only reflects `custom_font` and can switch it off.
 */
const props = defineProps<{ p: FontProperty; value: unknown; disabled: boolean }>();
const emit = defineEmits<{ edit: [value: FontValue]; input: [value: FontValue] }>();

onMounted(() => void loadSystemFonts());

const font = computed(() => (props.value ?? {}) as FontValue);
const families = computed(() => {
  const set = new Set(fontFamilies.value.keys());
  if (font.value.face) set.add(font.value.face);
  return [...set].sort((a, b) => a.localeCompare(b));
});
const styles = computed(() => {
  const set = new Set((fontFamilies.value.get(font.value.face ?? '') ?? []).map(f => f.style));
  if (font.value.style) set.add(font.value.style);
  if (set.size === 0) set.add('Regular');
  return [...set];
});
const flagsOf = (face: string, style: string) =>
  fontFamilies.value.get(face)?.find(f => f.style === style)?.flags ?? flagsForStyle(style);

function setFamily(e: Event) {
  const face = (e.target as HTMLSelectElement).value;
  const list = (fontFamilies.value.get(face) ?? []).map(f => f.style);
  const style = list.includes('Regular') ? 'Regular' : (list[0] ?? 'Regular');
  emit('edit', { ...font.value, face, style, flags: flagsOf(face, style), path: '' });
}
function setStyle(e: Event) {
  const style = (e.target as HTMLSelectElement).value;
  emit('edit', { ...font.value, style, flags: flagsOf(font.value.face ?? '', style) });
}
function setSize(size: number) {
  emit('input', { ...font.value, size });
}
const usesGoogle = computed(() => !!font.value.path);
</script>

<template>
  <FormRow label="Use Google Font" :gap="13">
    <BoolField
      :p="{ ...p, kind: 'bool', description: '', value: usesGoogle }"
      :value="usesGoogle"
      :disabled="disabled || !usesGoogle"
      @edit="v => !v && emit('edit', { ...font, path: '' })"
    />
  </FormRow>
  <FormRow label="Font Family">
    <select
      class="sl-input sl-input--solid"
      :value="font.face"
      :disabled="disabled"
      data-testid="font-family"
      @change="setFamily"
    >
      <option v-for="f in families" :key="f" :value="f">{{ f }}</option>
    </select>
  </FormRow>
  <FormRow label="Font Style">
    <select
      class="sl-input sl-input--solid"
      :value="font.style"
      :disabled="disabled"
      data-testid="font-style"
      @change="setStyle"
    >
      <option v-for="s in styles" :key="s" :value="s">{{ t(s) }}</option>
    </select>
  </FormRow>
  <FormRow label="Font Size">
    <SliderField
      :p="{ name: `${p.name}-size`, min: 1, max: 256, step: 1, numberType: 'int' }"
      :value="font.size ?? 12"
      :disabled="disabled"
      bare
      @input="setSize"
    />
  </FormRow>
</template>
