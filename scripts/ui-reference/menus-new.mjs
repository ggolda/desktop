// Opens the native context menus of the NEW app and captures them like the legacy references
// (menu.ps1 with MENU_APP=new composites the popup windows onto the main window).
//   node scripts/ui-reference/menus-new.mjs [--size=1280x800]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const PW_DIR = process.env.PW_DIR || path.join(os.tmpdir(), 'pw');
const { chromium } = createRequire(path.join(PW_DIR, 'x.js'))('playwright-core');
const OUT = 'test-results/parity/editor';
const size = process.argv.find(a => a.startsWith('--size='))?.slice(7) ?? '1280x800';
const [w, h] = size.split('x');
const env = { ...process.env, MENU_APP: 'new' };
const menu = (...a) =>
  execFileSync('powershell', ['-NoProfile', '-File', 'scripts/ui-reference/menu.ps1', ...a], {
    env,
    stdio: 'pipe',
  }).toString();
execFileSync(
  'powershell',
  ['-NoProfile', '-File', 'scripts/ui-reference/shot-new.ps1', '-Width', w, '-Height', h],
  { stdio: 'pipe' },
);

const browser = await chromium.connectOverCDP('http://localhost:9223');
const page = browser.contexts()[0].pages()[0];
const cases = [
  { name: 'context-menu-scene', sel: '[data-testid=scene-row]', button: 'right' },
  { name: 'context-menu-source', sel: '[data-testid=source-row]', button: 'right' },
  { name: 'mixer-item-cog-menu', sel: '[data-testid=mixer-menu]', button: 'left' },
];
for (const c of cases) {
  const b = await page.locator(c.sel).first().boundingBox();
  const x = Math.round(b.x + b.width / 2);
  const y = Math.round(b.y + b.height / 2);
  menu('focus');
  await page.waitForTimeout(500);
  menu('move', '-X', String(x), '-Y', String(y));
  menu('baseline');
  // do not await: the click returns when the native menu is dismissed
  void page.mouse.click(x, y, { button: c.button }).catch(() => {});
  await page.waitForTimeout(1200);
  console.log(menu('shot', '-Out', `${OUT}/new-${c.name}-${size}.png`).trim());
  menu('close');
  await page.waitForTimeout(800);
}
await browser.close();
