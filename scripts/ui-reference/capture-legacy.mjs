// Captures the LEGACY Streamlabs Desktop editor for UI parity work.
//   node scripts/ui-reference/capture-legacy.mjs [--no-launch] [--out <dir>] [--sizes 1280x800,1920x1080]
// Prereqs: worktree `../legacy-ref` at b995c47ff, installed + `yarn compile`d; `npm i playwright-core` in
// %TEMP%/pw (or set PW_DIR). Launches legacy with a FRESH throw-away profile under os.tmpdir() (never the
// real %APPDATA%\slobs-client), skips onboarding with SLD_TESTS_SKIP_ONBOARDING (same flag the legacy e2e
// tests use), stays logged out. Windows only. Window sizes are OUTER sizes in physical px with
// --force-device-scale-factor=1 (CSS viewport is 16x8 px smaller: 1264x792 / 1904x1072).
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
const outDir = path.resolve(opt('--out', path.join(root, 'docs/rework/ui-reference/editor')));
const sizes = opt('--sizes', '1280x800,1920x1080')
  .split(',')
  .map(s => s.split('x').map(Number));
const profile = path.join(os.tmpdir(), 'legacy-ref-profile');
fs.mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ps = (script, ...a) =>
  execFileSync('powershell', ['-NoProfile', '-File', path.join(here, script), ...a])
    .toString()
    .trim();
const menu = (...a) => ps('menu.ps1', ...a);
const png = name => path.join(outDir, name + '.png').replace(/\\/g, '/');

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
  const child = spawn(
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
  );
  child.unref();
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
await sleep(6000); // OBS preview + volmeters settle

// ---- helpers ------------------------------------------------------------------------------------------
const center = (sel, nth = 0) =>
  ev(
    ({ sel, nth }) => {
      const e = document.querySelectorAll(sel)[nth];
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
    },
    { sel, nth },
  );
const need = async (sel, nth = 0) => {
  const c = await center(sel, nth);
  if (!c) throw new Error('missing ' + sel + '#' + nth);
  return c;
};
const hover = async (sel, nth = 0) => {
  const [x, y] = await need(sel, nth);
  await page.mouse.move(x, y);
  await sleep(600);
};
const click = async (sel, nth = 0) => {
  const [x, y] = await need(sel, nth);
  await page.mouse.click(x, y);
  await sleep(700);
};
const park = async () => {
  await page.mouse.move(640, 300);
  await sleep(500);
};
const shot = name => console.log(menu('shot', '-Out', png(name)));
const SEL = {
  sceneRow: '.ant-tree-treenode-selected .ant-tree-title',
  sourceRow: '[class*=source-title-container]',
  mixerItem: '[class*=mixer-item]',
  addBtn: 'i.icon-add-circle',
  tipClose: '[class*=help-tip__close]',
};

/** Opens a NATIVE menu (right-click via synthetic contextmenu event, or click) and captures it. */
async function ctxMenu(name, sel, nth = 0, trigger = 'contextmenu') {
  const [x, y] = await need(sel, nth);
  menu('focus');
  await sleep(300);
  menu('baseline');
  menu('move', '-X', String(x + 10), '-Y', String(y));
  await sleep(200);
  if (trigger === 'contextmenu')
    await ev(
      ({ sel, nth, x, y }) => {
        const e = document.querySelectorAll(sel)[nth];
        e.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: x + 10,
            clientY: y,
            button: 2,
          }),
        );
      },
      { sel, nth, x, y },
    );
  else await page.mouse.click(x, y);
  await sleep(1200);
  shot(name);
  console.log(menu('close'));
  await sleep(700);
}

/** Opens a dialog (child BrowserWindow), captures it on its own, then closes its target. */
async function childWindow(name, trigger) {
  menu('baseline');
  await trigger();
  await sleep(2500);
  console.log(menu('children', '-Out', png(name).replace(/.png$/, '')));
  for (const p of pages()) {
    if (p === page || p.url().includes('windowId=worker') || p.url().includes('devtools')) continue;
    try {
      const c = await p.context().newCDPSession(p);
      const { targetInfo } = await c.send('Target.getTargetInfo');
      const b = await browser.newBrowserCDPSession();
      await b.send('Target.closeTarget', { targetId: targetInfo.targetId });
    } catch (e) {
      console.log('close child failed', e.message);
    }
  }
  await sleep(1500);
}

async function crop(name, sel, scale = 3) {
  const r = await ev(
    ({ sel }) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    },
    { sel },
  );
  const res = await ev.session.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...r, scale },
  });
  fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(res.data, 'base64'));
}

