<script setup lang="ts">
import { computed } from 'vue';

/** Legacy icon classes by OBS source type (legacy/app/services/sources/sources-data.ts). */
const ICONS: Record<string, string> = {
  image_source: 'icon-image',
  color_source: 'fas fa-fill',
  browser_source: 'fas fa-globe',
  ffmpeg_source: 'far fa-file-video',
  slideshow: 'icon-image',
  text_gdiplus: 'fas fa-font',
  monitor_capture: 'fas fa-desktop',
  window_capture: 'icon-editor-9',
  game_capture: 'fas fa-gamepad',
  dshow_input: 'icon-webcam',
  ndi_source: 'fas fa-file',
  'decklink-input': 'fas fa-file',
  openvr_capture: 'fab fa-simplybuilt fa-rotate-180',
  screen_capture: 'icon-group',
  liv_capture: 'fab fa-simplybuilt fa-rotate-180',
  wasapi_input_capture: 'icon-mic',
  wasapi_output_capture: 'icon-audio',
  scene: 'far fa-object-group',
  vlc_source: 'fas fa-play',
  soundtrack_source: 'fas fa-file',
  mediasoupconnector: 'icon-team-2',
  spout_capture: 'icon-face-masks-3',
  smart_browser_source: 'icon-ai',
};

const props = defineProps<{
  type: string;
  open?: boolean;
  /** `propertiesManager` of the source: widgets and streamlabels have their own icons. */
  manager?: string;
}>();

const cls = computed(() => {
  if (props.type === 'folder') return props.open ? 'fas fa-folder-open' : 'fa fa-folder';
  if (props.manager === 'smartBrowserSource') return 'icon-ai';
  if (props.manager === 'streamlabels') return 'fas fa-file-alt';
  // The widget type is not part of the sources slice; Alert Box is by far the most common widget.
  if (props.manager === 'widget') return 'icon-alert-box';
  return ICONS[props.type] ?? 'fas fa-file';
});
</script>

<template>
  <i :class="cls" class="inline-block text-center text-[14px] leading-none" aria-hidden="true" />
</template>
