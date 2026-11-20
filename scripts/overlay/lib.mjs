/* global setTimeout, window, document, process */
// Helpers for the preview overlay checks against the running NEW app (CDP 9223, see start-new.sh).
import { execFileSync } from 'node:child_process';
import { connectNew } from '../ui-reference/cdp-new.mjs';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function mouse(cmds) {
  execFileSync('powershell', ['-NoProfile', '-File', 'scripts/overlay/mouse.ps1', '-Cmds', cmds], {
    stdio: 'pipe',
  });
}

export function shot(out, w = 0, h = 0) {
  const script = process.env.TARGET === 'legacy' ? 'shot-window.ps1' : 'shot-new.ps1';
  const args = ['-NoProfile', '-File', `scripts/ui-reference/${script}`, '-Out', out];
  if (w) args.push('-Width', String(w), '-Height', String(h));
  execFileSync('powershell', args, { stdio: 'pipe' });
}

/** Maps page (client) px to screen px using a real pointer move that the page reports back. */
export async function calibrate(page) {
  await page.evaluate(() => {
    window.__pm = [];
    window.addEventListener('pointermove', e => window.__pm.push([e.clientX, e.clientY]), true);
  });
  mouse('focus'); // the guard in mouse.ps1 refuses button events while another app is in front
  mouse('m 650 400; sleep 150; m 652 402; sleep 150');
  const last = await page.evaluate(() => window.__pm.at(-1));
  if (!last) throw new Error('no pointermove reached the page: calibrate failed');
  return {
    ox: 652 - last[0],
    oy: 402 - last[1],
    toScreen: (x, y) => [Math.round(x + (652 - last[0])), Math.round(y + (402 - last[1]))],
  };
}

/** The legacy app (CDP 9222): only used for keyboard events and screenshots. */
export async function connectLegacy() {
  const { chromium } = await import('playwright-core').catch(() => ({}));
  const { createRequire } = await import('node:module');
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const req = createRequire(
    pathMod.join(process.env.PW_DIR || pathMod.join(os.tmpdir(), 'pw'), 'x.js'),
  );
  const pw = chromium ?? req('playwright-core').chromium;
  const browser = await pw.connectOverCDP('http://localhost:9222');
  const page = browser
    .contexts()[0]
    .pages()
    .find(p => p.url().includes('windowId=main'));
  return { browser, page };
}

export async function connect() {
  const { browser, page } = await connectNew();
  return { browser, page };
}

/** Geometry of the first/active scene as the page sees it (via the exposed test hook, see below). */
export const rect = (page, sel) =>
  page.evaluate(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sel);

/**
 * Pointer/keyboard actions in page (client) px. `real`: OS input (mouse.ps1, needs an unlocked desktop,
 * proves the native display passes input through); otherwise CDP Input events (same DOM events, no OS).
 */
export function pointerApi(page, cal) {
  const real = !!cal;
  const sc = (x, y) => (real ? cal.toScreen(x, y) : [x, y]);
  return {
    real,
    async click(x, y, o = {}) {
      if (real) {
        const [sx, sy] = sc(x, y);
        mouse(
          `m ${sx} ${sy}; sleep 100; ${o.right ? 'rd; sleep 60; ru' : 'd; sleep 60; u'}; sleep 500`,
        );
      } else {
        await page.mouse.move(x, y);
        if (o.ctrl) await page.keyboard.down('Control');
        await page.mouse.down({ button: o.right ? 'right' : 'left' });
        await page.mouse.up({ button: o.right ? 'right' : 'left' });
        if (o.ctrl) await page.keyboard.up('Control');
        await sleep(500);
      }
    },
    /** Press at `from`, move to `to` in `steps` steps (25 ms apart), release. */
    async drag(from, to, o = {}) {
      const steps = o.steps ?? 10;
      const at = i => [
        from[0] + ((to[0] - from[0]) * i) / steps,
        from[1] + ((to[1] - from[1]) * i) / steps,
      ];
      if (real) {
        const vk = { Shift: 16, Control: 17, Alt: 18 };
        const mods = (o.keys ?? []).map(k => vk[k]);
        const [sx, sy] = sc(...from);
        mouse(
          `m ${sx} ${sy}; sleep 100; ${mods
            .map(v => `kd ${v}`)
            .concat('d')
            .join('; ')}; sleep 60`,
        );
        for (let i = 1; i <= steps; i++) {
          const [mx, my] = sc(...at(i));
          mouse(`m ${Math.round(mx)} ${Math.round(my)}; sleep 25`);
        }
        mouse(
          `sleep 100; u; ${mods
            .map(v => `ku ${v}`)
            .concat('sleep 700')
            .join('; ')}`,
        );
      } else {
        await page.mouse.move(...from);
        await sleep(100);
        for (const k of o.keys ?? []) await page.keyboard.down(k);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(...at(i));
          await sleep(25);
        }
        await sleep(100);
        await page.mouse.up();
        for (const k of o.keys ?? []) await page.keyboard.up(k);
        await sleep(700);
      }
    },
    async key(k) {
      await page.keyboard.press(k);
      await sleep(200);
    },
  };
}
