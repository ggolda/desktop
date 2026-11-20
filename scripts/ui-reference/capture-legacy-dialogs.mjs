// Captures the LEGACY child-window dialogs (Add Source, Name/Rename, Source Properties) for M1 dialogs.
//   node scripts/ui-reference/capture-legacy-dialogs.mjs [--no-launch] [--out <dir>]
// Same prereqs/safety as capture-legacy.mjs (throw-away SLOBS_CACHE_DIR profile in os.tmpdir(), onboarding
// skipped). Driven ONLY through CDP (Input.dispatchMouseEvent / Runtime.evaluate inside the pages) and
// PrintWindow; the real mouse/keyboard are never used. Properties of audio sources are opened through the
// legacy `servicesManager` in the main page (their menu is a native popup, which would need real input).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, makeEval } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const refDir = path.resolve(root, '..', 'legacy-ref');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const outDir = path.resolve(opt('--out', path.join(root, 'docs/rework/ui-reference/dialogs')));
const profile = path.join(os.tmpdir(), 'legacy-ref-profile');
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ps = (script, ...a) =>
  execFileSync('powershell', ['-NoProfile', '-File', path.join(here, script), ...a])
    .toString()
    .trim();

if (!args.includes('--no-launch')) {
  if (path.relative(os.tmpdir(), profile).startsWith('..'))
    throw new Error('profile not in tmpdir');
  fs.rmSync(profile, { recursive: true, force: true });
  execFileSync(
    'node',
    [
      path.join(root, 'scripts/fixtures/copy-collections.mjs'),
      'typical',
      path.join(profile, 'slobs-client'),
    ],
    { stdio: 'inherit' },
  );
  spawn(
    path.join(refDir, 'node_modules/electron/dist/electron.exe'),
    [
      '.',
      '--skip-update',
      '--remote-debugging-port=9222',
      '--disable-features=CalculateNativeWinOcclusion',
      '--force-device-scale-factor=1',
    ],
    {
      cwd: refDir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, SLOBS_CACHE_DIR: profile, SLD_TESTS_SKIP_ONBOARDING: 'true' },
    },
  ).unref();
}

let conn;
for (let i = 0; i < 90 && !conn; i++) {
  await sleep(1000);
  try {
    conn = await connect();
  } catch {}
}
if (!conn) throw new Error('legacy did not start');
const { browser, page, pages } = conn;
const ev = await makeEval(page);
for (let i = 0; i < 90; i++) {
  if (
    await ev(() => document.querySelectorAll('[class*=mixer-item]').length > 0).catch(() => false)
  )
    break;
  await sleep(1000);
}
await sleep(6000);
ps('shot-window.ps1', '-Width', '1280', '-Height', '800');
await sleep(2500);

// ---- helpers -----------------------------------------------------------------------------------------
const childPage = () => pages().find(p => p.url().includes('windowId=child'));
async function waitChild(text, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const p = childPage();
    if (p) {
      try {
        const cev = await makeEval(p);
        if (await cev(t => document.body.innerText.includes(t), text)) return { p, cev };
      } catch {}
    }
    await sleep(400);
  }
  throw new Error('child did not show: ' + text);
}
async function clickIn({ p, cev }, selOrText, { text = false, dbl = false, nth = 0 } = {}) {
  const c = await cev(
    ({ s, text, nth }) => {
      const els = text
        ? [...document.querySelectorAll('button, .ant-menu-item, label, span')].filter(
            e => e.textContent.trim() === s && e.getBoundingClientRect().width > 0,
          )
        : [...document.querySelectorAll(s)];
      const e = els[nth];
      if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      const b = e.getBoundingClientRect();
      return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
    },
    { s: selOrText, text, nth },
  );
  if (!c) throw new Error('missing in child: ' + selOrText);
  if (dbl) await p.mouse.dblclick(c[0], c[1]);
  else await p.mouse.click(c[0], c[1]);
  await sleep(700);
}
function shot(name) {
  const prefix = path.join(outDir, name).replace(/\\/g, '/');
  console.log(ps('menu.ps1', 'children', '-Out', prefix));
  const f = prefix + '-1.png';
  if (fs.existsSync(f)) fs.renameSync(f, prefix + '.png');
}
const baseline = () => ps('menu.ps1', 'baseline');
async function closeChild() {
  const p = childPage();
  if (!p) return;
  const cev = await makeEval(p);
  try {
    await clickIn({ p, cev }, 'Close', { text: true });
  } catch {
    try {
      await clickIn({ p, cev }, 'Cancel', { text: true });
    } catch {
      await clickIn({ p, cev }, 'i.icon-close[class*=titlebar-action]');
    }
  }
  for (let i = 0; i < 20 && childPage(); i++) await sleep(300);
  await sleep(800);
}
async function mainClick(sel, nth = 0) {
  const c = await ev(
    ({ sel, nth }) => {
      const e = document.querySelectorAll(sel)[nth];
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
    },
    { sel, nth },
  );
  if (!c) throw new Error('missing in main: ' + sel);
  await page.mouse.click(c[0], c[1]);
  await sleep(800);
}
async function mainHover(sel, nth = 0) {
  const c = await ev(
    ({ sel, nth }) => {
      const b = document.querySelectorAll(sel)[nth].getBoundingClientRect();
      return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
    },
    { sel, nth },
  );
  await page.mouse.move(c[0], c[1]);
  await sleep(600);
}

