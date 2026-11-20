<script setup lang="ts">
import { computed } from 'vue';
import { useCoreStore } from '@/ui/stores/core';

const core = useCoreStore();

const obsLabel = computed(() => {
  const s = core.status;
  if (!core.connected || !s) return 'connecting…';
  if (s.obsInit === 'pending') return 'initializing…';
  if (s.obsInit === 'ok') return `ok (${s.initMs} ms)`;
  return `error: ${s.error ?? s.code}`;
});

// Diagnostics (ping / OBS status) are shown only in dev builds or with `?dev`; the elements always
// exist because src/main/smoke.ts drives them.
const showDev = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
</script>

<template>
  <!-- legacy StudioFooter: 48 px, performance icon + notifications on the left, REC / replay / Go Live right -->
  <footer
    class="box-border flex h-12 shrink-0 items-center justify-between overflow-hidden bg-section px-4 py-2"
    data-testid="footer"
  >
    <div class="flex min-w-0 flex-1 items-center">
      <i
        class="icon-leaderboard-4 cursor-pointer pr-3 text-[14px] text-para hover:text-title"
        title="Open Performance Window (not available yet)"
        data-testid="perf-icon"
      />
      <span class="mr-[14px] ml-[9px] h-[14px] w-px bg-button" aria-hidden="true" />
      <i
        class="icon-notifications cursor-pointer text-[14px] text-para hover:text-title"
        title="Notifications (not available yet)"
        data-testid="notifications"
      />

      <!-- Dev/diagnostics item. Selectors are used by src/main/smoke.ts: do not rename. -->
      <div
        class="ml-8 min-w-0 items-center gap-3 text-xs text-icon"
        :class="showDev ? 'flex' : 'hidden'"
        data-testid="dev-status"
      >
        <span class="truncate">
          v<span data-testid="app-version">{{ core.status?.versions.app ?? '…' }}</span>
          · OBS
          <span data-testid="obs-status" :class="core.status?.obsInit === 'error' && 'text-warn'">{{
            obsLabel
          }}</span>
        </span>
        <button
          data-testid="ping-btn"
          class="h-6 cursor-pointer rounded-[4px] border-0 bg-button px-2 text-xs text-para hover:bg-button-hover"
          :disabled="!core.connected"
          @click="core.ping()"
        >
          Ping core
        </button>
        <span data-testid="ping-ms" class="min-w-16" :data-ms="core.lastPingMs ?? undefined">
          {{ core.lastPingMs === null ? '—' : `${core.lastPingMs} ms` }}
        </span>
      </div>
    </div>

    <div class="flex items-center">
      <button
        class="circle-button ml-4 !text-[10px] !text-warn"
        title="Start Recording (not available yet)"
        data-testid="record-btn"
      >
        REC
      </button>
      <button
        class="circle-button ml-4"
        title="Start Replay Buffer (not available yet)"
        data-testid="replay-btn"
      >
        <i class="icon-replay-buffer text-[14px]" />
      </button>
      <button
        class="button-action ml-4 w-[130px]"
        title="Go Live (not available yet)"
        data-testid="golive-btn"
      >
        Go Live
      </button>
    </div>
  </footer>
</template>
