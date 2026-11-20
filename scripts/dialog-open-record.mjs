/* global window */
// Records how each dialog window opens, frame by frame (diagnosis and verification of "dialogs appear
// instantly complete"). Usage: node scripts/dialog-open-record.mjs <outDir>
//   e.g. node scripts/dialog-open-record.mjs test-results/dialog-open/before
// Everything is driven through CDP (no OS input, CLAUDE.md "Automation safety"). Frames are PrintWindow
// bursts of the dialog windows by title (scripts/ui-reference/burst-titles.ps1, ~10 ms apart); the timeline
// merges the main process trace (SLOBS_TRACE_DIALOG), page events and the burst. Output per scenario:
// <outDir>/<scenario>/{f*.png, frames.csv, timeline.json}, plus <outDir>/summary.json.
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
const outRoot = path.resolve(process.argv[2] || path.join(root, 'test-results/dialog-open/run'));
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slobs-dlgrec-'));
const port = 9400 + Math.floor(Math.random() * 500);
const logFile = path.join(dir, 'core.log');
execFileSync(
  process.execPath,
  [path.join(root, 'scripts/fixtures/copy-collections.mjs'), 'typical', dir],
  { stdio: 'ignore' },
);

const pidsOf = image => {
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
};
const beforeObs = new Set(pidsOf('obs64.exe'));

const INIT = `(() => {
  const ev = (name, extra) => console.debug('__EV ' + JSON.stringify({ name, t: Date.now(), ...extra }));
  if (location.protocol !== 'slbundle:' || !/dialog-/.test(location.pathname)) return;
  const loadedFonts = () => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight);
  ev('script', { page: location.pathname });
  document.addEventListener('DOMContentLoaded', () => ev('DOMContentLoaded'));
  window.addEventListener('load', () => ev('load'));
  new PerformanceObserver(l => l.getEntries().forEach(e => ev(e.name, { t: Math.round(performance.timeOrigin + e.startTime) })))
    .observe({ type: 'paint', buffered: true });
  document.fonts.ready.then(() => ev('fonts.ready', { fonts: loadedFonts() }));
  document.fonts.addEventListener('loadingdone', () => ev('fonts.loadingdone', { fonts: loadedFonts() }));
  const seen = {};
  const watch = (key, sel) => {
    if (seen[key]) return;
    const el = document.querySelector(sel);
    if (!el || (key === 'form' && !el.children.length)) return;
    seen[key] = 1;
    ev('dom:' + key, { fonts: loadedFonts() });
  };
  new MutationObserver(() => {
    watch('layout', '[data-testid="dialog"]');
    watch('form', '[data-testid="property-form"]');
    watch('preview', '[data-testid="source-preview"]');
  }).observe(document, { childList: true, subtree: true });
  window.addEventListener('resize', () => ev('resize', { w: innerWidth, h: innerHeight }));
})()`;

let child;
let exited;
const traceLines = [];
const pageEvents = [];
let buf = '';
function launch() {
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
      env: {
        ...process.env,
        SLOBS_USERDATA_DIR: dir,
        SLOBS_CORE_LOG: logFile,
        SLOBS_TRACE_DIALOG: '1',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  child.stdout.on('data', d => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) {
      const m = /\[dialog-trace\] (\d+) (\S+) ?(\d*)/.exec(l);
      if (m) traceLines.push({ t: +m[1], name: 'main:' + m[2], win: m[3] });
    }
  });
  exited = new Promise(r => child.on('exit', r));
}
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

launch();
await waitFor(
  async () => (await fetch(`http://127.0.0.1:${port}/json`)).ok,
  'CDP endpoint',
  60_000,
  300,
);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const ctx = browser.contexts()[0];
await ctx.addInitScript(INIT);
ctx.on('console', m => {
  const t = m.text();
  if (t.startsWith('__EV ')) pageEvents.push(JSON.parse(t.slice(5)));
});
const main = await waitFor(
  () => ctx.pages().find(p => p.url().includes('main.html')),
  'main',
  30_000,
);
await waitFor(
  () => fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('[perf] mark ready'),
  'core ready',
  90_000,
  300,
);
await main.reload();
await main.waitForSelector('[data-testid=scene-row]', { timeout: 60_000 });
await sleep(1500);

const dialogPages = () => ctx.pages().filter(p => /dialog-/.test(p.url()));
const dialogPage = sub =>
  waitFor(
    () => dialogPages().find(p => !sub || p.url().includes(sub)),
    `dialog ${sub}`,
    15_000,
    10,
  );