async function main() {
  if (args.includes('--only-dialogs')) {
    await dialogs(sizes[0]);
    await browser.close().catch(() => {});
    return;
  }
  // ---- 1. first-run help tips (before dismissing) --------------------------------------------------------
  for (const [w, h] of sizes) {
    ps('shot-window.ps1', '-Width', String(w), '-Height', String(h));
    await sleep(2500);
    await park();
    shot(`editor-default-with-tips-${w}x${h}`);
  }
  for (let i = 0; i < 8; i++) {
    const c = await center(SEL.tipClose);
    if (!c) break;
    await page.mouse.click(c[0], c[1]);
    await sleep(500);
  }

  // ---- 2. per size ----------------------------------------------------------------------------------------
  const metrics = {};
  const icons = {};
  for (const [w, h] of sizes) {
    const tag = `${w}x${h}`;
    ps('shot-window.ps1', '-Width', String(w), '-Height', String(h));
    await sleep(3000);
    await park();
    shot(`editor-default-${tag}`);

    metrics[tag] = await measure();
    icons[tag] = await listIcons();

    await hover(SEL.sceneRow);
    shot(`hover-scene-row-${tag}`);
    await hover(SEL.sourceRow, 1);
    shot(`hover-source-row-${tag}`);
    await hover(SEL.mixerItem, 0);
    shot(`hover-mixer-row-${tag}`);
    await click(SEL.sourceRow, 1);
    await park();
    shot(`selected-source-row-${tag}`);
    await ctxMenu(`context-menu-source-${tag}`, SEL.sourceRow, 1);
    await ctxMenu(`context-menu-scene-${tag}`, SEL.sceneRow);
    await ctxMenu(`context-menu-mixer-panel-${tag}`, '.mixer-panel', 0);
    await ctxMenu(`mixer-item-cog-menu-${tag}`, SEL.mixerItem + ' i.icon-settings', 0, 'click');
    await hover(SEL.addBtn, 0);
    shot(`hover-add-scene-button-${tag}`);
    await hover(SEL.addBtn, 1);
    shot(`hover-add-source-button-${tag}`);
    if (w === sizes[0][0]) {
      await park();
      await crop(`zoom3x-footer-${tag}`, 'div.footer', 3);
      await crop(`zoom2x-nav-${tag}`, '[class*=nav-menu___]', 2);
      await crop(`zoom3x-titlebar-${tag}`, '[class*=titlebar___]', 3);
      await hover('[class*=nav-menu] li.ant-menu-item', 1);
      await crop(`zoom2x-nav-hover-layouts-${tag}`, '[class*=nav-menu___]', 2);
      await hover('[class*=nav-menu] i.icon-settings');
      await sleep(900);
      shot(`hover-nav-settings-${tag}`);
      await hover('[class*=nav-menu] i.icon-question');
      await sleep(900);
      shot(`hover-nav-help-${tag}`);
      await hover('div.footer [class*=nav-item]', 3);
      await crop(`zoom3x-footer-hover-golive-${tag}`, 'div.footer', 3);
      await park();
      await dialogs([w, h]);
    }
    await park();
  }

  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  fs.writeFileSync(path.join(outDir, 'icons.json'), JSON.stringify(icons, null, 2));
  await browser.close().catch(() => {});
  console.log('done ->', outDir);
}

