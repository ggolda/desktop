// obs64.exe is a child of the core utilityProcess. If core dies unexpectedly, obs64 must not stay
// behind. Primary: core reports the obs64 pid (`obs-pid`). Fallback: look up obs64 by parent pid
// (Windows keeps ParentProcessId of orphans, so this works after the parent is gone).
import { execFile, spawnSync } from 'node:child_process';

function killPid(pid: number): void {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
    return;
  }
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
}

/**
 * Kills obs64 left behind by a dead core. Synchronous on purpose: the crash handler may terminate
 * main right after core dies, so there is no time for async work. Returns the pids it killed.
 */
export function cleanupObsOrphans(corePid: number, obsPid: number): number[] {
  const killed = new Set<number>();
  if (obsPid > 0) {
    killPid(obsPid);
    killed.add(obsPid);
  }
  if (process.platform !== 'win32' || !corePid) return [...killed];
  const ps = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${Math.trunc(corePid)} AND Name='obs64.exe'" | ForEach-Object { $_.ProcessId }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    windowsHide: true,
    timeout: 10_000,
    encoding: 'utf8',
  });
  for (const pid of String(r.stdout ?? '')
    .split(/\s+/)
    .map(Number)) {
    if (pid > 0 && !killed.has(pid)) {
      killPid(pid);
      killed.add(pid);
    }
  }
  return [...killed];
}

/** Async lookup of obs64 children of core (used once after OBS init when core did not report a pid). */
export function findObsChildren(corePid: number): Promise<number[]> {
  if (process.platform !== 'win32' || !corePid) return Promise.resolve([]);
  const ps = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${Math.trunc(corePid)} AND Name='obs64.exe'" | ForEach-Object { $_.ProcessId }`;
  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 10_000 },
      (_e, stdout) =>
        resolve(
          String(stdout ?? '')
            .split(/\s+/)
            .map(Number)
            .filter(n => n > 0),
        ),
    );
  });
}
