import { reactive, shallowRef } from 'vue';
import type { CommandProxy } from '../../shared/contracts/types';
import type { CoreContract } from '../../shared/contracts';
import { CORE_PORT_MESSAGE } from '../../shared/protocol';
import { createClient, type ClientTransport, type CoreClient } from './client';
import { createCoreComposables } from './composables';

export type { CoreClient, SliceHandle } from './client';
export { CoreCallError, createClient } from './client';
export { createCoreComposables } from './composables';

/** Asks the preload for this window's core MessagePort (it arrives via window.postMessage). */
function requestPort(): Promise<MessagePort> {
  return new Promise(resolve => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data !== CORE_PORT_MESSAGE || !e.ports[0]) return;
      window.removeEventListener('message', onMessage);
      resolve(e.ports[0]);
    };
    window.addEventListener('message', onMessage);
    window.reborn.connectCore();
  });
}

export function domTransport(port: MessagePort): ClientTransport {
  return {
    post: msg => port.postMessage(msg),
    onMessage: cb => {
      port.onmessage = e => cb(e.data);
      port.start();
    },
    close: () => port.close(),
  };
}

const clientRef = shallowRef<CoreClient<CoreContract>>();
let connecting: Promise<CoreClient<CoreContract>> | undefined;

/** Connects this window to core once; later calls return the same client. */
export function connect(): Promise<CoreClient<CoreContract>> {
  connecting ??= requestPort().then(port => {
    const client = createClient<CoreContract>(domTransport(port), { makeState: reactive });
    clientRef.value = client;
    return client;
  });
  return connecting;
}

/**
 * Uses an already created client instead of the preload port: the Vite-only fake page
 * (`windows/main/fake.html`) and component tests pass a client wired to `ui/dev/fake-core.ts`.
 */
export function setCoreClient(client: CoreClient<CoreContract>) {
  clientRef.value = client;
  connecting = Promise.resolve(client);
}

export const { useSlice, useEvent, useMeters } = createCoreComposables<CoreContract>(clientRef);

/** `commands.app.increment()`: typed command proxy that waits for the connection if needed. */
export const commands = new Proxy(
  {},
  {
    get: (_, target: string) =>
      new Proxy(
        {},
        {
          get:
            (_t, method: string) =>
            (...args: unknown[]) =>
              connect().then(c =>
                (c.call as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[
                  target
                ][method](...args),
              ),
        },
      ),
  },
) as CommandProxy<CoreContract>;
