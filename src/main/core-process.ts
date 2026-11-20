import { MessageChannelMain, utilityProcess } from 'electron';
import type { UtilityProcess, WebContents } from 'electron';
import path from 'node:path';
import type { CoreStatus, CoreToMainMessage, MainToCoreMessage } from '../shared/protocol';
import { handleRpc } from './main-rpc';
import { cleanupObsOrphans, findObsChildren } from './orphans';
import { osnDir } from './paths';

const SHUTDOWN_TIMEOUT_MS = 10_000;

type ShutdownResult = { ok: boolean; error?: string };

export class CoreProcess {
  private proc: UtilityProcess;
  private pid = 0;
  private status: CoreStatus | null = null;
  private statusWaiters: Array<(s: CoreStatus) => void> = [];
  private shutdownWaiter: ((r: ShutdownResult) => void) | null = null;
  private exited = false;
  private shuttingDown = false;
  private obsPid = 0;

  /** Resolves with the OS pid once the process has spawned (for the crash handler). */
  readonly spawned: Promise<number>;

  constructor(opts: {
    userData: string;
    appPath: string;
    version: string;
    /** Absolute path of the core bundle (from the active bundle set). */
    modulePath: string;
  }) {
    // The core may live outside the app (hotfix cache in userData); core-loader.cjs makes the
    // app's node_modules resolvable for it, then requires SLOBS_CORE_ENTRY.
    this.proc = utilityProcess.fork(path.join(__dirname, 'core-loader.cjs'), [], {
      serviceName: 'slobs-core',
      env: {
        ...process.env,
        SLOBS_CORE_ENTRY: opts.modulePath,
        SLOBS_NODE_MODULES: path.join(opts.appPath, 'node_modules'),
      },
    });
    this.spawned = new Promise(resolve =>
      this.proc.once('spawn', () => resolve((this.pid = this.proc.pid ?? 0))),
    );
    this.proc.on('message', (msg: CoreToMainMessage) => {
      if (msg.type === 'status') {
        this.status = msg.status;
        if (msg.status.obsInit !== 'pending') {
          this.statusWaiters.splice(0).forEach(w => w(msg.status));
          // Fallback when core did not report `obs-pid`: remember obs64 once, so the exit handler
          // can kill it instantly (the crash handler may take main down right after core dies).
          if (msg.status.obsInit === 'ok' && !this.obsPid) {
            void findObsChildren(this.pid).then(p => {
              if (!this.obsPid && p[0]) this.obsPid = p[0];
            });
          }
        }
      } else if (msg.type === 'shutdown-done') {
        this.shutdownWaiter?.(msg);
      } else if (msg.type === 'obs-pid') {
        this.obsPid = Number(msg.pid) || 0;
      } else if (msg.type === 'rpc') {
        void handleRpc(msg).then(res => {
          if (!this.exited) this.send(res);
        });
      }
    });
    this.proc.on('exit', code => {
      this.exited = true;
      console.log(`[main] core exited (${code})`);
      this.shutdownWaiter?.({ ok: false, error: 'core exited' });
      if (!this.shuttingDown) {
        console.error('[main] core exited unexpectedly; cleaning up obs64');
        const k = cleanupObsOrphans(this.pid, this.obsPid);
        console.log(`[main] obs cleanup killed: ${k.join(',') || 'none'}`);
      }
    });
    this.send({
      type: 'init',
      userData: opts.userData,
      appPath: opts.appPath,
      version: opts.version,
      osnPath: osnDir(),
    });
  }

  private send(msg: MainToCoreMessage, ports?: Electron.MessagePortMain[]) {
    this.proc.postMessage(msg, ports);
  }

  /** A window that had a core port was destroyed (core drops the dialog registered on it). */
  sendWindowClosed(windowId: number) {
    if (!this.exited) this.send({ type: 'window-closed', windowId });
  }

  /** Forwards a slobs:// link to core (core may ignore it until link handling lands). */
  sendProtocolLink(url: string) {
    this.proc.postMessage({ type: 'protocol-link', url });
  }

  /** Resolves when OBS init finished (ok or error). */
  waitForObsInit(): Promise<CoreStatus> {
    if (this.status && this.status.obsInit !== 'pending') return Promise.resolve(this.status);
    return new Promise(resolve => this.statusWaiters.push(resolve));
  }

  /** Creates a MessageChannel: one port to core, the other to the window. */
  connectWindow(windowId: number, contents: WebContents) {
    const { port1, port2 } = new MessageChannelMain();
    this.send({ type: 'window-port', windowId }, [port1]);
    contents.postMessage('core-port', null, [port2]);
  }

  /** Asks core to shut OBS down and waits (max 10 s), then stops the process. */
  async shutdown(): Promise<ShutdownResult> {
    if (this.exited) return { ok: true };
    this.shuttingDown = true;
    const result = await new Promise<ShutdownResult>(resolve => {
      const timer = setTimeout(
        () => resolve({ ok: false, error: 'shutdown timeout' }),
        SHUTDOWN_TIMEOUT_MS,
      );
      this.shutdownWaiter = r => {
        clearTimeout(timer);
        resolve(r);
      };
      this.send({ type: 'shutdown' });
    });
    if (!this.exited) {
      this.proc.kill();
      if (!result.ok) cleanupObsOrphans(this.pid, this.obsPid);
    }
    return result;
  }
}
