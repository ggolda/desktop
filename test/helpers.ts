import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { Contract } from '@/shared/contracts/types';
import type { ClientMessage, ServerMessage } from '@/shared/protocol';
import { createRuntime, type RuntimeOptions } from '@/core/runtime/runtime';
import type { Transport } from '@/core/runtime/transport';
import { createClient, type ClientOptions, type ClientTransport } from '@/ui/core/client';

export function coreTransport(port: MessagePort): Transport {
  return {
    post: m => port.postMessage(m),
    onMessage: cb => port.on('message', cb),
    onClose: cb => port.on('close', cb),
  };
}

export interface Wire {
  /** The window side as a raw port (for spying on / hand-crafting messages). */
  window: MessagePort;
  fromCore: ServerMessage[];
}

type Rt<C extends Contract> = ReturnType<typeof createRuntime<C>>;

/** Connects a runtime to a fresh MessageChannel and records what the window side receives. */
export function wire<C extends Contract>(rt: Rt<C>) {
  const { port1, port2 } = new MessageChannel();
  const conn = rt.attach(coreTransport(port1));
  const w: Wire = { window: port2, fromCore: [] };
  port2.on('message', (m: ServerMessage) => w.fromCore.push(m));
  port1.unref();
  port2.unref();
  return { wire: w, conn, corePort: port1 };
}

export function connectClient<C extends Contract>(
  rt: Rt<C>,
  opts: ClientOptions & { tap?: (m: ServerMessage) => boolean } = {},
) {
  const { port1, port2 } = new MessageChannel();
  rt.attach(coreTransport(port1));
  port1.unref();
  port2.unref();
  const sent: ClientMessage[] = [];
  const transport: ClientTransport = {
    post: m => {
      sent.push(m);
      port2.postMessage(m);
    },
    // `tap` can drop server messages (return false) to simulate loss
    onMessage: cb => port2.on('message', (m: ServerMessage) => (opts.tap?.(m) ?? true) && cb(m)),
    close: () => port2.close(),
  };
  const client = createClient<C>(transport, opts);
  return { client, sent, windowPort: port2, corePort: port1 };
}

export const runtimeOf = <C extends Contract>(o?: RuntimeOptions) => createRuntime<C>(o);

export const tick = () => new Promise<void>(r => setTimeout(r, 15));
