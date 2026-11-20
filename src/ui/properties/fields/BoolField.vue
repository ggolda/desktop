<script setup lang="ts">
import { inject } from 'vue';
import type { BoolProperty } from '@/shared/contracts';
import { t } from '@/ui/i18n';

/** Legacy checkbox; the label sits next to the box (both layouts), bright when checked. */
defineProps<{ p: BoolProperty; value: unknown; disabled: boolean }>();
const plain = inject<string>('propLayout', 'horizontal') === 'horizontal';
defineEmits<{ edit: [value: boolean] }>();
</script>

<template>
  <label
    class="sl-check"
    :class="[value && 'sl-check--on', plain && 'sl-check--plain', disabled && 'cursor-not-allowed']"
    :title="p.longDescription"
  >
    <input
      type="checkbox"
      :checked="!!value"
      :disabled="disabled"
      :data-testid="`prop-${p.name}`"
      @change="$emit('edit', ($event.target as HTMLInputElement).checked)"
    />
    <span>{{ t(p.description) }}</span>
  </label>
</template>
