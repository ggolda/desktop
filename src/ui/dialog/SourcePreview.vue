<script setup lang="ts">
import { useObsDisplay } from '@/ui/display/useObsDisplay';
import { useResizeOcclusion } from './resize-occlusion';

/**
 * Legacy `<Display sourceId>`: a native OBS display bound to one source. The element is only the
 * placeholder (the native window draws over it); the background is the display's own colour.
 * Remount with `:key="sourceId"` to show another source.
 */
const props = defineProps<{ sourceId: string }>();
const { el } = useObsDisplay('horizontal', { sourceId: props.sourceId, drawUi: false });
useResizeOcclusion();
</script>

<template>
  <div ref="el" class="h-full w-full bg-[#3d5560]" data-testid="source-preview" />
</template>
