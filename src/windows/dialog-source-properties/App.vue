<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import type { Property } from '@/shared/contracts';
import { useSlice } from '@/ui/core';
import DialogLayout from '@/ui/dialog/DialogLayout.vue';
import SourcePreview from '@/ui/dialog/SourcePreview.vue';
import { closeDialogWindow, useDialog } from '@/ui/dialog/useDialog';
import { t } from '@/ui/i18n';
import PropertyForm from '@/ui/properties/PropertyForm.vue';

// legacy SourceProperties (React, "Close") / SourcePropertiesDeprecated (Vue, "Cancel" + "Done"):
// preview area, live form; every footer button only closes (edits are applied as they are made)
const { id, state } = useDialog<'source-properties'>();
const props = useSlice(() => (id ? (`properties:${id}` as const) : undefined));
// the title is built here from the type name (core-opened dialogs carry an English `state.title`)
const title = computed(() =>
  state.value ? t('Settings for %{sourceName}', { sourceName: t(state.value.data.typeName) }) : '',
);
watchEffect(() => {
  if (title.value) document.title = title.value;
});
const form = ref<InstanceType<typeof PropertyForm> | null>(null);

function close() {
  form.value?.flush();
  closeDialogWindow();
}
</script>

<template>
  <DialogLayout
    v-if="state"
    :title="title"
    :padded="false"
    :footer-height="state.data.chrome === 'close' ? 53 : 48"
  >
    <template #fixed>
      <SourcePreview :source-id="state.data.sourceId" />
    </template>
    <div
      class="box-border"
      :class="state.data.chrome === 'close' ? 'py-6 pr-[18px] pl-6' : 'py-4 pr-[10px] pl-4'"
      data-testid="properties-body"
    >
      <PropertyForm
        v-if="props"
        ref="form"
        :source-id="state.data.sourceId"
        :items="props.items as readonly Property[]"
        :layout="state.data.chrome === 'close' ? 'horizontal' : 'vertical'"
      />
    </div>
    <template #footer>
      <template v-if="state.data.chrome === 'close'">
        <button class="button-default" data-testid="props-close" @click="close">
          {{ t('Close') }}
        </button>
      </template>
      <template v-else>
        <button class="button-default" data-testid="props-cancel" @click="close">
          {{ t('Cancel') }}
        </button>
        <button class="button-action" data-testid="props-done" @click="close">
          {{ t('Done') }}
        </button>
      </template>
    </template>
  </DialogLayout>
</template>
