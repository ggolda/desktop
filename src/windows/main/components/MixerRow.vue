<script setup lang="ts">
import { useThrottleFn } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import VolumeMeter from '@/ui/components/VolumeMeter.vue';
import type { MixerRowData } from '@/ui/stores/audio';

const props = defineProps<{ row: MixerRowData }>();
const emit = defineEmits<{
  mute: [muted: boolean];
  fader: [deflection: number];
  menu: [];
}>();

const meter = useTemplateRef('meter');
defineExpose({
  draw: (peaks: readonly number[]) => meter.value?.draw(peaks),
  clear: () => meter.value?.clear(),
});

// While the thumb is held the slider shows its own value; core echoes the fader back through the slice.
const local = ref<number | null>(null);
let stopHold: (() => void) | undefined;
const shown = computed(() => local.value ?? props.row.deflection);
const sendFader = useThrottleFn((v: number) => emit('fader', v), 66, true, true);

function onInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  local.value = v;
  void sendFader(v);
}
function onDown() {
  stopHold?.();
  const up = () => {
    stopHold = undefined;
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (local.value !== null) emit('fader', local.value); // final value, not subject to the throttle
    local.value = null;
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  stopHold = up;
}
function onChange() {
  if (stopHold || local.value === null) return; // pointer drags finish in `up`
  emit('fader', local.value); // keyboard step
  local.value = null;
}
onBeforeUnmount(() => stopHold?.());
const dbText = computed(() =>
  props.row.deflection === 0 ? '-Inf dB' : `${props.row.db.toFixed(1)} dB`,
);
</script>

<template>
  <!-- legacy MixerItem: padding 8/16, name + dB, volmeter, slider (8 px margins) + 60 px controls -->
  <div class="-mr-2 px-4 py-2" :data-muted="row.muted || undefined" data-testid="mixer-row">
    <div class="flex">
      <div class="min-w-0 flex-1 truncate" data-testid="mixer-name">{{ row.name }}</div>
      <div class="w-[60px] text-right" data-testid="mixer-db">{{ dbText }}</div>
    </div>
    <div class="h-[10px] overflow-hidden"><VolumeMeter ref="meter" /></div>
    <div class="flex">
      <div class="w-full py-[18px]">
        <input
          type="range"
          class="sl-slider mx-[-1px] !w-[calc(100%+2px)]"
          :class="row.muted && 'opacity-40'"
          :style="{ '--p': shown * 100 }"
          min="0"
          max="1"
          step="0.01"
          :value="shown"
          :aria-label="`${row.name} volume`"
          data-testid="mixer-fader"
          @input="onInput"
          @change="onChange"
          @pointerdown="onDown"
        />
      </div>
      <div class="mt-2 flex h-[32px] flex-[0_0_60px] items-center justify-end">
        <i
          class="icon-button"
          :class="row.muted ? 'icon-mute !text-warn' : 'icon-audio'"
          :title="row.muted ? 'click to switch on' : 'click to switch off'"
          :aria-label="row.muted ? 'Unmute' : 'Mute'"
          data-testid="mixer-mute"
          @click="emit('mute', !row.muted)"
        />
        <i
          class="icon-button icon-settings"
          title="Audio source menu"
          aria-label="Audio settings"
          data-testid="mixer-menu"
          @click="emit('menu')"
        />
      </div>
    </div>
  </div>
</template>
