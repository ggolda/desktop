<script setup>
import { ref } from 'vue';
const props = defineProps({ initialName: String });
const name = ref(props.initialName);
const BTN = 'px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 border-0';
</script>

<template>
  <div class="h-screen flex items-center justify-center bg-neutral-900 text-neutral-200 text-sm font-sans">
    <div class="w-96 p-6 rounded-lg bg-neutral-800 flex flex-col gap-4">
      <h2 class="text-base font-semibold m-0">Rename Source</h2>
      <input class="bg-neutral-900 rounded px-2 py-1.5 text-neutral-200 border-0" v-model="name" />
      <div class="flex justify-end gap-2">
        <button :class="BTN">Cancel</button>
        <button :class="BTN + ' bg-blue-600 hover:bg-blue-500'">Done</button>
      </div>
    </div>
  </div>
</template>
