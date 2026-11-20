// Prints bounding boxes / fonts of the new app's regions (same regions as docs/rework/ui-reference/editor/
// metrics.json) over CDP. Start the app with --remote-debugging-port=9223 first.
//   node scripts/ui-reference/measure-new.mjs [port]
// playwright-core is resolved from PW_DIR (default %TEMP%/pw), like cdp.mjs.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const PW_DIR = process.env.PW_DIR || path.join(os.tmpdir(), 'pw');
const { chromium } = createRequire(path.join(PW_DIR, 'x.js'))('playwright-core');

const port = Number(process.argv[2] || 9223);
const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const page = browser.contexts()[0].pages()[0];
const sel = {
  titlebar: '[data-testid=titlebar]',
  'nav-first': '[data-testid=nav-editor]',
  'nav-layouts': '[data-testid=nav-layouts]',
  'nav-studio': '[data-testid=nav-studio-mode]',
  'nav-help': '[data-testid=nav-help]',
  'nav-settings': '[data-testid=nav-settings]',
  'nav-login': '[data-testid=nav-login]',
  rows: '[data-testid=rows]',
  preview: '[data-testid=preview]',
  'minifeed-cell': '[data-testid=minifeed-cell]',
  'resize-bar': '[data-testid=resize-bar]',
  dock: '[data-testid=dock]',
  'scenes-add': '[data-testid=scene-add]',
  'scene-row': '[data-testid=scene-row]',
  'source-row': '[data-testid=source-row]',
  mixer: '[data-testid=mixer]',
  'mixer-row': '[data-testid=mixer-row]',
  'mixer-fader': '[data-testid=mixer-fader]',
  'mixer-mute': '[data-testid=mixer-mute]',
  footer: '[data-testid=footer]',
  record: '[data-testid=record-btn]',
  golive: '[data-testid=golive-btn]',
};
const out = await page.evaluate(sel => {
  const r = {};
  for (const [k, s] of Object.entries(sel)) {
    const el = document.querySelector(s);
    if (!el) {
      r[k] = null;
      continue;
    }
    const b = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    r[k] =
      `${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.width.toFixed(1)}x${b.height.toFixed(1)} ${c.fontFamily.slice(0, 8)} ${c.fontSize}/${c.fontWeight} ${c.color} bg ${c.backgroundColor}`;
  }
  return r;
}, sel);
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), v);
await browser.close();
