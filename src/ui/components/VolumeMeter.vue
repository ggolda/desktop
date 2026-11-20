<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { MeterPainter } from '@/ui/audio/meters';

/**
 * One canvas for one mixer row. No data of its own: the mixer panel parses each meters frame once and
 * calls `draw(peaks)`. Repaints only when a level moved >= 2 px (see MeterPainter).
 */
const canvas = ref<HTMLCanvasElement | null>(null);
let painter: MeterPainter | undefined;
let ro: ResizeObserver | undefined;

function resize() {
  const c = canvas.value;
  if (c && painter) painter.resize(c.parentElement?.clientWidth ?? 0, window.devicePixelRatio);
}

onMounted(() => {
  const c = canvas.value;
  if (!c) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--section').trim();
  painter = new MeterPainter(c, bg || undefined);
  resize();
  ro = new ResizeObserver(resize);
  if (c.parentElement) ro.observe(c.parentElement);
});
onBeforeUnmount(() => ro?.disconnect());

defineExpose({
  draw: (peaks: readonly number[]) => painter?.draw(peaks) ?? false,
  clear: () => painter?.clear(),
  paints: () => painter?.paints ?? 0,
});
</script>

<template>
  <div class="w-full" :style="{ height: `${MeterPainter.heightFor(2)}px` }">
    <canvas ref="canvas" class="block" data-testid="meter-canvas" />
  </div>
</template>
