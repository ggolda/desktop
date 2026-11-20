/* global process, console, document */
// Check of the preview editor overlay against the running NEW app (start-new.sh, CDP 9223).
//   node scripts/overlay/scenario.mjs [outDir]        (INPUT=real uses OS mouse/keyboard, default CDP events)
// Real OS input proves the native display passes mouse events through to the DOM overlay; it needs an
// unlocked desktop. Screenshots go to test-results/parity/overlay/. Collection files are compared by
// JSON PATH only (values are never printed).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { calibrate, connect, connectLegacy, pointerApi, shot, sleep } from './lib.mjs';

const legacy = process.env.TARGET === 'legacy';

const out = process.argv[2] ?? 'test-results/parity/overlay';
fs.mkdirSync(out, { recursive: true });
const userData = fs
  .readFileSync(`test-results/parity/${legacy ? 'legacy-profile' : 'userdata'}.txt`, 'utf8')
  .trim();
const collDir = path.join(userData, legacy ? 'slobs-client' : '', 'SceneCollections');

const readColl = () => {
  const m = JSON.parse(fs.readFileSync(path.join(collDir, 'manifest.json'), 'utf8'));
  const id = m.activeId ?? m.collections?.[0]?.id;
  return JSON.parse(fs.readFileSync(path.join(collDir, `${id}.json`), 'utf8'));
};
function diffPaths(a, b, p = '', acc = []) {
  if (a === b) return acc;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
    acc.push(p || '/');
    return acc;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    diffPaths(a[k], b[k], `${p}/${k}`, acc);
  return acc;
}
const handles = png =>
  JSON.parse(execFileSync('python', ['scripts/overlay/handles.py', png]).toString());
// PrintWindow images include the 8 px invisible left border: client x = image x - 8
const toClient = h => [h.x - 8, h.y];

const { browser, page } = legacy ? await connectLegacy() : await connect();
shot(`${out}/s0-start.png`, 1280, 800);
await sleep(500);
const real = process.env.INPUT === 'real' && !legacy;
const cal = real ? await calibrate(page) : null; // legacy always uses CDP input (no OS clicks)
const P = pointerApi(page, cal);
console.log('input:', real ? 'real OS input' : 'CDP events');
const sel = () =>
  legacy
    ? Promise.resolve('(legacy: see screenshots)')
    : page.evaluate(() =>
        [...document.querySelectorAll('[data-testid=source-row]')]
          .filter(e => e.dataset.selected)
          .map(e => e.textContent.trim()),
      );

if (legacy) {
  // dismiss the two first-run help tips
  await P.click(1179, 52);
  await P.click(352, 573);
}

// 1. click selects: the Alert Box is the front-most item, the game Image is behind it
await P.click(400, 300);
console.log('click (400,300)      ->', await sel());
await P.click(700, 300);
console.log('click (700,300)      ->', await sel());
shot(`${out}/o1-selected.png`);

// baseline save: nudge right then left (transform ends where it started, the file is written)
await P.key('ArrowRight');
await P.key('ArrowLeft');
await sleep(2500);
const base = readColl();

// 2. drag
const before = handles(`${out}/o1-selected.png`);
console.log('handles drawn by OBS:', before.length);
await P.drag([700, 300], [760, 270]);
shot(`${out}/o2-after-drag.png`);
console.log('after drag           ->', await sel());

// 3. resize from the south-east corner (aspect locked), then free with Shift
let hs = handles(`${out}/o2-after-drag.png`);
let se = hs.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
await P.drag(toClient(se), [toClient(se)[0] + 40, toClient(se)[1] + 30]);
shot(`${out}/o3-after-resize.png`);
hs = handles(`${out}/o3-after-resize.png`);
se = hs.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
await P.drag(toClient(se), [toClient(se)[0] - 20, toClient(se)[1] - 10], { keys: ['Shift'] });
shot(`${out}/o4-after-shift-resize.png`);

// 4. crop: Alt + the east edge handle
hs = handles(`${out}/o4-after-shift-resize.png`);
// the east handle is the middle one of the right column; with the box top clipped by the display it is
// the highest one of that column
const maxX = Math.max(...hs.map(h => h.x));
const mid = hs.filter(h => h.x === maxX).sort((a, b) => a.y - b.y)[0];
await P.drag(toClient(mid), [toClient(mid)[0] - 40, toClient(mid)[1]], { keys: ['Alt'] });
shot(`${out}/o5-after-crop.png`);

// 5. arrow nudge
await P.key('ArrowRight');
await P.key('ArrowDown');
shot(`${out}/o6-after-nudge.png`);

// 6. click on empty area clears the selection
await P.click(20, 130);
console.log('after empty click    ->', await sel());

if (real) {
  // right click on an item opens the native menu (closed with Escape by the OS helper)
  await P.click(700, 300, { right: true });
}

await sleep(2500);
const after = readColl();
console.log('changed paths vs baseline save (values are never printed):');
const paths = diffPaths(base, after);
for (const p of paths) console.log('  ', p);
await browser.close();
