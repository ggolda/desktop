<script setup lang="ts">
import { ref } from 'vue';

/**
 * Legacy resize bar (components-react/root/ResizeBar): a 10 px strip on the top edge of a cell, with a
 * 1 px border line and a 25x4 grip. Dragging up grows the cell below. Place inside a `relative` cell.
 */
const props = defineProps<{
  /** Current height of the cell under the bar (px). */
  value: number;
  min: number;
  max: number;
}>();
const emit = defineEmits<{ input: [value: number]; stop: [value: number] }>();

const active = ref(false);
let startY = 0;
let startValue = 0;
let last = 0;

const clamp = (v: number) => Math.max(props.min, Math.min(props.max, Math.round(v)));

function down(e: PointerEvent) {
  if (e.button !== 0) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  active.value = true;
  startY = e.clientY;
  startValue = props.value;
  last = props.value;
  e.preventDefault();
}
function move(e: PointerEvent) {
  if (!active.value) return;
  last = clamp(startValue + (startY - e.clientY));
  emit('input', last);
}
function up() {
  if (!active.value) return;
  active.value = false;
  emit('stop', last);
}
</script>

<template>
  <div
    class="group absolute top-[-8px] left-0 z-[5] box-border flex h-[10px] w-full cursor-row-resize flex-col items-center justify-center border-0 border-t border-solid border-line"
    :class="active && 'bg-[rgba(50,50,50,0.5)]'"
    role="separator"
    aria-orientation="horizontal"
    data-testid="resize-bar"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  >
    <div class="h-1 w-[25px] rounded-[2px] bg-para group-hover:bg-title" />
  </div>
</template>
