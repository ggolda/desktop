import { app } from 'electron';
import type { CoreProcess } from './core-process';
import { handleRpc } from './main-rpc';
import type { MainWindowHandle } from './main-window';

// Runs in the page: click "Ping core" once it is enabled, read back the measured round trip.
const PING_SCRIPT = `new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => {
    if (Date.now() - t0 > 20000) return reject(new Error('ping timeout'));
    const btn = document.querySelector('[data-testid="ping-btn"]');
    const out = document.querySelector('[data-testid="ping-ms"]');
    if (out && out.dataset.ms) return resolve(Number(out.dataset.ms));
    if (btn && !btn.disabled && !btn.dataset.clicked) { btn.dataset.clicked = '1'; btn.click(); }
    setTimeout(tick, 25);
  };
  tick();
})`;

interface PageInfo {
  url: string;
  title: string;
  scripts: string[];
}

// Which page/scripts were actually served (proves the slbundle:// path and the active set).
const PAGE_SCRIPT = `({
  url: location.href,
  title: document.querySelector('title')?.textContent ?? '',
  scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')),
})`;

// SLOBS_SMOKE=1: wait for OBS init + window shown + one renderer->core ping, print one JSON line, quit.
export async function runSmoke(
  core: CoreProcess,
  main: MainWindowHandle,
  bundles: { set: 'local' | 'hotfix'; corePath: string },
) {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('smoke timeout (60 s)')), 60_000),
  );
  let out: Record<string, unknown>;
  try {
    const run = (async () => {
      const [status, windowShownMs] = await Promise.all([core.waitForObsInit(), main.shown]);
      const pingMs = (await main.win.webContents.executeJavaScript(PING_SCRIPT)) as number;
      const page = (await main.win.webContents.executeJavaScript(PAGE_SCRIPT)) as PageInfo;
      const rpc = await handleRpc({
        type: 'rpc',
        id: 0,
        method: 'window.nativeHandle',
        args: [main.win.id],
      });
      const nativeHandleBytes = rpc.ok ? (rpc.value as Uint8Array).byteLength : 0;
      return { status, windowShownMs, pingMs, page, nativeHandleBytes };
    })();
    const r = await Promise.race([run, timeout]);
    out = {
      ok: r.status.obsInit === 'ok' && typeof r.pingMs === 'number',
      obsInit: r.status.obsInit,
      initMs: r.status.initMs,
      windowShownMs: r.windowShownMs,
      pingMs: r.pingMs,
      nativeHandleBytes: r.nativeHandleBytes,
      bundleSet: bundles.set,
      corePath: bundles.corePath,
      pageUrl: r.page.url,
      htmlTitle: r.page.title,
      scripts: r.page.scripts,
      ...(r.status.error ? { error: r.status.error } : {}),
    };
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  console.log(JSON.stringify(out));
  if (!out.ok) process.exitCode = 1;
  app.quit();
}