// ---- measurement ----------------------------------------------------------------------------------------
const TARGETS = [
  ['window/main', '[class*=main___]'],
  ['titlebar', '[class*=titlebar___]'],
  ['titlebar/icon', '[class*=titlebar-icon]'],
  ['titlebar/title', '[class*=titlebar-title]'],
  ['titlebar/action', '[class*=titlebar-action]'],
  ['nav', '[class*=nav-menu___]'],
  ['nav/item-active', '[class*=nav-menu] li.ant-menu-item', 0],
  ['nav/item', '[class*=nav-menu] li.ant-menu-item', 1],
  ['nav/item-icon', '[class*=nav-menu] li.ant-menu-item i', 1],
  ['nav/item-label', '[class*=nav-menu] li.ant-menu-item .ant-menu-title-content', 1],
  ['nav/tools-item', '[class*=nav-menu] [class*=tools-nav] li', 1],
  ['nav/divider', '[class*=nav-menu] hr'],
  ['main/contents', '[class*=main-contents]'],
  ['main/page-container', '[class*=main-page-container]'],
  ['rows', '[class*=rows___]'],
  ['preview/cell', '[class*=rows___] > [class*=cell]', 0],
  ['preview/display', '[class*=studio-editor-display-container]'],
  ['minifeed/cell', '[class*=rows___] > [class*=cell]', 1],
  ['minifeed/header', '[class*=rows___] > [class*=cell] h2', 0],
  ['resize-bar', '[class*=resize-bar]', 0],
  ['resize-bar/line', '[class*=resize-line]', 0],
  ['dock/segmented', '[class*=segmented]'],
  ['dock/panel-scenes', '[class*=segmented] > [class*=cell]', 0],
  ['dock/panel-sources', '[class*=segmented] > [class*=cell]', 1],
  ['dock/panel-mixer', '[class*=segmented] > [class*=cell]', 2],
  ['panel/header-scenes', '[class*=top-container]', 0],
  ['panel/header-title-scenes', '[class*=active-scene___]'],
  ['panel/header-title-sources', '[class*=sources-header]'],
  ['panel/header-title-mixer', '[class*=segmented] h2.studio-controls__label'],
  ['panel/header-icon-add', 'i.icon-add-circle'],
  ['panel/header-icon-right', 'i.icon-transition'],
  ['scene/row-selected', '.ant-tree-treenode-selected'],
  ['scene/row-title', '.ant-tree-treenode-selected .ant-tree-title'],
  ['source/row', '.ant-tree-block-node .ant-tree-treenode', 1],
  [
    'source/row-title-container',
    '[class*=segmented] > [class*=cell]:nth-child(2) [class*=source-title-container]',
    0,
  ],
  ['scene/row-wrapper', '.ant-tree-treenode-selected .ant-tree-node-content-wrapper'],
  [
    'source/row-wrapper',
    '[class*=segmented] > [class*=cell]:nth-child(2) .ant-tree-node-content-wrapper',
    0,
  ],
  ['scene/list-box', '[class*=segmented] > [class*=cell]:nth-child(1) .os-host'],
  ['source/list-box', '[class*=segmented] > [class*=cell]:nth-child(2) .os-host'],
  ['mixer/list-box', '[class*=segmented] > [class*=cell]:nth-child(3) .os-host'],
  [
    'source/row-title',
    '[class*=segmented] > [class*=cell]:nth-child(2) [class*=source-title___]',
    0,
  ],
  ['mixer/item', '[class*=mixer-item]', 0],
  ['mixer/name', '[class*=source-name]', 0],
  ['mixer/db', '[class*=db-value]', 0],
  ['mixer/controls', '[class*=controls___]', 0],
  ['mixer/slider', '[class*=mixer-item] .ant-slider', 0],
  ['mixer/slider-handle', '[class*=mixer-item] .ant-slider-handle', 0],
  ['mixer/slider-track', '[class*=mixer-item] .ant-slider-track', 0],
  ['mixer/slider-rail', '[class*=mixer-item] .ant-slider-rail', 0],
  ['mixer/volmeter-canvas', '.mixer-panel canvas'],
  ['mixer/icon-audio', '[class*=mixer-item] i.icon-audio'],
  ['mixer/icon-settings', '[class*=mixer-item] i.icon-settings'],
  ['footer', 'div.footer'],
  ['footer/left', '[class*=footer--left]'],
  ['footer/right', '[class*=nav-right]'],
  ['footer/nav-item-rec', 'div.footer [class*=nav-item]', 1],
  ['footer/nav-item-replay', 'div.footer [class*=nav-item]', 2],
  ['footer/go-live', 'div.footer [class*=nav-item]', 3],
  ['footer/metrics-icon', '[class*=metrics-icon]'],
  ['body', 'body'],
];

