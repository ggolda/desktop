<script setup lang="ts">
import { computed } from 'vue';
import type { NumberProperty } from '@/shared/contracts';

/** Legacy slider with the number box (ObsSliderInput) or only the value label under the handle (`bare`). */
const props = defineProps<{
  p: Pick<NumberProperty, 'name' | 'min' | 'max' | 'step' | 'numberType'>;
  value: unknown;
  disabled: boolean;
  bare?: boolean;
}>();
const emit = defineEmits<{ input: [value: number]; invalid: [raw: string] }>();

const num = computed(() => Number(props.value) || 0);
const percent = computed(() => {
  const span = props.p.max - props.p.min;
  return span > 0 ? ((num.value - props.p.min) / span) * 100 : 0;
});
const isInt = computed(() => props.p.numberType !== 'float' && Number.isInteger(props.p.step));

function onRange(e: Event) {
  emit('input', Number((e.target as HTMLInputElement).value));
}
function onBox(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  const n = raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < props.p.min || n > props.p.max) emit('invalid', raw);
  else emit('input', isInt.value ? Math.round(n) : n);
}
</script>

<template>
  <div class="flex items-start gap-2">
    <div class="-mt-1 min-w-0 flex-1">
      <input
        type="range"
        class="sl-range"
        :min="p.min"
        :max="p.max"
        :step="p.step || 1"
        :value="num"
        :disabled="disabled"
        :data-testid="`prop-${p.name}`"
        @input="onRange"
      />
      <div class="relative mt-[4px] h-[22px] text-[14px] text-para">
        <span
          class="absolute top-0 -translate-x-1/2"
          :style="{ left: `calc(12px + (100% - 24px) * ${percent / 100})` }"
          data-testid="slider-value"
          >{{ num }}</span
        >
      </div>
    </div>
    <input
      v-if="!bare"
      class="sl-input !w-[50px] shrink-0 !px-2"
      type="text"
      inputmode="decimal"
      :value="num"
      :disabled="disabled"
      :data-testid="`prop-${p.name}-box`"
      @input="onBox"
    />
  </div>
</template>
