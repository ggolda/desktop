<script setup>
defineProps({ stats: Object });
const fmtTime = s =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
</script>

<template>
  <footer class="flex items-center gap-4 px-3 h-8 border-t border-neutral-800 text-xs text-neutral-400 tabular-nums">
    <span>{{ `CPU ${stats.cpu}%` }}</span>
    <span>{{ `FPS ${stats.fps}` }}</span>
    <span>{{ `Dropped ${stats.dropped}` }}</span>
    <span class="ml-auto">{{ fmtTime(stats.elapsed) }}</span>
  </footer>
</template>
