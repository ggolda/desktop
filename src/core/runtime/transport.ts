import type { MessagePortMain } from 'electron';
import type { ClientMessage, ServerMessage } from '../../shared/protocol';

/** What the runtime needs from one window connection. */
export interface Transport {
  post(msg: ServerMessage): void;
  onMessage(cb: (msg: ClientMessage) => void): void;
  onClose(cb: () => void): void;
}

/** Adapter for the MessagePortMain of an Electron utilityProcess. Starts the port. */
export function electronTransport(port: MessagePortMain): Transport {
  return {
    post: msg => port.postMessage(msg),
    onMessage: cb => {
      port.on('message', e => cb(e.data as ClientMessage));
      port.start();
    },
    onClose: cb => port.on('close', cb),
  };
}