function startBurst(name, titles, durationMs = 1400) {
  const out = path.join(outRoot, name);
  fs.mkdirSync(out, { recursive: true });
  const ps = spawn(
    'powershell',
    [
      '-NoProfile',
      '-File',
      path.join(root, 'scripts/ui-reference/burst-titles.ps1'),
      '-TitlesCsv',
      titles.join(','),
      '-OutDir',
      out,
      '-DurationMs',
      String(durationMs),
      ...(process.env.DLG_REC_SCREEN ? ['-Screen'] : []),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let output = '';
  const ready = new Promise(res =>
    ps.stdout.on('data', d => {
      output += d.toString();
      if (output.includes('READY')) res();
    }),
  );
  const done = new Promise(res => ps.on('exit', res));
  return { out, ready, done };
}

const summary = {};
/** One scenario: starts the burst, runs `act` (the click), waits for the burst, analyses. */
async function scenario(name, titles, act) {
  const burst = startBurst(name, titles);
  await burst.ready;
  await sleep(120);
  traceLines.length = 0;
  pageEvents.length = 0;
  const click = Date.now();
  await act();
  await burst.done;
  const events = [
    { name: 'click', t: click },
    ...traceLines.map(l => ({ name: l.name, t: l.t, win: l.win })),
    ...pageEvents,
  ].sort((a, b) => a.t - b.t);
  const csv = fs
    .readFileSync(path.join(burst.out, 'frames.csv'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const m = /^(\d+),(-?\d+),"(.*)",(\d+),(\d+),(-?\d+),([^,]*),(\d+)$/.exec(l.trim());
      return {
        t: +m[1],
        hwnd: m[2],
        title: m[3],
        w: +m[4],
        h: +m[5],
        hash: m[6],
        file: m[7],
        colors: +m[8],
      };
    });
  const wins = {};
  for (const f of csv) (wins[f.hwnd] ??= []).push(f);
  const perWindow = Object.entries(wins).map(([hwnd, list]) => {
    const looks = list.filter(f => f.file);
    const finalHash = list[list.length - 1].hash;
    const firstFinal = list.find(f => f.hash === finalHash);
    return {
      hwnd,
      title: list[0].title,
      firstVisibleMs: list[0].t - click,
      lastVisibleMs: list[list.length - 1].t - click,
      distinctFrames: looks.length,
      finalLookMs: firstFinal.t - click,
      sizes: [...new Set(list.map(f => `${f.w}x${f.h}`))],
      firstFrame: looks[0]?.file,
      finalFrame: looks[looks.length - 1]?.file,
      firstEqualsFinal: list[0].hash === finalHash,
      firstFrameColors: list[0].colors, // ~1 = a blank frame
    };
  });
  fs.writeFileSync(
    path.join(burst.out, 'timeline.json'),
    JSON.stringify(
      { click, events: events.map(e => ({ ...e, dt: e.t - click })), perWindow },
      null,
      1,
    ),
  );
  summary[name] = perWindow;
  console.log(`\n== ${name}`);
  for (const e of events) {
    console.log(
      `  ${String(e.t - click).padStart(5)} ms  ${e.name}${e.win ? ' #' + e.win : ''}${e.page ? ' ' + e.page : ''}${e.fonts ? ' fonts=' + e.fonts.length : ''}`,
    );
  }
  for (const w of perWindow) {
    console.log(
      `  window "${w.title}" ${w.hwnd}: first visible ${w.firstVisibleMs} ms, last ${w.lastVisibleMs} ms, ${w.distinctFrames} distinct frame(s), final look at ${w.finalLookMs} ms, first==final ${w.firstEqualsFinal}, first-frame colors ${w.firstFrameColors}, sizes ${w.sizes.join(',')}`,
    );
  }
}
const closeDialogs = async () => {
  for (const p of dialogPages()) {
    await p.evaluate(() => window.reborn.window.close()).catch(() => {});
  }
  await waitFor(() => dialogPages().length === 0, 'dialogs closed', 10_000, 50).catch(() => {});
  await sleep(400);
};

try {
  // 1. Name Scene (first dialog of the process = cold), 2. again (warm)
  await scenario('name-scene', ['Name Scene*'], async () => {
    await main.locator('[data-testid=scene-add]').click();
    await dialogPage('dialog-name-scene');
  });
  await closeDialogs();
  await scenario('name-scene-warm', ['Name Scene*'], async () => {
    await main.locator('[data-testid=scene-add]').click();
    await dialogPage('dialog-name-scene');
  });
  await closeDialogs();

  // V8 code cache: later opens of the same page compile less (script -> load in the timeline)
  for (const n of [3, 4]) {
    await scenario(`name-scene-${n}`, ['Name Scene*'], async () => {
      await main.locator('[data-testid=scene-add]').click();
      await dialogPage('dialog-name-scene');
    });
    await closeDialogs();
  }

  // 3. Add Source showcase
  await scenario('add-source-showcase', ['Add Source*'], async () => {
    await main.locator('[data-testid=source-add]').click();
    await dialogPage('dialog-source-showcase');
  });
  const showcase = await dialogPage('dialog-source-showcase');
  await sleep(500);
  // 4. showcase -> naming (replace in place)
  await scenario('add-source-naming', ['Add Source*'], async () => {
    await showcase.locator('[data-testid=source-tile][data-id=color_source]').first().click();
    await showcase.locator('[data-testid=showcase-add]').click();
    await waitFor(
      () => dialogPages().some(p => p.url().includes('dialog-add-source')),
      'naming',
      15_000,
      10,
    );
  });
  const naming = await dialogPage('dialog-add-source');
  await naming.waitForSelector('[data-testid=add-source]');
  await sleep(500);
  // 5. naming -> Source Properties (replace in place)
  await scenario('source-properties-from-add', ['Add Source*', 'Settings for*'], async () => {
    await naming.locator('[data-testid=name-input]').fill('Rec Color');
    await naming
      .locator('[data-testid=add-submit]')
      .click()
      .catch(() => {});
    await waitFor(
      () => dialogPages().some(p => p.url().includes('dialog-source-properties')),
      'props',
      15_000,
      10,
    );
  });
  await sleep(800);
  await closeDialogs();

  // 6. Source Properties via double-click on a source row
  await scenario('source-properties-dblclick', ['Settings for*'], async () => {
    await main.locator('[data-testid=source-row]').first().dblclick();
    await dialogPage('dialog-source-properties');
  });
  await closeDialogs();
} catch (e) {
  console.error('FAILED', e);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(summary, null, 1));
  const s = await browser.newBrowserCDPSession();
  s.send('Browser.close').catch(() => {});
  await Promise.race([exited, sleep(60_000)]);
  for (let i = 0; i < 120; i++) {
    if (!pidsOf('obs64.exe').filter(p => !beforeObs.has(p)).length) break;
    await sleep(500);
  }
  process.exit(process.exitCode ?? 0);
}
