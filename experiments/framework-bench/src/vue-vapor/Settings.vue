<script setup vapor>
import { ref } from 'vue';
import SettingsField from './SettingsField.vue';

defineProps({ categories: Array });
const active = ref(0);
const NAV_CLS = 'block w-full text-left px-4 py-1.5 bg-transparent text-neutral-200 border-0 hover:bg-neutral-800';
</script>

<template>
  <div class="flex h-screen bg-neutral-900 text-neutral-200 text-sm font-sans">
    <nav class="w-48 border-r border-neutral-800 py-2">
      <button
        v-for="(cat, i) in categories"
        :key="cat.id"
        :class="i === active ? NAV_CLS + ' bg-neutral-800' : NAV_CLS"
        @click="active = i"
      >{{ cat.name }}</button>
    </nav>
    <main class="flex-1 overflow-auto p-6">
      <h1 class="text-lg font-semibold mb-4 mt-0">{{ categories[active].name }}</h1>
      <div class="flex flex-col gap-4">
        <SettingsField v-for="f in categories[active].fields" :key="f.id" :field="f" />
      </div>
    </main>
  </div>
</template>
