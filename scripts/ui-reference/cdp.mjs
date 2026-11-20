// Shared helper: connect to a running legacy app via CDP. playwright-core is resolved from PW_DIR
// (default %TEMP%/pw; `npm i playwright-core` there) so nothing is installed into the repo.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const PW_DIR = process.env.PW_DIR || path.join(os.tmpdir(), 'pw');
const { chromium } = createRequire(path.join(PW_DIR, 'x.js'))('playwright-core');

export async function connect(port = 9222) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const pages = () => browser.contexts()[0].pages();
  const page = pages().find(p => p.url().includes('windowId=main'));
  if (!page) throw new Error('main window not found');
  return { browser, page, pages };
}

/**
 * page.evaluate is blocked (legacy overrides window.eval); use raw Runtime.evaluate instead.
 * ev(fn, arg) runs `(fn)(arg)` in the page; arg must be JSON-serialisable.
 */
export async function makeEval(page) {
  const s = await page.context().newCDPSession(page);
  const ev = async (fn, arg) => {
    const r = await s.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails),
      );
    return r.result.value;
  };
  ev.session = s;
  return ev;
}
