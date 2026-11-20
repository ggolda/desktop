<script setup lang="ts">
import { computed } from 'vue';
import type { InfoProperty } from '@/shared/contracts';
import { t } from '@/ui/i18n';

/** Legacy info text: framed read-only message with an icon by severity, links open outside. */
const props = defineProps<{ p: InfoProperty; value: unknown }>();

const text = computed(() => String(props.value || props.p.description || ''));
const hidden = computed(() => !text.value.trim() || text.value === 'Attempting to hook process...');
const icon = computed(
  () =>
    ({
      normal: 'fas fa-info-circle',
      warning: 'fas fa-exclamation-triangle',
      error: 'fas fa-times-circle',
    })[props.p.severity],
);
const color = computed(
  () =>
    ({ normal: 'var(--icon)', warning: 'var(--info)', error: 'var(--warning)' })[props.p.severity],
);

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ESC[c]);
// plain text with http(s) links: escaped first, only anchors are added
const html = computed(() =>
  esc(t(text.value)).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline text-title">$1</a>',
  ),
);
</script>

<template>
  <div
    v-if="!hidden"
    class="box-border flex gap-2 rounded-[4px] border border-solid px-3 py-2 text-[14px]"
    :style="{ borderColor: color }"
    :data-testid="`prop-${p.name}`"
    :data-severity="p.severity"
  >
    <i :class="icon" class="mt-[3px] shrink-0 text-[14px]" :style="{ color }" />
    <!-- eslint-disable-next-line vue/no-v-html -- text is escaped above, only anchors are added -->
    <span class="min-w-0 break-words" v-html="html" />
  </div>
</template>
