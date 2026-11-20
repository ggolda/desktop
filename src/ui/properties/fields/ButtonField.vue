<script setup lang="ts">
import type { ButtonProperty } from '@/shared/contracts';
import { t } from '@/ui/i18n';

defineProps<{ p: ButtonProperty; disabled: boolean }>();
defineEmits<{ press: [] }>();
</script>

<template>
  <button
    class="button-default"
    :disabled="disabled"
    :title="p.longDescription"
    :data-testid="`prop-${p.name}`"
    @click="$emit('press')"
  >
    {{ t(p.description) }}
  </button>
</template>
