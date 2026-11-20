/* global window, document, createImageBitmap, OffscreenCanvas */
// End-to-end check of the M1 dialog windows against the real app and real OBS (needs `npm run build`).
//
// Everything is driven through CDP (Playwright connectOverCDP): clicks, typing and key presses are
// dispatched on the real DOM elements of the main window and of the dialog windows. No OS input is ever
// sent (CLAUDE.md "Automation safety"). Screenshots use PrintWindow (no focus needed).
//
// Native context menus cannot be clicked over CDP. The scene "Rename" step therefore uses the F2 key on
// the scene row, which calls the same `store.startRename()` the context-menu item calls.
//
// Usage: node scripts/test-dialogs-e2e.mjs      (fixture `typical` from .bench/fixtures, or a built-in
//        minimal collection when it does not exist). Screenshots land in test-results/e2e-dialogs/.
//        Needs playwright-core (PW_DIR, default %TEMP%/pw, as scripts/ui-reference/cdp-new.mjs).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const PW_DIR = process.env.PW_DIR || path.join(os.tmpdir(), 'pw');
const { chromium } = createRequire(path.join(PW_DIR, 'x.js'))('playwright-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shotDir = path.join(root, 'test-results', 'e2e-dialogs');
fs.mkdirSync(shotDir, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slobs-dialogs-'));
const port = 9300 + Math.floor(Math.random() * 600);
const logFile = path.join(dir, 'core.log');

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
  return ok;
};
const info = s => console.log(`     ${s}`);

function pidsOf(image) {
  try {
    return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
    })
      .split('\n')
      .map(l => l.split('","')[1])
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}
const ps = (script, ...args) =>
  execFileSync('powershell', ['-NoProfile', '-File', path.join(root, script), ...args], {
    encoding: 'utf8',
  });

// ---------------------------------------------------------------------------------------------
// fixtures
const FIXTURE = 'typical';
if (fs.existsSync(path.join(root, '.bench', 'fixtures', FIXTURE, 'slobs-client'))) {
  execFileSync(
    process.execPath,
    [path.join(root, 'scripts/fixtures/copy-collections.mjs'), FIXTURE, dir],
    { stdio: 'ignore' },
  );
} else {
  const COLL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const hk = { schemaVersion: 2, nodeType: 'HotkeysNode', items: [] };
  fs.mkdirSync(path.join(dir, 'SceneCollections'));
  fs.writeFileSync(
    path.join(dir, 'SceneCollections', `${COLL}.json`),
    JSON.stringify({
      schemaVersion: 5,
      nodeType: 'RootNode',
      sources: { schemaVersion: 5, nodeType: 'SourcesNode', items: [] },
      scenes: {
        schemaVersion: 1,
        nodeType: 'ScenesNode',
        items: [
          {
            hotkeys: hk,
            filters: { schemaVersion: 1, nodeType: 'SceneFiltersNode', items: [] },
            sceneItems: { schemaVersion: 1, nodeType: 'SceneItemsNode', items: [] },
            id: 'scene_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'Scene',
            active: true,
          },
        ],
      },
      transitions: {
        schemaVersion: 2,
        nodeType: 'TransitionsNode',
        transitions: [
          {
            id: 'transition-0000-4000-8000-000000000007',
            name: 'Global Transition',
            type: 'cut_transition',
            duration: 300,
            settings: {},
            propertiesManagerSettings: {},
          },
        ],
        connections: [],
        defaultTransitionId: 'transition-0000-4000-8000-000000000007',
      },
      hotkeys: hk,
      guestCam: {
        schemaVersion: 1,
        nodeType: 'GuestCamNode',
        audioSourceId: '',
        videoSourceId: '',
      },
      relativeCoordinates: true,
      baseResolution: { baseWidth: 1920, baseHeight: 1080 },
      baseResolutions: {
        horizontal: { baseWidth: 1920, baseHeight: 1080 },
        vertical: { baseWidth: 720, baseHeight: 1280 },
      },
      selectiveRecording: false,
      dualOutputMode: false,
      operatingSystem: 'win32',
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'SceneCollections', 'manifest.json'),
    JSON.stringify({
      activeId: COLL,
      collections: [
        {
          id: COLL,
          name: 'Dialogs e2e',
          modified: new Date().toISOString(),
          auto: false,
          operatingSystem: 'win32',
          deleted: false,
          needsRename: false,
        },
      ],
    }),
  );
}
const PNG = path.join(dir, 'e2e-image.png');
fs.copyFileSync(path.join(root, 'media', 'images', '16x9.png'), PNG);
const pngBuf = fs.readFileSync(PNG);
const PNG_W = pngBuf.readUInt32BE(16);
const PNG_H = pngBuf.readUInt32BE(20);

// ---------------------------------------------------------------------------------------------
// page-side hooks, installed in every window of the context (main and dialogs)
const INIT = `(() => {
  if (location.protocol !== 'slbundle:') return;
  const post = MessagePort.prototype.postMessage;
  let port;
  const waiters = new Map();
  let nid = 9000000;
  MessagePort.prototype.postMessage = function (m, ...rest) {
    if (!port && m && (m.type === 'sub' || m.type === 'call')) {
      port = this;
      this.addEventListener('message', ev => {
        const d = ev.data;
        if (d && d.type === 'result' && waiters.has(d.id)) {
          const w = waiters.get(d.id);
          waiters.delete(d.id);
          if (d.ok) w.resolve(d.value);
          else w.reject(new Error(d.error.code + ': ' + d.error.message));
        }
      });
    }
    return post.call(this, m, ...rest);
  };
  // test RPC: same wire message the window's core client sends
  window.__rpc = (target, method, ...args) => new Promise((resolve, reject) => {
    const id = nid++;
    waiters.set(id, { resolve, reject });
    post.call(port, { type: 'call', id, target, method, args });
  });
  // timing: epoch ms of the user click (main) and of the first painted dialog content (dialogs)
  const stamp = () => (window.__tClick = Date.now());
  window.addEventListener('click', stamp, true);
  window.addEventListener('dblclick', stamp, true);
  if (/dialog-/.test(location.pathname)) {
    const painted = (key, sel) => {
      if (window[key]) return;
      const el = document.querySelector(sel);
      if (!el || (key === '__paintForm' && !el.children.length)) return;
      window[key] = -1;
      requestAnimationFrame(() => requestAnimationFrame(() => (window[key] = Date.now())));
    };
    new MutationObserver(() => {
      painted('__paint', '[data-testid="dialog-body"]');
      painted('__paintForm', '[data-testid="property-form"]');
    }).observe(document, { childList: true, subtree: true });
  }
})()`;

// ---------------------------------------------------------------------------------------------
// app control
let child;
let exited;
let browser;
let ctx;
let main;
const beforeObs = new Set(pidsOf('obs64.exe'));
const beforeCrash = new Set(pidsOf('crash-handler-process.exe'));
const coreLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');

async function waitFor(f, what, ms = 30_000, step = 100) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try {
      v = await f();
    } catch {
      // not yet
    }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(step);
  }
}

