<script setup>
const props = defineProps({ item: Object });
const BTN = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
const toggleMute = () => (props.item.muted = !props.item.muted);
</script>

<template>
  <div class="flex items-center gap-3">
    <span class="w-32 truncate">{{ item.name }}</span>
    <span class="w-14 text-right tabular-nums">{{ `${item.volumeDb.toFixed(1)} dB` }}</span>
    <div class="flex-1 flex flex-col gap-0.5">
      <div class="h-1.5 bg-neutral-800 rounded overflow-hidden">
        <div class="h-full bg-green-500" :style="{ width: `${item.peaks[0] * 100}%` }"></div>
      </div>
      <div class="h-1.5 bg-neutral-800 rounded overflow-hidden">
        <div class="h-full bg-green-500" :style="{ width: `${item.peaks[1] * 100}%` }"></div>
      </div>
    </div>
    <button :class="BTN" @click="toggleMute">{{ item.muted ? 'Unmute' : 'Mute' }}</button>
  </div>
</template>
