<script setup lang="ts" generic="T">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Fixed row height list. Renders everything up to `threshold` rows; above it only the visible window
 * (+ overscan). Scroll and size are tracked with a passive scroll listener and a ResizeObserver.
 */
const props = withDefaults(
  defineProps<{
    items: readonly T[];
    itemHeight: number;
    keyOf: (item: T) => string;
    threshold?: number;
    overscan?: number;
  }>(),
  { threshold: 100, overscan: 6 },
);

const root = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewport = ref(0);
let ro: ResizeObserver | undefined;

onMounted(() => {
  if (!root.value) return;
  viewport.value = root.value.clientHeight;
  ro = new ResizeObserver(() => (viewport.value = root.value?.clientHeight ?? 0));
  ro.observe(root.value);
});
onBeforeUnmount(() => ro?.disconnect());

const windowed = computed(() => props.items.length > props.threshold);
const range = computed(() => {
  if (!windowed.value) return { start: 0, end: props.items.length };
  const start = Math.max(0, Math.floor(scrollTop.value / props.itemHeight) - props.overscan);
  const end = Math.min(
    props.items.length,
    Math.ceil((scrollTop.value + viewport.value) / props.itemHeight) + props.overscan,
  );
  return { start, end };
});
const visible = computed(() =>
  props.items
    .slice(range.value.start, range.value.end)
    .map((item, i) => ({ item, index: range.value.start + i })),
);

function onScroll() {
  if (windowed.value && root.value) scrollTop.value = root.value.scrollTop;
}

defineExpose({
  /** Scrolls so that row `index` is visible. */
  scrollToIndex(index: number) {
    const el = root.value;
    if (!el) return;
    const top = index * props.itemHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + props.itemHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + props.itemHeight - el.clientHeight;
    }
  },
});
</script>

<template>
  <div
    ref="root"
    class="h-full overflow-y-auto overflow-x-hidden"
    data-testid="vlist"
    @scroll.passive="onScroll"
  >
    <div
      v-if="windowed"
      :style="{ height: `${items.length * itemHeight}px`, position: 'relative' }"
    >
      <div :style="{ transform: `translateY(${range.start * itemHeight}px)` }">
        <div v-for="v in visible" :key="keyOf(v.item)" :style="{ height: `${itemHeight}px` }">
          <slot :item="v.item" :index="v.index" />
        </div>
      </div>
    </div>
    <template v-else>
      <div v-for="(item, index) in items" :key="keyOf(item)" :style="{ height: `${itemHeight}px` }">
        <slot :item="item" :index="index" />
      </div>
    </template>
  </div>
</template>
