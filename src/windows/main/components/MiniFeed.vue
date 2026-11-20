<script setup lang="ts">
// Legacy "Mini Feed" (recent events panel). A future feature panel: static for now, same chrome and
// the empty state; the header controls are inert.
const controls = [
  { icon: 'icon-filter', title: 'Filter' },
  { icon: 'icon-pause', title: 'Pause' },
  { icon: 'icon-skip', title: 'Skip' },
  { icon: 'icon-notifications-off', title: 'Mute' },
  { icon: 'fa fa-volume-up', title: 'Volume' },
];
</script>

<template>
  <section
    class="box-border flex h-full min-h-0 flex-col px-2"
    aria-label="Mini Feed"
    data-testid="minifeed"
  >
    <div class="flex items-center justify-end pb-2">
      <h2 class="m-0 mr-auto text-[16px] leading-[25.1px] font-medium text-title">Mini Feed</h2>
      <i
        v-for="c in controls"
        :key="c.title"
        :class="c.icon"
        class="ml-4 text-[14px] text-icon"
        :title="`${c.title} (not available yet)`"
        aria-hidden="true"
      />
    </div>
    <div
      class="relative min-h-[40px] flex-1 overflow-hidden rounded-[4px] bg-section"
      data-testid="minifeed-events"
    >
      <div class="absolute inset-0 flex items-center justify-center opacity-50">
        There are no events to display
      </div>
    </div>
  </section>
</template>
