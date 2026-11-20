// The ONLY place that loads obs-studio-node (SPEC 4): init + shutdown and access to the module.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Osn } from './types';

export interface OsnInitOptions {
  /** Directory of the obs-studio-node package (contains obs64.exe). */
  osnPath: string;
  /** Where OBS stores its config (userData). */
  appDataPath: string;
  version: string;
}

export interface OsnInitResult {
  ok: boolean;
  code: number;
  initMs: number;
  error?: string;
}

let osn: Osn | null = null;
let hosted = false;
let inited = false;

/** The loaded module. Only valid after a successful `initObs`. */
export function getOsn(): Osn {
  if (!osn) throw new Error('obs-studio-node is not loaded');
  return osn;
}

export function initObs(opts: OsnInitOptions): OsnInitResult {
  const t0 = performance.now();
  const result = (code: number, error?: string): OsnInitResult => ({
    ok: code === 0,
    code,
    initMs: Math.round(performance.now() - t0),
    error,
  });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    osn = require('obs-studio-node') as Osn;
    osn.IPC.host(`slobs-${randomUUID()}`);
    hosted = true;
    osn.NodeObs.SetWorkingDirectory(opts.osnPath);
    const code = osn.NodeObs.OBS_API_initAPI({
      language: 'en-US',
      appDataPath: opts.appDataPath,
      version: opts.version,
      crashServerUrl: '',
    });
    inited = code === 0;
    return result(code, inited ? undefined : `OBS_API_initAPI returned ${code}`);
  } catch (e) {
    return result(-1, e instanceof Error ? e.message : String(e));
  }
}

/** Shutdown order as in the legacy app: InitShutdownSequence, then IPC.disconnect. */
export function shutdownObs(): { ok: boolean; error?: string } {
  const errors: string[] = [];
  const attempt = (name: string, f: () => void) => {
    try {
      f();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (osn && inited) attempt('InitShutdownSequence', () => osn!.NodeObs.InitShutdownSequence());
  if (osn && hosted) attempt('IPC.disconnect', () => osn!.IPC.disconnect());
  inited = false;
  hosted = false;
  return errors.length ? { ok: false, error: errors.join('; ') } : { ok: true };
}

/**
 * pid of the obs64 child of this process (Windows), for main's orphan cleanup. Async: one short
 * PowerShell query, never on a hot path.
 */
export function findObsPid(): Promise<number> {
  if (process.platform !== 'win32') return Promise.resolve(0);
  const ps = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} AND Name='obs64.exe'" | ForEach-Object { $_.ProcessId }`;
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 10_000 },
      (_e, stdout) => resolve(String(stdout ?? '').split(/\s+/).map(Number).find(n => n > 0) ?? 0),
    );
  });
}
