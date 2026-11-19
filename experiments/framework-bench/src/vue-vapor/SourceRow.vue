<script setup vapor>
import { ICONS } from '../../shared/icons.js';
const props = defineProps({ source: Object });
const toggleVisible = () => (props.source.visible = !props.source.visible);
const toggleLocked = () => (props.source.locked = !props.source.locked);
</script>

<template>
  <li class="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
    <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0 fill-current"><path :d="ICONS[source.type]" /></svg>
    <span class="flex-1 truncate">{{ source.name }}</span>
    <button class="w-10 text-xs text-neutral-400" @click="toggleVisible">{{ source.visible ? 'on' : 'off' }}</button>
    <button class="w-12 text-xs text-neutral-400" @click="toggleLocked">{{ source.locked ? 'locked' : 'free' }}</button>
  </li>
</template>
