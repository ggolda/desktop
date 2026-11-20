// Captures the NEW app in the same states and sizes as the legacy references and writes composites
// (legacy | new | diff) to test-results/parity/editor/. Start the app first (start-new.sh, CDP on 9223).
//   node scripts/ui-reference/capture-new.mjs [state ...]   (default: all)  [--size=1280x800|1920x1080]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const PW_DIR = process.env.PW_DIR || path.join(os.tmpdir(), 'pw');
const { chromium } = createRequire(path.join(PW_DIR, 'x.js'))('playwright-core');

const REF = 'docs/rework/ui-reference/editor';
const OUT = 'test-results/parity/editor';
const sizeArg = process.argv.find(a => a.startsWith('--size='))?.slice(7);
const sizes = sizeArg ? [sizeArg] : ['1280x800', '1920x1080'];
const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));

const states = {
  'editor-default': async () => {},
  'hover-scene-row': p => p.hover('[data-testid=scene-row]'),
  'hover-source-row': p => p.hover('[data-testid=source-row]'),
  'selected-source-row': async p => {
    await p.click('[data-testid=source-row]');
    await p.mouse.move(5, 5);
  },
  'hover-mixer-row': p => p.hover('[data-testid=mixer-row]'),
  'hover-add-scene-button': p => p.hover('[data-testid=scene-add]'),
  'hover-add-source-button': p => p.hover('[data-testid=source-add]'),
};

const ps = (...args) =>
  execFileSync(
    'powershell',
    ['-NoProfile', '-File', 'scripts/ui-reference/shot-new.ps1', ...args],
    {
      stdio: 'pipe',
    },
  );

const browser = await chromium.connectOverCDP('http://localhost:9223');
const page = browser.contexts()[0].pages()[0];
for (const size of sizes) {
  const [w, h] = size.split('x');
  ps('-Width', w, '-Height', h);
  await page.waitForTimeout(800);
  for (const [name, act] of Object.entries(states)) {
    if (wanted.length && !wanted.includes(name)) continue;
    await page.mouse.move(5, 5);
    await act(page);
    await page.waitForTimeout(400);
    const out = `${OUT}/new-${name}-${size}.png`;
    ps('-Out', out);
    execFileSync(
      'python',
      [
        'scripts/ui-reference/compare.py',
        `${REF}/${name}-${size}.png`,
        out,
        `${OUT}/cmp-${name}-${size}.png`,
        '--crop',
        '--diff',
      ],
      { stdio: 'inherit' },
    );
  }
}
await browser.close();