function readTargets({ targets }) {
  const out = {};
  const S = e => {
    const c = getComputedStyle(e);
    return {
      fontFamily: c.fontFamily,
      fontSize: c.fontSize,
      fontWeight: c.fontWeight,
      lineHeight: c.lineHeight,
      letterSpacing: c.letterSpacing,
      textTransform: c.textTransform,
      color: c.color,
      background: c.backgroundColor,
      backgroundImage: c.backgroundImage === 'none' ? undefined : c.backgroundImage.slice(0, 120),
      border: [
        c.borderTopWidth,
        c.borderTopStyle,
        c.borderTopColor,
        '|',
        c.borderBottomWidth,
        c.borderBottomStyle,
        c.borderBottomColor,
      ].join(' '),
      borderRadius: c.borderRadius,
      padding: c.padding,
      margin: c.margin,
      display: c.display,
      gap: c.gap,
      opacity: c.opacity,
      cursor: c.cursor,
      boxShadow: c.boxShadow === 'none' ? undefined : c.boxShadow,
    };
  };
  for (const [label, sel, nth] of targets) {
    const e = document.querySelectorAll(sel)[nth || 0];
    if (!e) {
      out[label] = { selector: sel, missing: true };
      continue;
    }
    const b = e.getBoundingClientRect();
    out[label] = {
      selector: sel + (nth ? `[${nth}]` : ''),
      className: typeof e.className === 'string' ? e.className : undefined,
      rect: {
        x: +b.x.toFixed(1),
        y: +b.y.toFixed(1),
        w: +b.width.toFixed(1),
        h: +b.height.toFixed(1),
      },
      text: e.children.length === 0 ? e.textContent.trim().slice(0, 40) : undefined,
      ...S(e),
    };
  }
  out.__viewport = { innerWidth, innerHeight, dpr: devicePixelRatio, outerWidth, outerHeight };
  return out;
}

async function measure() {
  const base = await ev(readTargets, { targets: TARGETS });
  const hov = {};
  const hoverTargets = [
    ['scene/row-selected', SEL.sceneRow, 0],
    [
      'source/row-wrapper',
      '[class*=segmented] > [class*=cell]:nth-child(2) .ant-tree-node-content-wrapper',
      0,
    ],
    ['scene/row-wrapper', '.ant-tree-treenode-selected .ant-tree-node-content-wrapper', 0],
    ['mixer/item', SEL.mixerItem, 0],
    ['nav/item', '[class*=nav-menu] li.ant-menu-item', 1],
    ['footer/go-live', 'div.footer [class*=nav-item]', 3],
  ];
  for (const [label, sel, nth] of hoverTargets) {
    await hover(sel, nth);
    const r = await ev(readTargets, { targets: TARGETS.filter(t => t[0] === label) });
    hov[label + ':hover'] = r[label];
  }
  await park();
  return { ...base, hover: hov };
}

async function listIcons() {
  const regions = [
    ['titlebar', '[class*=titlebar___]'],
    ['nav', '[class*=nav-menu___]'],
    ['preview', '[class*=studio-editor-display-container]'],
    ['minifeed', '[class*=rows___] > [class*=cell]:nth-child(2)'],
    ['panel-scenes', '[class*=segmented] > [class*=cell]:nth-child(1)'],
    ['panel-sources', '[class*=segmented] > [class*=cell]:nth-child(2)'],
    ['panel-mixer', '[class*=segmented] > [class*=cell]:nth-child(3)'],
    ['footer', 'div.footer'],
  ];
  return ev(
    ({ regions }) => {
      const out = {};
      for (const [name, sel] of regions) {
        const root = document.querySelector(sel);
        if (!root) {
          out[name] = null;
          continue;
        }
        out[name] = [...root.querySelectorAll('i, svg, img')]
          .filter(e => e.getBoundingClientRect().width > 0)
          .map(e => {
            const b = e.getBoundingClientRect();
            const c = getComputedStyle(e);
            const cls = typeof e.className === 'string' ? e.className : e.className?.baseVal || '';
            return {
              tag: e.tagName.toLowerCase(),
              classes:
                cls
                  .split(/\s+/)
                  .filter(x => /^(icon-|fa|anticon)/.test(x))
                  .join(' ') || cls,
              parent: (e.parentElement?.className || '').toString().split(' ')[0],
              size: `${Math.round(b.width)}x${Math.round(b.height)}`,
              fontSize: c.fontSize,
              color: c.color,
              src: e.tagName === 'IMG' ? e.getAttribute('src') : undefined,
              hint:
                e.getAttribute('title') ||
                e.getAttribute('aria-label') ||
                e.getAttribute('role') ||
                undefined,
            };
          });
      }
      return out;
    },
    { regions },
  );
}

await main();

async function dialogs([w, h]) {
  const tag = `${w}x${h}`;
  ps('shot-window.ps1', '-Width', String(w), '-Height', String(h));
  await sleep(2500);
  await park();
  await childWindow(`dialog-add-scene-${tag}`, () => click(SEL.addBtn, 0));
  await childWindow(`dialog-add-source-${tag}`, () => click(SEL.addBtn, 1));
  await childWindow(`dialog-mixer-advanced-settings-${tag}`, () =>
    click('i[role=show-advanced-audio]'),
  );
}
