<script setup>
const props = defineProps({ state: Object });
const SCENE_CLS = 'px-3 py-1.5 cursor-pointer hover:bg-neutral-800';
const ACTIVE_CLS = ' bg-blue-600/30 text-white';
const select = id => (props.state.activeSceneId = id);
</script>

<template>
  <section class="w-56 flex flex-col border-r border-neutral-800">
    <div class="px-3 py-2 text-xs uppercase text-neutral-400">Scenes</div>
    <ul class="flex-1 overflow-auto m-0 p-0 list-none">
      <li
        v-for="sc in state.scenes"
        :key="sc.id"
        :class="sc.id === state.activeSceneId ? SCENE_CLS + ACTIVE_CLS : SCENE_CLS"
        @click="select(sc.id)"
      >{{ sc.name }}</li>
    </ul>
  </section>
</template>
