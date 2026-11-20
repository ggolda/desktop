<script setup lang="ts">
import { computed, ref } from 'vue';
import { useEditorOverlay } from '@/ui/editor/useEditorOverlay';
import { useObsDisplay } from '@/ui/display/useObsDisplay';
import { useEditMenu } from '../composables/edit-menu';

const wrap = ref<HTMLElement | null>(null);
// `el` is bound by name to the placeholder below. The wrapper is watched too: layout changes around
// the preview (dock, nav) can move the placeholder without resizing it. Legacy StudioEditor passes
// paddingSize 10.
const { el, state } = useObsDisplay('horizontal', {
  watch: () => [wrap.value],
  paddingSize: 10,
});

const menu = useEditMenu();
const editor = useEditorOverlay({
  canvas: 'horizontal',
  region: () => state.value?.outputRegion,
  onMenu: ids => void menu.popupForIds(ids),
});

const label = computed(() => {
  const s = state.value;
  if (!s || s.status === 'pending') return 'Starting preview…';
  if (s.status === 'error') return `Preview error${s.error ? `: ${s.error}` : ''}`;
  return '';
});
</script>

<template>
  <!-- legacy: the display container fills the cell (cell padding 16/8), background --section -->
  <div ref="wrap" class="relative h-full min-h-0 overflow-hidden bg-section" data-testid="preview">
    <!-- The native OBS display is a child window drawn over this placeholder (display protocol). -->
    <div ref="el" class="absolute inset-0 bg-section" data-testid="obs-display" />
    <div
      v-if="label"
      class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-para"
    >
      {{ label }}
    </div>
    <!-- Editor overlay: the native display is mouse-transparent, this div gets the pointer events
         (selection, drag, resize, crop, cursors, context menu). -->
    <div
      :ref="(e: unknown) => (editor.el.value = e as HTMLElement | null)"
      class="absolute inset-0 touch-none select-none"
      :style="{ cursor: editor.cursor.value }"
      data-testid="preview-overlay"
      @pointerdown="editor.handlers.onPointerdown"
      @pointermove="editor.handlers.onPointermove"
      @pointerup="editor.handlers.onPointerup"
      @pointercancel="editor.handlers.onPointercancel"
      @dblclick="editor.handlers.onDblclick"
      @contextmenu="editor.handlers.onContextmenu"
    />
  </div>
</template>
