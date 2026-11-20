<script setup lang="ts">
import NameForm from '@/ui/dialog/NameForm.vue';
import { useDialog } from '@/ui/dialog/useDialog';
import { commands } from '@/ui/core';

const { state } = useDialog<'rename-source'>();

const submit = (name: string) => commands.sources.rename(state.value!.data.sourceId, name.trim());
</script>

<template>
  <NameForm
    v-if="state"
    :title="state.title"
    label="Please enter the name of the source"
    :initial="state.data.initialName"
    :submit="submit"
  />
</template>
