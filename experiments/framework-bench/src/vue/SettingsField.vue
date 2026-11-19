<script setup>
defineProps({ field: Object });
const INPUT = 'bg-neutral-800 rounded px-2 py-1 w-80 text-neutral-200 border-0';
</script>

<template>
  <label class="flex flex-col gap-1">
    <span class="font-medium">{{ field.label }}</span>
    <select v-if="field.kind === 'select'" :class="INPUT" v-model="field.value">
      <option v-for="o in field.options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <input v-else-if="field.kind === 'checkbox'" type="checkbox" v-model="field.value" />
    <input v-else-if="field.kind === 'slider'" class="w-80" type="range" min="0" max="200" v-model.number="field.value" />
    <input v-else-if="field.kind === 'number'" :class="INPUT" type="number" v-model.number="field.value" />
    <input v-else :class="INPUT" type="text" v-model="field.value" />
    <span class="text-xs text-neutral-500">{{ field.description }}</span>
  </label>
</template>
