<script setup lang="ts">
import type { DeepReadonly } from 'vue';
import type { SourceTypeEntry } from '@/shared/contracts';

type Entry = DeepReadonly<SourceTypeEntry>;
import { t } from '@/ui/i18n';

// legacy SourceTag: icon + name, optional short description at 50 % opacity
defineProps<{ entry: Entry; active: boolean; hideShort?: boolean }>();
defineEmits<{ inspect: []; pick: [] }>();
</script>

<template>
  <div
    class="relative box-border flex min-h-[56px] min-w-0 cursor-pointer flex-col overflow-hidden rounded-[4px] px-2 py-[6px] select-none hover:text-title"
    :class="[
      active ? 'bg-button text-title' : 'bg-section-alt',
      entry.availability === 'disabled' && 'opacity-50',
    ]"
    data-testid="source-tile"
    :data-id="entry.id"
    :data-active="active || undefined"
    :title="entry.availability === 'disabled' ? entry.reason : undefined"
    @click="$emit('inspect')"
    @dblclick="$emit('pick')"
  >
    <span
      v-if="entry.badge"
      class="absolute top-1 right-1 rounded-[2px] bg-teal px-1 text-[10px] leading-[14px] font-medium text-[var(--action-button-text)]"
      >{{ t(entry.badge) }}</span
    >
    <div class="flex items-center">
      <i :class="entry.icon" class="mr-2 inline-block w-[14px] shrink-0 text-center text-[14px]" />
      <div class="truncate">{{ t(entry.name) }}</div>
    </div>
    <div v-if="entry.shortDescription && !hideShort" class="truncate opacity-50">
      {{ t(entry.shortDescription) }}
    </div>
  </div>
</template>