async function launch() {
  fs.rmSync(logFile, { force: true });
  child = spawn(
    electron,
    [
      '.',
      `--remote-debugging-port=${port}`,
      '--disable-features=CalculateNativeWinOcclusion',
      '--force-device-scale-factor=1',
    ],
    {
      cwd: root,
      env: { ...process.env, SLOBS_USERDATA_DIR: dir, SLOBS_CORE_LOG: logFile },
      stdio: 'ignore',
    },
  );
  exited = new Promise(r => child.on('exit', r));
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${port}/json`)).ok,
    'CDP endpoint',
    60_000,
    300,
  );
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  ctx = browser.contexts()[0];
  await ctx.addInitScript(INIT);
  main = await waitFor(
    () => ctx.pages().find(p => p.url().includes('main.html')),
    'main page',
    30_000,
  );
  await waitFor(() => coreLog().includes('[perf] mark ready'), 'core ready', 90_000, 300);
  await main.reload(); // pick up the init script
  await main.waitForSelector('[data-testid=scene-row]', { timeout: 60_000 });
}

async function quit() {
  const s = await browser.newBrowserCDPSession();
  s.send('Browser.close').catch(() => {}); // the socket closes with the app: never resolves
  await Promise.race([exited, sleep(60_000)]);
  let left = [];
  for (let i = 0; i < 120; i++) {
    left = pidsOf('obs64.exe').filter(p => !beforeObs.has(p));
    if (!left.length) break;
    await sleep(500);
  }
  return left.length === 0;
}

// ---------------------------------------------------------------------------------------------
// helpers
/** Runs an action that closes its own window; "target closed" during it is the expected outcome. */
async function closing(fn) {
  try {
    await fn();
  } catch (e) {
    if (!/closed/i.test(e.message)) throw e;
  }
}
const rpc = (page, target, method, ...args) =>
  page.evaluate(([t, m, a]) => window.__rpc(t, m, ...a), [target, method, args]);
const dialogPages = () => ctx.pages().filter(p => /dialog-/.test(p.url()));
async function dialogPage(sub, ms = 15_000) {
  return waitFor(
    () => dialogPages().find(p => !sub || p.url().includes(sub)),
    `dialog ${sub ?? ''}`,
    ms,
    30,
  );
}
async function dialogClosed(ms = 10_000) {
  await waitFor(() => dialogPages().length === 0, 'dialog window to close', ms, 50);
}
async function closeLeftoverDialogs() {
  for (const p of dialogPages()) {
    await p.evaluate(() => window.reborn.window.close()).catch(() => {});
  }
  if (dialogPages().length) await dialogClosed().catch(() => {});
}
const shotMain = name => {
  const out = path.join(shotDir, name);
  ps('scripts/ui-reference/shot-title.ps1', '-Title', 'Streamlabs*', '-Out', out);
  return out;
};
const shotDialog = (title, name) => {
  const out = path.join(shotDir, name);
  ps('scripts/ui-reference/shot-title.ps1', '-Title', title, '-Out', out);
  return out;
};
const sourceRows = () =>
  main.evaluate(() =>
    [...document.querySelectorAll('[data-testid=source-row]')].map(e => ({
      id: e.dataset.rowId,
      name: e.querySelector('span.mr-auto')?.textContent.trim(),
      selected: e.dataset.selected === 'true',
    })),
  );
const sceneRows = () =>
  main.evaluate(() =>
    [...document.querySelectorAll('[data-testid=scene-row]')].map(e => ({
      id: e.dataset.rowId,
      name: e.querySelector('span')?.textContent.trim(),
      active: e.getAttribute('aria-current') === 'true',
    })),
  );
const geometry = () => rpc(main, 'editor', 'getGeometry');
const rowByName = async name => (await sourceRows()).find(r => r.name === name);
const innerSize = p => p.evaluate(() => [window.innerWidth, window.innerHeight]);
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

const timings = [];
async function timing(label, dlg) {
  const t = await main.evaluate(() => window.__tClick);
  const p = await waitFor(
    async () => {
      const v = await dlg.evaluate(() => window.__paint);
      return v > 0 ? v : 0;
    },
    `${label} first paint`,
    15_000,
    20,
  );
  const form = await dlg
    .evaluate(() => (window.__paintForm > 0 ? window.__paintForm : 0))
    .catch(() => 0);
  timings.push({ label, ms: p - t, formMs: form ? form - t : undefined });
  info(`${label}: click -> first paint ${p - t} ms${form ? `, form ${form - t} ms` : ''}`);
}

async function setField(page, sel, value) {
  const el = page.locator(sel).first();
  await el.fill(String(value));
  await el.press('Tab'); // blur -> `change`, as a user leaving the field
}

/** Opens Add Source from the sources "+", picks a tile, continues; returns the dialog page. */
async function openAddSource(typeId, measure) {
  await main.locator('[data-testid=source-add]').click();
  const dlg = await dialogPage('dialog-source-showcase');
  if (measure) {
    await timing(measure, dlg);
    const [w, h] = await innerSize(dlg);
    check(near(w, 900) && near(h, 700), `Add Source showcase size ${w}x${h} (expect 900x700)`);
  }
  await dlg.locator(`[data-testid=source-tile][data-id=${typeId}]`).first().click();
  await closing(() => dlg.locator('[data-testid=showcase-add]').click());
  // in place replace = a NEW window (hidden until its page is ready) takes the place of the old one
  const naming = await dialogPage('dialog-add-source');
  await waitFor(() => dialogPages().length === 1, 'old dialog window destroyed');
  return naming;
}
async function nameAndAdd(dlg, name, { forceNew = false } = {}) {
  await dlg.waitForSelector('[data-testid=add-source]');
  if (forceNew) {
    const sw = dlg.locator('[data-testid=new-instead] [role=switch]');
    if (await sw.count()) await sw.click();
  }
  const input = dlg.locator('[data-testid=name-input]');
  await input.fill(name);
  await closing(() => dlg.locator('[data-testid=add-submit]').click());
  const props = await dialogPage('dialog-source-properties');
  await waitFor(() => dialogPages().length === 1, 'old dialog window destroyed');
  await props.waitForSelector('[data-testid=property-form] [data-testid=prop-row]', {
    timeout: 15_000,
  });
  return props;
}

// pixel analysis of a PNG inside a page (no PNG decoder dependency)
async function pixels(pngPath, queries) {
  const b64 = fs.readFileSync(pngPath).toString('base64');
  return main.evaluate(
    async ([data, qs]) => {
      const bin = atob(data); // (fetch(data:) is blocked by the page CSP)
      const blob = new Blob([Uint8Array.from(bin, ch => ch.charCodeAt(0))], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const px = (x, y) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)];
      // canvas box: bounding box of the non-background pixels of the preview area (bg #3d5560)
      const area = g.getImageData(20, 94, bmp.width - 40, 376); // inside the preview area, clear of the window frame
      let x0 = 1e9,
        y0 = 1e9,
        x1 = -1,
        y1 = -1;
      for (let y = 0; y < area.height; y++)
        for (let x = 0; x < area.width; x++) {
          const i = (y * area.width + x) * 4;
          const d =
            Math.abs(area.data[i] - 0x3d) +
            Math.abs(area.data[i + 1] - 0x55) +
            Math.abs(area.data[i + 2] - 0x60);
          if (d > 24) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
      const box = { x: x0 + 20, y: y0 + 94, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      return {
        box,
        samples: qs.map(([bx, by, bw, bh]) =>
          px(box.x + (bx / bw) * box.w, box.y + (by / bh) * box.h),
        ),
      };
    },
    [b64, queries],
  );
}
const isColor = (rgb, [r, g, b], tol = 40) =>
  Math.abs(rgb[0] - r) <= tol && Math.abs(rgb[1] - g) <= tol && Math.abs(rgb[2] - b) <= tol;

// ---------------------------------------------------------------------------------------------
const created = {}; // ids and names created by the steps
const mem = {}; // private working set (MB per process image) of the Electron tree
const step = async (name, fn) => {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    check(false, `${name}: ${e.message.split('\n')[0]}`);
    try {
      shotMain(`fail-${name.replace(/\W+/g, '-').slice(0, 30)}.png`);
    } catch {
      // ignore
    }
  }
  await closeLeftoverDialogs();
};

const SCENE_NAME = 'E2E Scene';
const SCENE_RENAMED = 'E2E Scene Renamed';
const IMG_NAME = 'E2E Image';
const COLOR_NAME = 'E2E Color';
const TEXT_NAME = 'E2E Text';
const BROWSER_NAME = 'E2E Browser';

let exitCode = 1;
try {
  await launch();
  const startScenes = (await sceneRows()).length;
  const startSources = (await sourceRows()).length;
  info(`start: ${startScenes} scene(s), ${startSources} source(s) in the active scene`);
  await sleep(1500);

  // 1 ------------------------------------------------------------------------------------------
  await step('1 scenes: create and rename', async () => {
    await main.locator('[data-testid=scene-add]').click();
    const dlg = await dialogPage('dialog-name-scene');
    await timing('Name Scene', dlg);
    check(
      (await dlg.locator('[data-testid=dialog-title]').textContent()).includes('Name Scene'),
      'Name Scene window title',
    );
    const [w, h] = await innerSize(dlg);
    check(near(w, 400) && near(h, 250), `Name Scene size ${w}x${h} (expect 400x250)`);
    const input = dlg.locator('[data-testid=name-input]');
    check((await input.inputValue()) === 'New Scene', 'suggested name is "New Scene"');
    await input.fill(SCENE_NAME);
    await closing(() => dlg.locator('[data-testid=name-ok]').click());
    await dialogClosed();
    check(true, 'Name Scene window closed after Done');
    await waitFor(async () => (await sceneRows()).some(r => r.name === SCENE_NAME), 'scene row');
    const row = (await sceneRows()).find(r => r.name === SCENE_NAME);
    check(!!row?.active, 'new scene appears and is active');
    created.sceneId = row?.id;

    // rename: F2 on the focused row = store.startRename(), the same call the context menu makes
    await main.locator(`[data-testid=scene-row][data-row-id="${created.sceneId}"]`).focus();
    await main.keyboard.press('F2');
    const rd = await dialogPage('dialog-name-scene');
    await rd.waitForSelector('[data-testid=name-input]');
    check(
      (await rd.locator('[data-testid=dialog-title]').textContent()).includes('Rename Scene'),
      'Rename Scene window title',
    );
    check(
      (await rd.locator('[data-testid=name-input]').inputValue()) === SCENE_NAME,
      'rename prefilled',
    );
    await rd.locator('[data-testid=name-input]').fill(SCENE_RENAMED);
    await closing(() => rd.locator('[data-testid=name-input]').press('Enter')); // Enter submits (legacy)
    await dialogClosed();
    await waitFor(async () => (await sceneRows()).some(r => r.name === SCENE_RENAMED), 'renamed');
    const rows = await sceneRows();
    check(
      rows.length === startScenes + 1 && !rows.some(r => r.name === SCENE_NAME),
      'scene renamed',
    );
    check(!!rows.find(r => r.name === SCENE_RENAMED)?.active, 'renamed scene stays active');
    // empty name: Done must not close
    await main.locator(`[data-testid=scene-row][data-row-id="${created.sceneId}"]`).focus();
    await main.keyboard.press('F2');
    const ed = await dialogPage('dialog-name-scene');
    await ed.locator('[data-testid=name-input]').fill('');
    await closing(() => ed.locator('[data-testid=name-ok]').click());
    await sleep(500);
    check(
      dialogPages().length === 1 && (await ed.locator('[data-testid=name-error]').count()) === 1,
      'empty name is rejected inline and the window stays open',
    );
    await closing(() => ed.locator('[data-testid=name-cancel]').click());
    await dialogClosed();
  });

  // 2 ------------------------------------------------------------------------------------------
  await step('2 image source: add, properties in place, set file', async () => {
    let dlg = await openAddSource('image_source', 'Add Source (showcase)');

    const [w, h] = await innerSize(dlg);
    check(near(w, 600) && near(h, 320), `Add Source naming size ${w}x${h} (expect 600x320)`);
    check(dialogPages().length === 1, 'one dialog window while navigating showcase -> naming');
    const existing = await dlg.locator('[data-testid=existing-list] li').count();
    check(existing >= 1, `Add Existing Source list shown for an existing Image (${existing})`);
    const winBefore = dlg;
    dlg = await nameAndAdd(dlg, IMG_NAME, { forceNew: true });
    check(
      dialogPages().length === 1 && dialogPages()[0] === dlg && dlg !== winBefore,
      'properties replaces the dialog in place (one window left, the new one)',
    );
    const [pw, ph] = await innerSize(dlg);
    check(near(pw, 600) && near(ph, 800), `Source Properties size ${pw}x${ph} (expect 600x800)`);
    check(
      (await dlg.title()).includes('Settings for Image'),
      `window title "${await dlg.title()}"`,
    );
    const row = await rowByName(IMG_NAME);
    check(!!row, 'new source row in the sources list');
    created.imageItemId = row?.id;
    await setField(dlg, '[data-testid=prop-file] [data-testid=path-input]', PNG);
    const g = await waitFor(
      async () => {
        const geo = await geometry();
        const it = geo?.items.find(i => i.id === created.imageItemId);
        return it && it.width === PNG_W && it.height === PNG_H ? it : null;
      },
      'image size to follow the file',
      15_000,
      200,
    );
    check(!!g, `image source is ${PNG_W}x${PNG_H} after setting the file path`);
    created.imageSourceId = g?.sourceId;
    await sleep(700);
    shotDialog('Settings for*', 'step2-image-properties.png');
    shotMain('step2-image-main.png');
    await closing(() => dlg.locator('[data-testid=props-done]').click());
    await dialogClosed();
    check(true, 'Source Properties closed with Done');
  });

  // 3 ------------------------------------------------------------------------------------------
  await step('3 color source: color and width', async () => {
    let dlg = await openAddSource('color_source');
    dlg = await nameAndAdd(dlg, COLOR_NAME);
    const row = await rowByName(COLOR_NAME);
    created.colorItemId = row?.id;
    await setField(dlg, '[data-testid=prop-color] [data-testid=color-hex]', '#00ff00ff');
    await sleep(1200);
    const geo0 = await waitFor(async () => {
      const g = (await geometry())?.items.find(i => i.id === created.colorItemId);
      return g?.width ? g : null;
    }, 'color source geometry');
    info(`color source size ${geo0.width}x${geo0.height}`);
    const gAll = await geometry();
    const base = { w: gAll.baseWidth, h: gAll.baseHeight };
    const xr = base.w - 100; // right of the 400 px wide item, inside the canvas
    const p1 = shotMain('step3-color-green.png');
    const r1 = await pixels(p1, [
      [geo0.width / 2, geo0.height / 2, base.w, base.h],
      [xr, geo0.height / 2, base.w, base.h],
    ]);
    check(
      isColor(r1.samples[0], [0, 255, 0]),
      `preview shows the new color inside the item (rgb ${r1.samples[0]})`,
    );
    check(
      !isColor(r1.samples[1], [0, 255, 0]),
      `preview right of the item is not green yet (rgb ${r1.samples[1]})`,
    );
    await setField(dlg, '[data-testid=prop-width]', base.w);
    const g2 = await waitFor(
      async () => {
        const g = (await geometry())?.items.find(i => i.id === created.colorItemId);
        return g?.width === base.w ? g : null;
      },
      'width to apply',
      10_000,
      200,
    );
    created.colorWidth = base.w;
    check(!!g2, `width property applied (source is ${base.w} wide)`);
    await sleep(1200);
    const p2 = shotMain('step3-color-wide.png');
    const r2 = await pixels(p2, [[xr, geo0.height / 2, base.w, base.h]]);
    check(
      isColor(r2.samples[0], [0, 255, 0]),
      `preview shows the width change (rgb ${r2.samples[0]})`,
    );
    await setField(dlg, '[data-testid=prop-color] [data-testid=color-hex]', '#ff0000ff');
    await sleep(1200);
    const r3 = await pixels(shotMain('step3-color-red.png'), [
      [xr, geo0.height / 2, base.w, base.h],
    ]);
    check(
      isColor(r3.samples[0], [255, 0, 0]),
      `preview shows the second color change (rgb ${r3.samples[0]})`,
    );
    await closing(() => dlg.locator('[data-testid=props-close]').click());
    await dialogClosed();
  });

  // 4 ------------------------------------------------------------------------------------------
  await step('4 text source: text, font size, font family list', async () => {
    let dlg = await openAddSource('text_gdiplus');
    dlg = await nameAndAdd(dlg, TEXT_NAME);
    created.textItemId = (await rowByName(TEXT_NAME))?.id;
    const text0 = await dlg.locator('[data-testid=prop-text]').inputValue();
    check(text0 === TEXT_NAME, 'text defaults to the source name');
    const size = async () =>
      (await geometry())?.items.find(i => i.id === created.textItemId) ?? { width: 0, height: 0 };
    const before = await waitFor(
      async () => ((await size()).height ? await size() : null),
      'text size',
    );
    await setField(dlg, '[data-testid=prop-text]', 'E2E hello world, a longer text');
    const wider = await waitFor(
      async () => {
        const s = await size();
        return s.width > before.width ? s : null;
      },
      'text change to resize the source',
      10_000,
      200,
    );
    check(!!wider, `text change applied (width ${before.width} -> ${wider?.width})`);
    // font size slider (React-style range input): set through the real <input type=range>
    const fs0 = await size();
    await dlg.locator('[data-testid=prop-font-size]').evaluate(el => {
      el.value = '48';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const smaller = await waitFor(
      async () => {
        const s = await size();
        return s.height < fs0.height * 0.5 ? s : null;
      },
      'font size to apply',
      10_000,
      200,
    );
    check(!!smaller, `font size applied, smaller (height ${fs0.height} -> ${smaller?.height})`);
    // font family list from the core font service
    const fam = dlg.locator('[data-testid=font-family]');
    const n = await waitFor(
      async () => {
        const c = await fam.locator('option').count();
        return c > 3 ? c : 0;
      },
      'font families to load',
      15_000,
      200,
    );
    check(n > 3, `font family dropdown lists ${n} families`);
    const opts = await fam.locator('option').allTextContents();
    created.fontFamily =
      opts.find(o => o === 'Arial') ?? opts.find(o => o === 'Courier New') ?? opts[1];
    await fam.selectOption({ label: created.fontFamily });
    await sleep(800);
    check(
      (await fam.inputValue()) === created.fontFamily,
      'font family selection sticks after the refresh',
    );
    check(
      (await dlg.locator('[data-testid=font-style] option').count()) >= 1,
      'font styles listed for the family',
    );
    await sleep(500);
    shotDialog('Settings for*', 'step4-text-properties.png');
    await closing(() => dlg.locator('[data-testid=props-done]').click());
    await dialogClosed();
  });

  // 5 ------------------------------------------------------------------------------------------
  await step('5 browser source: custom frame rate toggle', async () => {
    let dlg = await openAddSource('browser_source');
    dlg = await nameAndAdd(dlg, BROWSER_NAME);
    created.browserItemId = (await rowByName(BROWSER_NAME))?.id;
    const toggle = dlg.locator('[data-testid=prop-fps_custom]');
    await toggle.waitFor();
    check((await dlg.locator('[data-testid=prop-fps]').count()) === 0, 'FPS field hidden at first');
    await toggle.click();
    await dlg.waitForSelector('[data-testid=prop-fps]', { timeout: 10_000 });
    check(true, '"Use custom frame rate" shows the FPS field (modified callback)');
    await toggle.click();
    await waitFor(
      async () => (await dlg.locator('[data-testid=prop-fps]').count()) === 0,
      'FPS to hide',
    );
    check(true, 'switching it off hides the FPS field again');
    await toggle.click(); // leave it on: the saved collection keeps `fps_custom`
    await dlg.waitForSelector('[data-testid=prop-fps]');
    shotDialog('Settings for*', 'step5-browser-properties.png');
    await closing(() => dlg.locator('[data-testid=props-close]').click());
    await dialogClosed();
  });

  // 6 ------------------------------------------------------------------------------------------
  await step('6 properties from the list: double-click, Cancel keeps edits', async () => {
    const id = created.textItemId;
    await main.locator(`[data-testid=source-row][data-row-id="${id}"]`).dblclick();
    const dlg = await dialogPage('dialog-source-properties');
    await timing('Source Properties (double-click)', dlg);
    await dlg.waitForSelector('[data-testid=prop-text]');
    await setField(dlg, '[data-testid=prop-text]', 'kept after cancel');
    await sleep(900);
    await closing(() => dlg.locator('[data-testid=props-cancel]').click());
    await dialogClosed();
    check(true, 'window closed with Cancel');
    await main.locator(`[data-testid=source-row][data-row-id="${id}"]`).dblclick();
    const d2 = await dialogPage('dialog-source-properties');
    await d2.waitForSelector('[data-testid=prop-text]');
    const v = await d2.locator('[data-testid=prop-text]').inputValue();
    check(v === 'kept after cancel', 'Cancel does not revert (legacy semantics)');
    await closing(() => d2.locator('[data-testid=props-cancel]').click());
    await dialogClosed();
  });

  // 7 ------------------------------------------------------------------------------------------
  await step('7 add existing source (second item of the same source)', async () => {
    const dlg = await openAddSource('image_source');
    await dlg.waitForSelector('[data-testid=existing-list]');
    const names = await dlg.locator('[data-testid=existing-list] li').allTextContents();
    check(names.map(s => s.trim()).includes(IMG_NAME), `existing list offers "${IMG_NAME}"`);
    await dlg.locator('[data-testid=existing-list] li', { hasText: IMG_NAME }).first().click();
    await closing(() => dlg.locator('[data-testid=add-submit]').click());
    await dialogClosed();
    check(true, 'dialog closed after adding an existing source');
    await waitFor(
      async () => (await sourceRows()).filter(r => r.name === IMG_NAME).length === 2,
      'second item',
    );
    const geo = await geometry();
    const items = geo.items.filter(i => i.sourceId === created.imageSourceId);
    check(items.length === 2, `two scene items share one source (${items.length})`);
    created.imageItem2 = items.find(i => i.id !== created.imageItemId)?.id;
    check(dialogPages().length === 0, 'no leftover dialog');
  });

  // 8 ------------------------------------------------------------------------------------------
  await step('8 remove with Delete; properties window of a removed source closes', async () => {
    const id = created.browserItemId;
    // open its properties, then remove the source from the main window
    await main.locator(`[data-testid=source-row][data-row-id="${id}"]`).dblclick();
    const dlg = await dialogPage('dialog-source-properties');
    await dlg.waitForSelector('[data-testid=prop-url]');
    await main.locator(`[data-testid=source-row][data-row-id="${id}"]`).click();
    await main.keyboard.press('Delete');
    await main.locator('[data-testid=confirm-dialog]').waitFor();
    check(true, 'Delete shows the confirm dialog');
    await main.locator('[data-testid=confirm-ok]').click();
    await waitFor(async () => !(await sourceRows()).some(r => r.id === id), 'row removal');
    check(true, 'source removed from the list');
    await dialogClosed(10_000);
    check(
      dialogPages().length === 0,
      'properties window of the removed source closed automatically',
    );
    // cancel keeps the source
    const keep = created.imageItem2;
    await main.locator(`[data-testid=source-row][data-row-id="${keep}"]`).click();
    await main.keyboard.press('Delete');
    await main.locator('[data-testid=confirm-dialog]').waitFor();
    await main.keyboard.press('Escape');
    await sleep(400);
    check(
      (await sourceRows()).some(r => r.id === keep),
      'Escape on the confirm dialog keeps the source',
    );
  });

  // 9 ------------------------------------------------------------------------------------------
  const expected = {};
  await step('9 collection file after the save debounce', async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'SceneCollections/manifest.json'), 'utf8'),
    );
    const file = path.join(dir, 'SceneCollections', `${manifest.activeId}.json`);
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const liveItems = (await sourceRows()).length;
    const ok = c =>
      c.scenes.items.find(s => s.id === created.sceneId)?.sceneItems.items.length === liveItems &&
      c.sources.items.find(s => s.name === TEXT_NAME)?.settings?.text === 'kept after cancel' &&
      c.scenes.items.some(s => s.id === created.sceneId && s.name === SCENE_RENAMED) &&
      c.sources.items.some(s => s.name === TEXT_NAME) &&
      !c.sources.items.some(s => s.name === BROWSER_NAME);
    await waitFor(() => ok(read()), 'collection to be saved with the live state', 20_000, 500);
    const c = read();
    const src = n => c.sources.items.find(s => s.name === n);
    const scene = c.scenes.items.find(s => s.id === created.sceneId);
    check(!!scene, 'scene saved under its id with the renamed name');
    const types = [
      [IMG_NAME, 'image_source', 'file'],
      [COLOR_NAME, 'color_source', 'color'],
      [TEXT_NAME, 'text_gdiplus', 'text'],
    ];
    for (const [n, type, key] of types) {
      const s = src(n);
      check(s?.type === type, `source "${n}" saved with type ${type}`);
      check(!!s && s.settings && key in s.settings, `source "${n}" settings contain key "${key}"`);
      check(
        typeof s?.id === 'string' && s.id.startsWith(`${type}_`),
        `source "${n}" id has the "${type}_" prefix`,
      );
    }
    check(src(COLOR_NAME)?.settings?.width === created.colorWidth, 'color width persisted');
    check(src(TEXT_NAME)?.settings?.font?.face === created.fontFamily, 'text font face persisted');
    check(
      src(TEXT_NAME)?.settings?.text === 'kept after cancel',
      'text persisted (Cancel did not revert)',
    );
    check(src(IMG_NAME)?.settings?.file === PNG, 'image file path persisted');
    check(!src(BROWSER_NAME), 'removed browser source is not saved');
    const items = scene.sceneItems.items;
    const bySource = id => items.filter(i => i.sourceId === id);
    check(bySource(src(IMG_NAME)?.id).length === 2, 'scene has two items of the image source');
    check(bySource(src(COLOR_NAME)?.id).length === 1, 'scene has one color item');
    check(bySource(src(TEXT_NAME)?.id).length === 1, 'scene has one text item');
    expected.scenes = c.scenes.items.length;
    expected.sources = c.sources.items.length;
    expected.items = items.length;
    info(
      `saved: ${expected.scenes} scenes, ${expected.sources} sources, ${expected.items} items in the new scene`,
    );
  });

  // 10: memory + timing of fresh opens ------------------------------------------------------
  await step('10 timing', async () => {
    // repeat opens: Add Source, Name Scene, Source Properties (each one creates a fresh window)
    for (let i = 0; i < 2; i++) {
      await main.locator('[data-testid=source-add]').click();
      const d = await dialogPage('dialog-source-showcase');
      await timing(`Add Source (open #${i + 1})`, d);
      await d.evaluate(() => window.reborn.window.close());
      await dialogClosed();
      await main.locator('[data-testid=scene-add]').click();
      const n = await dialogPage('dialog-name-scene');
      await timing(`Name Scene (open #${i + 1})`, n);
      await n.evaluate(() => window.reborn.window.close());
      await dialogClosed();
    }
    for (let i = 0; i < 2; i++) {
      await main
        .locator(`[data-testid=source-row][data-row-id="${created.colorItemId}"]`)
        .dblclick();
      const d = await dialogPage('dialog-source-properties');
      await timing(`Source Properties (open #${i + 1})`, d);
      await d.evaluate(() => window.reborn.window.close());
      await dialogClosed();
    }
    const worst = Math.max(...timings.map(t => t.ms));
    check(worst <= 250, `all dialog opens <= 250 ms (worst ${worst} ms)`);
  });

  // 10b: the first VISIBLE frame of a dialog is its complete UI -------------------------------------
  // PrintWindow bursts (scripts/ui-reference/burst-titles.ps1) of the dialog window by title, started
  // before the click. Windows are created hidden and shown only when the page painted its first complete
  // render (src/ui/dialog/ready.ts), so the first frame that exists must not be the empty background.
  await step('10b first visible frame is complete', async () => {
    const burst = async (title, act) => {
      const out = fs.mkdtempSync(path.join(dir, 'burst-'));
      const ps = spawn(
        'powershell',
        [
          '-NoProfile',
          '-File',
          path.join(root, 'scripts/ui-reference/burst-titles.ps1'),
          '-TitlesCsv',
          title,
          '-OutDir',
          out,
          '-DurationMs',
          '1100',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      await new Promise(res => ps.stdout.on('data', d => String(d).includes('READY') && res()));
      const done = new Promise(res => ps.on('exit', res));
      await sleep(150);
      const dlg = await act();
      const click = await main.evaluate(() => window.__tClick);
      await done;
      await closeLeftoverDialogs();
      const frames = fs
        .readFileSync(path.join(out, 'frames.csv'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .map(l => l.trim().split(','))
        .map(c => ({ t: +c[0], hash: c[c.length - 3], colors: +c[c.length - 1] }));
      void dlg;
      if (!frames.length || !(frames[0].t > 0)) throw new Error('no frames captured');
      return { click, frames };
    };
    // mean of 3 opens each: a single PrintWindow capture can race the compositor, a real regression
    // (blank first frame) shows in every open
    const cases = [
      {
        label: 'Name Scene',
        title: 'Name Scene*',
        open: async () => {
          await main.locator('[data-testid=scene-add]').click();
          return dialogPage('dialog-name-scene');
        },
        sameAsFinal: false, // the focused input blinks its caret
      },
      {
        label: 'Add Source',
        title: 'Add Source*',
        open: async () => {
          await main.locator('[data-testid=source-add]').click();
          return dialogPage('dialog-source-showcase');
        },
        sameAsFinal: true,
      },
    ];
    for (const c of cases) {
      let complete = 0;
      let identical = 0;
      let worst = 0;
      for (let i = 0; i < 3; i++) {
        const { click, frames } = await burst(c.title, c.open);
        const first = frames[0];
        const last = frames[frames.length - 1];
        if (first.colors >= 20) complete++;
        if (first.hash === last.hash) identical++;
        worst = Math.max(worst, first.t - click);
      }
      check(complete >= 2, `${c.label}: first visible frame is not blank (${complete}/3 opens)`);
      if (c.sameAsFinal) {
        check(
          identical >= 2,
          `${c.label}: first visible frame == final frame (${identical}/3 opens)`,
        );
      }
      check(worst <= 250, `${c.label}: click -> first visible frame <= 250 ms (worst ${worst} ms)`);
    }
  });

  // restart: the collection reloads ---------------------------------------------------------
  await step('9b restart reloads the saved collection', async () => {
    const quitOk = await quit();
    check(quitOk, 'app quit gracefully and obs64 exited (first run)');
    await launch();
    const scenes = await sceneRows();
    check(
      scenes.length === expected.scenes,
      `scenes after restart: ${scenes.length} (expect ${expected.scenes})`,
    );
    const act = scenes.find(s => s.active);
    check(act?.name === SCENE_RENAMED, 'the renamed scene is the active one after restart');
    const rows = await sourceRows();
    check(
      rows.length === expected.items,
      `scene items after restart: ${rows.length} (expect ${expected.items})`,
    );
    const names = rows
      .map(r => r.name)
      .sort()
      .join('|');
    check(
      [IMG_NAME, IMG_NAME, COLOR_NAME, TEXT_NAME].sort().join('|') === names,
      'the same sources are listed after restart',
    );
    const geo = await geometry();
    const img = geo.items.find(i => i.sourceId && rows.find(r => r.id === i.id)?.name === IMG_NAME);
    check(img?.width === PNG_W, 'image source reloaded with its file');
    shotMain('step9-after-restart.png');
  });

  // memory in the freshly restarted app (no earlier activity): none / properties open / closed
  await step('11 memory', async () => {
    const total = list => Math.round(list.reduce((a, p) => a + p.mb, 0));
    const tree = () => {
      const j = JSON.parse(ps('scripts/ui-reference/mem-tree.ps1', '-RootPid', String(child.pid)));
      return Array.isArray(j) ? j : [j];
    };
    const electronMb = l => Math.round(l.find(p => p.name === 'electron')?.mb ?? 0);
    await sleep(5000);
    mem.none = tree();
    const colorRow = await rowByName(COLOR_NAME);
    await main.locator(`[data-testid=source-row][data-row-id="${colorRow.id}"]`).dblclick();
    const d = await dialogPage('dialog-source-properties');
    await d.waitForSelector('[data-testid=property-form] [data-testid=prop-row]');
    await sleep(4000);
    mem.open = tree();
    await d.evaluate(() => window.reborn.window.close());
    await dialogClosed();
    await sleep(5000);
    mem.closed = tree();
    info(
      `electron private WS: none ${electronMb(mem.none)} MB, properties open ${electronMb(mem.open)} MB, closed ${electronMb(mem.closed)} MB`,
    );
    info(
      `tree total (incl. obs64): none ${total(mem.none)} MB, open ${total(mem.open)} MB, closed ${total(mem.closed)} MB`,
    );
    check(
      electronMb(mem.closed) <= electronMb(mem.none) + 15,
      `memory returns to baseline after closing (${electronMb(mem.none)} -> ${electronMb(mem.closed)} MB)`,
    );
  });

  exitCode = failures.length ? 1 : 0;
} catch (e) {
  console.error('test failed:', e.stack ?? e.message);
  console.error(coreLog().split('\n').slice(-15).join('\n'));
} finally {
  let left = true;
  try {
    left = !(await quit());
  } catch {
    // app already gone
  }
  if (left && child && child.exitCode === null) child.kill();
  for (const pid of pidsOf('crash-handler-process.exe').filter(p => !beforeCrash.has(p))) {
    try {
      process.kill(pid);
    } catch {
      // gone
    }
  }
  const leftovers = pidsOf('obs64.exe').filter(p => !beforeObs.has(p));
  if (leftovers.length) {
    console.log(`FAIL leftover obs64 ${leftovers.join(',')}`);
    exitCode = 1;
  }
  fs.writeFileSync(
    path.join(shotDir, 'results.json'),
    JSON.stringify({ timings, failures, mem }, null, 2),
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('\ntimings (click -> first paint, ms):');
for (const t of timings)
  console.log(`  ${t.label}: ${t.ms}${t.formMs ? ` (form ${t.formMs})` : ''}`);
console.log(exitCode === 0 ? 'dialogs e2e: OK' : `dialogs e2e: FAILED (${failures.join('; ')})`);
process.exit(exitCode);
