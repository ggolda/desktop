import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CoreStatus } from '@/shared/protocol';
import { connect, type CoreClient } from '@/ui/core';
import type { CoreContract } from '@/shared/contracts';

/** Window-local view of the core connection. Core stays the source of truth. */
export const useCoreStore = defineStore('core', () => {
  const connected = ref(false);
  const status = ref<CoreStatus | null>(null);
  const lastPingMs = ref<number | null>(null);

  let client: CoreClient<CoreContract> | null = null;

  async function connectToCore() {
    client = await connect();
    client.onStatus(s => (status.value = s));
    connected.value = true;
  }

  async function ping() {
    if (!client) return;
    lastPingMs.value = +(await client.ping()).toFixed(2);
  }

  return { connected, status, lastPingMs, connect: connectToCore, ping };
});
