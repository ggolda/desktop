// Messages on a window <-> core MessagePort (structured-clone objects). No Node, no DOM types here.
// Skeleton subset of SPEC 3.1: status push + ping. call/sub/patch/event arrive in later steps.

export interface CoreStatus {
  obsInit: 'pending' | 'ok' | 'error';
  /** obs-studio-node initAPI return code (0 = success), or -1 when it threw. */
  code: number | null;
  /** Duration of OBS initialization inside core. */
  initMs: number | null;
  error?: string;
  versions: { app: string; electron: string; node: string; chrome: string };
}

/** A JSON path: object keys and array indices from the slice root. */
export type PatchPath = (string | number)[];

/**
 * Compact patch ops (SPEC 3.1), applied in order by `applyOps` (src/shared/patch.ts):
 * - `['s', path, value]`: set the value at path (object key or array index)
 * - `['d', path]`: delete the key at path
 * - `['x', path, start, deleteCount, items]`: splice the array at path (push/pop/shift/unshift/splice)
 * - `['l', path, length]`: set the length of the array at path
 */
export type PatchOp =
  | ['s', PatchPath, unknown]
  | ['d', PatchPath]
  | ['x', PatchPath, number, number, unknown[]]
  | ['l', PatchPath, number];

export type ErrorInfo = { message: string; code?: string };

/** window -> core */
export type ClientMessage =
  | { type: 'ping'; id: number; t: number }
  | { type: 'call'; id: number; target: string; method: string; args: unknown[] }
  /** (Re)subscribe. Sending `sub` again with a known `sid` re-sends a fresh snapshot. */
  | { type: 'sub'; sid: number; slice: string }
  | { type: 'unsub'; sid: number }
  | { type: 'on'; event: string }
  | { type: 'off'; event: string }
  | { type: 'meters-on' }
  | { type: 'meters-off' };

/** core -> window */
export type ServerMessage =
  | { type: 'status'; status: CoreStatus }
  | { type: 'pong'; id: number; t: number; ts: number }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: ErrorInfo }
  | { type: 'snapshot'; sid: number; slice: string; value: unknown; rev: number }
  | { type: 'patch'; sid: number; rev: number; ops: PatchOp[] }
  | { type: 'sub-error'; sid: number; slice: string; error: ErrorInfo }
  | { type: 'event'; name: string; payload: unknown }
  /** Sent only between `meters-on` and `meters-off`, at <= 15 Hz. */
  | { type: 'meters'; data: Float32Array | number[] };

/** main -> core (via utilityProcess parentPort) */
export type MainToCoreMessage =
  | {
      type: 'init';
      userData: string;
      appPath: string;
      version: string;
      /** Directory of the obs-studio-node package (app.asar.unpacked aware). */
      osnPath: string;
    }
  | { type: 'window-port'; windowId: number } // + 1 MessagePort in `ports`
  | { type: 'shutdown' }
  /** A BrowserWindow that had a `window-port` was destroyed (dialog windows: registry cleanup). */
  | { type: 'window-closed'; windowId: number }
  /** Deep link forwarded by main; core accepts and ignores it for now. */
  | { type: 'protocol-link'; url: string }
  /** Answer to a core `rpc` request (see contracts/main-rpc.ts). */
  | { type: 'rpc-result'; id: number; ok: true; value: unknown }
  | { type: 'rpc-result'; id: number; ok: false; error: ErrorInfo };

/** core -> main */
export type CoreToMainMessage =
  | { type: 'status'; status: CoreStatus }
  | { type: 'shutdown-done'; ok: boolean; error?: string }
  /** Request to the main process; `method` and `args` are typed by `MainRpcMethods`. */
  | { type: 'rpc'; id: number; method: string; args: unknown[] }
  /** pid of the obs64 process core started; main kills it if core dies unexpectedly. */
  | { type: 'obs-pid'; pid: number };

/** Messages the preload posts to its page to hand over the core port. */
export const CORE_PORT_MESSAGE = 'reborn:core-port';