// dismiss help tips if present
await ev(() => document.querySelectorAll('[class*=help-tip__close]').forEach(e => e.click())).catch(
  () => {},
);

const only = opt('--only', '');
if (!only) {
  // ---- Name Scene / Rename Scene -----------------------------------------------------------------------
  baseline();
  await mainClick('i.icon-add-circle', 0);
  await waitChild('Please enter the name of the scene');
  await sleep(800);
  shot('name-scene');
  await closeChild();

  // Rename Scene: legacy opens it from the scene context menu (native). Open through the service instead.
  baseline();
  await ev(() => {
    const s = window['servicesManager'].getResource('ScenesService');
    s.showNameScene({ rename: s.views.activeSceneId });
  }).catch(e => console.log('showNameScene rename failed', e.message));
  await waitChild('Please enter the name of the scene').catch(() => {});
  await sleep(800);
  shot('rename-scene');
  await closeChild();

  // Rename Source (source row context menu is native; open through the service)
  baseline();
  await ev(() => {
    const s = window['servicesManager'].getResource('SourcesService');
    const src = s.views.getSources().find(x => x.type === 'image_source');
    s.showRenameSource(src.sourceId);
  }).catch(e => console.log('showRenameSource failed', e.message));
  await waitChild('Please enter the name of the source').catch(() => {});
  await sleep(800);
  shot('rename-source');
  await closeChild();

  // ---- Add Source showcase -----------------------------------------------------------------------------
  baseline();
  await mainClick('i.icon-add-circle', 1);
  let c = await waitChild('Essentials');
  await sleep(1000);
  shot('add-source-all');
  await clickIn(c, 'Media Categories', { text: true });
  await sleep(600);
  shot('add-source-media-categories');
  await clickIn(c, 'Widgets', { text: true });
  await sleep(600);
  shot('add-source-widgets-logged-out');
  await clickIn(c, 'All Sources', { text: true });
  await clickIn(c, '.source-tag[data-name="Window Capture"]');
  await sleep(600);
  shot('add-source-selected-window-capture');
  await closeChild();
}

/** Opens the showcase, double clicks a type, captures the naming step(s) and the properties window. */
async function addType(key, tagName, { existing = false, audio = false } = {}) {
  baseline();
  await mainClick('i.icon-add-circle', 1);
  let c = await waitChild('Essentials');
  await sleep(600);
  await clickIn(c, `.source-tag[data-name="${tagName}"]`, { dbl: true });
  c = await waitChild(existing ? 'Add Existing Source' : 'Please enter the name of the source');
  await sleep(1200);
  if (existing) {
    shot(`add-source-existing-${key}`);
    await clickIn(c, 'Add a new source instead', { text: true });
    await waitChild('Please enter the name of the source');
    await sleep(600);
  }
  shot(`add-source-name-${key}`);
  await clickIn(c, 'Add Source', { text: true });
  if (audio) {
    await waitChild('Advanced Audio Settings', 15000).catch(() => {});
    await sleep(1200);
    shot(`advanced-audio-after-add-${key}`);
    await closeChild();
    baseline();
    await ev(() => {
      const s = window['servicesManager'].getResource('SourcesService');
      const src = s.views
        .getSources()
        .filter(x => x.type === 'wasapi_input_capture')
        .pop();
      s.showSourceProperties(src.sourceId);
    });
    c = await waitChild('Done');
  } else {
    c = await waitChild('Done', 20000).catch(() => waitChild('Close', 5000));
  }
  await sleep(2500);
  shot(`properties-${key}`);
  await closeChild();
}

if (!only || only === 'image') await addType('image', 'Image', { existing: true });
if (!only || only === 'color') await addType('color', 'Color Block');
if (!only || only === 'browser') await addType('browser', 'Browser Source');
if (!only || only === 'window-capture')
  await addType('window-capture', 'Window Capture', { existing: true });
if (!only || only === 'text-gdi') await addType('text-gdi', 'Text (GDI+)');
if (!only || only === 'audio-input')
  await addType('audio-input', 'Audio Input Capture', { audio: true, existing: true });

await browser.close().catch(() => {});
console.log('done');
