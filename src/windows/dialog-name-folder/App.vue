<script setup lang="ts">
import NameForm from '@/ui/dialog/NameForm.vue';
import { useDialog } from '@/ui/dialog/useDialog';
import { commands } from '@/ui/core';

const { state } = useDialog<'name-folder'>();

async function submit(name: string) {
  const d = state.value;
  if (!d) return;
  if (d.params.renameId) {
    await commands.sceneItems.renameFolder(d.params.sceneId, d.params.renameId, name.trim());
  } else {
    await commands.sceneItems.createFolder(
      d.params.sceneId,
      name.trim(),
      d.params.nodeIds ? [...d.params.nodeIds] : undefined,
    );
  }
}
</script>

<template>
  <NameForm
    v-if="state"
    :title="state.title"
    label="Please enter the name of the folder"
    :initial="state.data.initialName"
    :submit="submit"
  />
</template>
