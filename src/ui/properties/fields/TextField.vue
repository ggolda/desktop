<script setup lang="ts">
import { inject } from 'vue';
import type { NumberProperty, TextProperty } from '@/shared/contracts';

/** text / password / multiline and the int / float number box (legacy ObsTextInput, ObsIntInput). */
const props = defineProps<{
  p: TextProperty | NumberProperty;
  value: unknown;
  disabled: boolean;
}>();
const emit = defineEmits<{
  input: [value: string | number];
  change: [value: string | number];
  invalid: [raw: string];
}>();

// the legacy Vue form's textarea is slightly shorter than the React one
const compact = inject<string>('propLayout', 'horizontal') === 'vertical';
const numeric = props.p.kind === 'int' || props.p.kind === 'float';

function parse(raw: string): number | undefined {
  if (!numeric) return undefined;
  const p = props.p as NumberProperty;
  const n = raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < p.min || n > p.max) return undefined;
  return p.kind === 'int' ? Math.round(n) : n;
}

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  if (!numeric) return emit('input', raw);
  const n = parse(raw);
  // out of range / not a number: kept in the field, never sent (legacy)
  if (n === undefined) emit('invalid', raw);
  else emit('input', n);
}
function onChange(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  if (!numeric) return emit('change', raw);
  const n = parse(raw);
  if (n !== undefined) emit('change', n);
}
</script>

<template>
  <textarea
    v-if="p.kind === 'multiline'"
    class="sl-input"
    :class="compact && '!py-[2px]'"
    rows="2"
    spellcheck="false"
    :value="String(value ?? '')"
    :disabled="disabled"
    :data-testid="`prop-${p.name}`"
    @input="onInput"
    @change="onChange"
  />
  <input
    v-else
    class="sl-input"
    :type="p.kind === 'password' ? 'password' : 'text'"
    :inputmode="numeric ? 'decimal' : undefined"
    autocomplete="off"
    spellcheck="false"
    :value="String(value ?? '')"
    :disabled="disabled"
    :data-testid="`prop-${p.name}`"
    @input="onInput"
    @change="onChange"
  />
</template>
