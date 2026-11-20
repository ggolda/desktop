<script setup lang="ts">
import NameForm from '@/ui/dialog/NameForm.vue';
import { useDialog } from '@/ui/dialog/useDialog';
import { commands } from '@/ui/core';

// legacy NameScene: create (made active), duplicate, rename
const { state } = useDialog<'name-scene'>();

async function submit(name: string) {
  const d = state.value;
  if (!d) return;
  if (d.data.mode === 'rename' && d.params.rename) {
    await commands.scenes.rename(d.params.rename, name.trim());
  } else {
    await commands.scenes.create(name.trim(), {
      makeActive: true,
      ...(d.params.duplicateFrom ? { duplicateFrom: d.params.duplicateFrom } : {}),
    });
  }
}
</script>

<template>
  <NameForm
    v-if="state"
    :title="state.title"
    label="Please enter the name of the scene"
    :initial="state.data.initialName"
    :submit="submit"
  />
</template>
