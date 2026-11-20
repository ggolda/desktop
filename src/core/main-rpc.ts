// Typed requests from core to the main process over the `rpc` / `rpc-result` messages
// (contracts/main-rpc.ts). Only Electron-only APIs go through here.
import type { MainRpcMethod, MainRpcMethods } from '../shared/contracts';
import type { CoreToMainMessage, MainToCoreMessage } from '../shared/protocol';

type RpcResult = Extract<MainToCoreMessage, { type: 'rpc-result' }>;

export interface MainRpc {
  call<M extends MainRpcMethod>(
    method: M,
    ...args: MainRpcMethods[M]['args']
  ): Promise<MainRpcMethods[M]['result']>;
  handleResult(msg: RpcResult): void;
}

const TIMEOUT_MS = 10_000;

export function createMainRpc(post: (msg: CoreToMainMessage) => void): MainRpc {
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (v: never) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  return {
    call(method, ...args) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        // the timer exists only while a request is in flight
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Object.assign(new Error(`main rpc timeout: ${method}`), { code: 'ETIMEDOUT' }));
        }, TIMEOUT_MS);
        pending.set(id, { resolve: resolve as (v: never) => void, reject, timer });
        post({ type: 'rpc', id, method, args });
      });
    },
    handleResult(msg) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.value as never);
      else p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
    },
  };
}
