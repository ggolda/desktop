// Renders the dialog windows against the fake core (Vite dev page `dialog-fake`), headless Chromium via
// playwright-core, and composes legacy | reborn side-by-side images into test-results/parity/dialogs/.
// Needs `npx vite --config vite.windows.config.ts` running on :5173 (npm run dev also serves it).
//   node scripts/ui-reference/dialogs-parity.mjs [--only <substring>]
// Never touches the real mouse or keyboard: only page-level events inside headless Chromium.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ref = path.join(root, 'docs/rework/ui-reference/dialogs');
const out = path.join(root, 'test-results/parity/dialogs');
fs.mkdirSync(out, { recursive: true });

const require = createRequire(import.meta.url);
let playwright;
for (const p of [path.join(os.tmpdir(), 'pw/node_modules/playwright-core'), 'playwright-core']) {
  try {
    playwright = require(p);
    break;
  } catch {
    // next
  }
}
if (!playwright) throw new Error('playwright-core not found (npm i playwright-core in %TEMP%\\pw)');
const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : '';
const BASE = 'http://localhost:5173/dialog-fake/index.html';

/** legacy: PNG name, crop of the legacy PNG (x, y, w, h), mine: crop of my render. */
const CASES = [
  {
    id: 'add-source-all',
    q: 'kind=source-showcase&legacy=1',
    size: [900, 700],
    legacy: [8, 0, 900, 700],
  },
  {
    id: 'add-source-media-categories',
    q: 'kind=source-showcase&legacy=1',
    size: [900, 700],
    legacy: [8, 0, 900, 700],
    act: p => p.click('[data-testid=tab-general]'),
  },
  {
    id: 'add-source-widgets-logged-out',
    q: 'kind=source-showcase&legacy=1',
    size: [900, 700],
    legacy: [8, 0, 900, 700],
    act: p => p.click('[data-testid=tab-widgets]'),
  },
  {
    id: 'add-source-selected-window-capture',
    q: 'kind=source-showcase&legacy=1',
    size: [900, 700],
    legacy: [8, 0, 900, 700],
    act: p => p.click('[data-testid=section-captureSources] [data-id=window_capture]'),
  },
  {
    id: 'add-source-existing-image',
    q: 'kind=add-source&type=image_source&existing=1',
    size: [600, 320],
    legacy: [8, 0, 600, 320],
  },
  {
    id: 'add-source-name-image',
    q: 'kind=add-source&type=image_source&existing=1',
    size: [600, 320],
    legacy: [8, 0, 600, 320],
    act: p => p.click('[data-testid=new-instead] button'),
  },
  {
    id: 'add-source-name-color',
    q: 'kind=add-source&type=color_source',
    size: [600, 320],
    legacy: [8, 0, 600, 320],
  },
  { id: 'name-scene', q: 'kind=name-scene', size: [400, 250], legacy: [8, 0, 400, 250] },
  { id: 'rename-scene', q: 'kind=name-scene&rename=1', size: [400, 250], legacy: [8, 0, 400, 250] },
  {
    id: 'rename-source',
    q: 'kind=rename-source&type=image_source',
    size: [400, 250],
    legacy: [8, 0, 400, 250],
  },
  // the legacy PNGs of Source Properties are shifted: no title bar, the footer ends at y=770
  ...[
    ['properties-image', 'image_source'],
    ['properties-color', 'color_source'],
    ['properties-browser', 'browser_source'],
    ['properties-window-capture', 'window_capture'],
    ['properties-text-gdi', 'text_gdiplus'],
  ].map(([id, type]) => ({
    id,
    q: `kind=source-properties&type=${type}`,
    size: [600, 800],
    legacy: [8, 0, 600, 770],
    mine: [0, 30, 600, 770],
  })),
  {
    id: 'properties-audio-input',
    q: 'kind=source-properties&type=wasapi_input_capture',
    size: [600, 800],
    legacy: [8, 0, 600, 800],
  },
];

const browser = await playwright.chromium.launch({
  executablePath: chrome,
  headless: true,
  ignoreDefaultArgs: ['--hide-scrollbars'], // legacy shows its scrollbars
});
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const results = [];

for (const c of CASES) {
  if (only && !c.id.includes(only)) continue;
  const page = await ctx.newPage();
  await page.setViewportSize({ width: c.size[0], height: c.size[1] });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}?${c.q}`);
  await page.waitForSelector('[data-testid=dialog]', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  if (c.act) await c.act(page);
  await page.waitForTimeout(400);
  const file = path.join(out, `${c.id}.reborn.png`);
  await page.screenshot({ path: file });
  await page.close();

  const legacyFile = path.join(ref, `${c.id}.png`);
  const m = c.mine ?? [0, 0, c.size[0], c.size[1]];
  const b64 = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const [lx, ly, lw, lh] = c.legacy;
  const cmp = await ctx.newPage();
  await cmp.setViewportSize({ width: lw + m[2] + 30, height: Math.max(lh, m[3]) + 10 });
  await cmp.setContent(`<body style="margin:0;background:#444;display:flex;gap:10px;padding:5px">
    <div style="width:${lw}px;height:${lh}px;overflow:hidden;position:relative"><img src="${b64(legacyFile)}" style="position:absolute;left:-${lx}px;top:-${ly}px"></div>
    <div style="width:${m[2]}px;height:${m[3]}px;overflow:hidden;position:relative"><img src="${b64(file)}" style="position:absolute;left:-${m[0]}px;top:-${m[1]}px"></div></body>`);
  await cmp.waitForTimeout(100);
  await cmp.screenshot({ path: path.join(out, `${c.id}.png`) });
  await cmp.close();
  results.push({ id: c.id, errors });
  console.log(c.id, errors.length ? `ERRORS: ${errors.join(' | ')}` : 'ok');
}
await browser.close();
