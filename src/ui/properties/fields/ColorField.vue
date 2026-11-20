<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import type { ColorProperty } from '@/shared/contracts';
import { alphaOf, hexToInt, intToHex, intToRgbHex } from '../color';
import type { FormLayout } from '../edits';

/** Legacy ObsColorInput: swatch (native picker), `#rrggbbaa` field and the eyedropper. */
const props = defineProps<{ p: ColorProperty; value: unknown; disabled: boolean }>();
const emit = defineEmits<{ input: [value: number]; change: [value: number] }>();

// legacy React form: swatch | hex | eyedropper button; Vue form: hex | eyedropper | swatch
const vertical = inject<FormLayout>('propLayout', 'horizontal') === 'vertical';
const current = computed(() => Number(props.value) >>> 0);
const hex = ref(intToHex(current.value));
watch(current, v => (hex.value = intToHex(v)));

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> };
}
const Eyedropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

function onText(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  hex.value = v;
  const n = hexToInt(v, alphaOf(current.value));
  if (n !== null) emit('input', n);
}
function onTextChange() {
  const n = hexToInt(hex.value, alphaOf(current.value));
  if (n !== null) emit('change', n);
  else hex.value = intToHex(current.value);
}
function onPicker(e: Event) {
  const n = hexToInt((e.target as HTMLInputElement).value, alphaOf(current.value));
  if (n !== null) emit('input', n);
}
async function pick() {
  if (!Eyedropper) return;
  try {
    const { sRGBHex } = await new Eyedropper().open();
    const n = hexToInt(sRGBHex, alphaOf(current.value));
    if (n !== null) emit('input', n);
  } catch {
    // dismissed with Escape
  }
}
</script>

<template>
  <div
    class="flex h-8 items-center overflow-hidden rounded-[4px] border border-solid border-button"
    :class="[disabled && 'opacity-50', vertical && 'flex-row']"
    :data-testid="`prop-${p.name}`"
  >
    <label
      class="relative block shrink-0 cursor-pointer"
      :class="vertical ? 'order-3 mx-2 h-5 w-5' : 'mx-2 h-[26px] w-[26px]'"
    >
      <span
        class="absolute inset-0 overflow-hidden rounded-[3px] border border-solid"
        :class="vertical ? 'border-title' : 'border-button'"
        data-testid="swatch"
      >
        <span
          class="absolute inset-0"
          :style="{ background: intToRgbHex(current), opacity: alphaOf(current) / 255 }"
        />
      </span>
      <input
        type="color"
        class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        :value="intToRgbHex(current)"
        :disabled="disabled"
        @input="onPicker"
      />
    </label>
    <input
      class="m-0 h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-para outline-none"
      :class="vertical ? 'order-1 pl-[11px]' : 'px-1'"
      :value="hex"
      :disabled="disabled"
      spellcheck="false"
      data-testid="color-hex"
      @input="onText"
      @change="onTextChange"
    />
    <button
      class="m-0 flex h-full shrink-0 cursor-pointer items-center justify-center border-0 text-para hover:text-title disabled:cursor-not-allowed"
      :class="vertical ? 'order-2 w-6 bg-transparent' : 'w-8 bg-button'"
      :disabled="disabled || !Eyedropper"
      title="Pick a color from the screen"
      data-testid="eyedropper"
      @click="pick"
    >
      <i class="fas fa-eye-dropper text-[12px]" />
    </button>
  </div>
</template>
