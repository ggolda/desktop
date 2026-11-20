<script setup lang="ts">
import { computed, inject } from 'vue';
import { t } from '@/ui/i18n';
import type { FormLayout } from './edits';

/**
 * One row of the form. horizontal = legacy React `ObsForm` (label column right aligned, 1/3 : 2/3),
 * vertical = legacy Vue `GenericForm` (label left, control right). `check` rows (checkboxes) carry no
 * label of their own and are tighter.
 */
const props = defineProps<{
  label?: string;
  tip?: string;
  /** Checkbox / button row: no label of its own, tighter spacing. */
  check?: boolean;
  /** Fixed bottom margin in px (legacy has a few rows with their own spacing). */
  gap?: number;
}>();
const layout = inject<FormLayout>('propLayout', 'horizontal');
// legacy spacing: form items 24 px apart (React) / 16 px (Vue); checkbox rows 8 px, 30 px pitch in Vue
const rowGap = computed(() =>
  props.gap !== undefined ? '' : props.check ? 'mb-2' : layout === 'horizontal' ? 'mb-6' : 'mb-4',
);
</script>

<template>
  <div
    class="grid"
    :class="[
      layout === 'horizontal' ? 'grid-cols-[184px_1fr]' : 'grid-cols-[170px_1fr]',
      rowGap,
      check && layout === 'horizontal' && 'min-h-8 items-center',
    ]"
    data-testid="prop-row"
    :style="gap !== undefined ? { marginBottom: `${gap}px` } : undefined"
  >
    <label
      class="min-w-0 pr-[10px] text-[14px]"
      :class="layout === 'horizontal' ? 'text-right leading-8' : 'text-left leading-[22px]'"
      :title="tip"
      >{{ label ? t(label) : '' }}</label
    >
    <div class="min-w-0"><slot /></div>
  </div>
</template>
