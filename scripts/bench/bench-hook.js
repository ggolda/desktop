/**
 * Benchmark hook — loaded by main.js ONLY when SLOBS_BENCH_OUT is set.
 * See docs/rework/benchmarking.md.
 *
 * Responsibilities (must not otherwise change app behaviour):
 *  - report which OS process serves which window/webview (labels for the harness)
 *  - record Electron's own app.getAppMetrics() for cross-checking
 *  - put the app into the requested scenario state once the main window is shown
 *  - perform a clean quit when the harness writes "quit" to the control file
 *
 * Writes only to $SLOBS_BENCH_OUT. URLs are reduced to origin+path (no query
 * strings), so no tokens end up in benchmark files.
 */
const { app, BaseWindow, BrowserWindow, screen, webContents } = require('electron');
const fs = require('fs');
const path = require('path');

const outDir = process.env.SLOBS_BENCH_OUT;
const scenario = process.env.SLOBS_BENCH_SCENARIO || 'S2';
fs.mkdirSync(outDir, { recursive: true });

// ---- experiment switches (must run before 'ready'; this file is required early by main.js) ----
// SLOBS_BENCH_DISABLE_HA=1                → app.disableHardwareAcceleration()
// SLOBS_BENCH_SWITCHES="a;b=c"            → app.commandLine.appendSwitch(...) each
//   (don't pass disable-features here: main.js sets it later and the last one wins)
if (process.env.SLOBS_BENCH_DISABLE_HA) app.disableHardwareAcceleration();
for (const sw of (process.env.SLOBS_BENCH_SWITCHES || '').split(';').filter(Boolean)) {
  const [k, ...v] = sw.split('=');
  if (v.length) app.commandLine.appendSwitch(k, v.join('='));
  else app.commandLine.appendSwitch(k);
}

const eventsFile = path.join(outDir, 'events.jsonl');
const metricsFile = path.join(outDir, 'app-metrics.jsonl');
const controlFile = path.join(outDir, 'control');

function append(file, obj) {
  fs.appendFileSync(file, JSON.stringify({ t: Date.now(), ...obj }) + '\n');
}
function emit(event, extra = {}) {
  append(eventsFile, { event, ...extra });
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') {
      const windowId = u.searchParams.get('windowId');
      return `file://${path.basename(u.pathname)}${windowId ? `?windowId=${windowId}` : ''}`;
    }
    return `${u.origin}${u.pathname}`;
  } catch (e) {
    return '';
  }
}

function roleOf(wc) {
  const type = wc.getType();
  const url = wc.getURL();
  const m = url.match(/[?&]windowId=([^&#]+)/);
  if (m && url.startsWith('file:')) return `window:${m[1]}`;
  let host = '';
  try {
    host = new URL(url).host;
  } catch (e) {}
  return `${type}:${host || 'blank'}`;
}

function findWindow(windowId) {
  return BrowserWindow.getAllWindows().find(
    w => !w.isDestroyed() && w.webContents.getURL().includes(`windowId=${windowId}`),
  );
}

function snapshot() {
  const wcs = webContents.getAllWebContents().map(wc => {
    let pid = null;
    try {
      pid = wc.getOSProcessId();
    } catch (e) {}
    return { id: wc.id, pid, type: wc.getType(), role: roleOf(wc), url: safeUrl(wc.getURL()) };
  });
  const main = findWindow('main');
  const windowState = main
    ? {
        visible: main.isVisible(),
        minimized: main.isMinimized(),
        focused: main.isFocused(),
        bounds: main.getBounds(),
      }
    : null;
  const focused = BrowserWindow.getFocusedWindow();
  append(metricsFile, {
    browserPid: process.pid,
    // role of the focused app window; 'bench-focus' = our S1u window; null = another app has focus
    focusedWindow: focused ? roleOf(focused.webContents) : focusWindow && focusWindow.isFocused() ? 'bench-focus' : null,
    appMetrics: app.getAppMetrics().map(m => ({
      pid: m.pid,
      type: m.type,
      serviceName: m.serviceName,
      name: m.name,
      memory: m.memory, // KB: workingSetSize, peakWorkingSetSize, privateBytes
    })),
    webContents: wcs,
    mainWindow: windowState,
  });
}

let previewDisabled = false;
let focusWindow = null;

// S1u: a tiny focusable window in the bottom-right corner takes focus, so the main
// window stays visible (not occluded) but unfocused. BaseWindow has no webContents,
// so it adds no renderer process to the measurement.
function openFocusWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  focusWindow = new BaseWindow({
    width: 160,
    height: 60,
    x: area.x + area.width - 170,
    y: area.y + area.height - 70,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    title: 'bench-focus',
  });
  focusWindow.show();
  focusWindow.focus();
}
function closeFocusWindow() {
  if (focusWindow && !focusWindow.isDestroyed()) focusWindow.destroy();
  focusWindow = null;
}

async function setPreview(enabled) {
  // Through the real service, in the worker where services run.
  const worker = findWindow('worker');
  await worker.webContents.executeJavaScript(
    `window.servicesManager.getResource('CustomizationService').setLivePreviewEnabled(${enabled}); true`,
  );
  previewDisabled = !enabled;
}

// Focused scenarios: if something else takes the foreground (observed: Windows Terminal
// ~45 s after launch), take it back once, so "focused" measurements stay focused.
let currentScenario = null;
let refocusTimer = null;
function keepFocus() {
  const main = findWindow('main');
  if (!main || main.__benchKeepFocus) return;
  main.__benchKeepFocus = true;
  main.on('blur', () => {
    if (!['S1', 'S2', 'S3', 'S5'].includes(currentScenario) || refocusTimer) return;
    refocusTimer = setTimeout(() => {
      refocusTimer = null;
      if (!['S1', 'S2', 'S3', 'S5'].includes(currentScenario) || main.isDestroyed() || main.isFocused()) return;
      main.minimize();
      setTimeout(() => {
        main.restore();
        main.focus();
        emit('refocused', { scenario: currentScenario });
      }, 300);
    }, 1500);
  });
}

async function setRecording(on) {
  const worker = findWindow('worker');
  await worker.webContents.executeJavaScript(
    `(() => { const s = window.servicesManager.getResource('StreamingService');
      if (!!s.isRecording !== ${on}) s.toggleRecording(); return true; })()`,
  );
  emit('recording', { on });
}

async function setLiveDock(expanded) {
  const worker = findWindow('worker');
  const info = await worker.webContents.executeJavaScript(
    `(() => { const sm = window.servicesManager;
      sm.getResource('CustomizationService').setSettings({ livedockCollapsed: ${!expanded} });
      const auth = sm.getResource('UserService').state.auth;
      return { primaryPlatform: auth && auth.primaryPlatform,
               hasChatUrl: !!sm.getResource('StreamingService').views.chatUrl }; })()`,
  );
  emit('live-dock', { expanded, ...info });
}

// Moves the app from whatever state it is in into the target scenario.
async function applyScenario(target) {
  const leavingS3 = currentScenario === 'S3' && target !== 'S3';
  const leavingS5 = currentScenario === 'S5' && target !== 'S5';
  currentScenario = target;
  keepFocus();
  if (leavingS3) await setRecording(false);
  if (leavingS5) await setLiveDock(false);
  const main = findWindow('main');
  if (target !== 'S0' && main.isMinimized()) main.restore();
  if (target === 'S1' && !previewDisabled) await setPreview(false);
  if (target !== 'S1' && previewDisabled) await setPreview(true);
  if (target !== 'S1u') closeFocusWindow();
  if (target === 'S0') main.minimize();
  else {
    main.focus();
    // Windows won't hand the foreground to a process launched from the background;
    // restoring from minimized does activate the window.
    await new Promise(r => setTimeout(r, 300));
    if (!main.isFocused()) {
      main.minimize();
      await new Promise(r => setTimeout(r, 300));
      main.restore();
      main.focus();
    }
  }
  if (target === 'S1u') openFocusWindow();
  if (target === 'S3') await setRecording(true); // S3 = S2 + recording
  if (target === 'S5') await setLiveDock(true); // S5 = S2 + live dock expanded (chat visible)
  emit('scenario-applied', { scenario: target });
}

// ---- passive IPC counters (scripts/bench/trace-idle.mjs) ----
// Extra listeners only observe; they never set returnValue or reply.
const { ipcMain, contentTracing } = require('electron');
let ipcStats = {};
function senderRole(e) {
  try {
    return roleOf(e.sender);
  } catch (err) {
    return 'unknown';
  }
}
function countIpc(channel, from, key, bytes) {
  const k = `${channel} | ${from} | ${key}`;
  const s = (ipcStats[k] = ipcStats[k] || { count: 0, bytes: 0 });
  s.count++;
  s.bytes += bytes || 0;
}
const size = x => (typeof x === 'string' ? x.length : (() => { try { return JSON.stringify(x).length; } catch (e) { return 0; } })());
ipcMain.on('vuex-mutation', (e, str) => {
  let list = [];
  try {
    list = JSON.parse(str);
  } catch (err) {}
  for (const m of list) countIpc('vuex-mutation', senderRole(e), m.type, size(m.payload));
});
for (const ch of ['services-request', 'services-request-async']) {
  ipcMain.on(ch, (e, req) => {
    const p = (req && req.params) || {};
    countIpc(ch, senderRole(e), `${p.resource || '?'}.${req && req.method}`, size(req));
  });
}
ipcMain.on('services-response', (e, res) => countIpc('services-response', senderRole(e), (res && res.result && res.result._type) || 'value', size(res)));
ipcMain.on('services-message', (e, msg) => {
  const r = (msg && msg.result) || {};
  countIpc('services-message', senderRole(e), `${r._type || '?'}:${r.emitter || ''}:${r.resourceId || ''}`, size(msg));
});

// ---- idle trace: timeline of all processes + JS CPU profiles ----
async function traceIdle(sec, roles, withMemory = false) {
  const stamp = Date.now();
  const tracePath = path.join(outDir, `trace-${stamp}.json`);
  const profiles = [];
  for (const role of roles) {
    const w = findWindow(role);
    if (!w) continue;
    const dbg = w.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Profiler.enable');
    await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 500 });
    await dbg.sendCommand('Profiler.start');
    profiles.push({ role, dbg, pid: w.webContents.getOSProcessId() });
  }
  const memoryConfig = withMemory
    ? {
        memory_dump_config: {
          triggers: [{ mode: 'detailed', periodic_interval_ms: Math.max(2000, (sec * 1000) / 3) }],
        },
      }
    : {};
  await contentTracing.startRecording({
    ...memoryConfig,
    included_categories: [
      ...(withMemory ? ['disabled-by-default-memory-infra'] : []),
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'disabled-by-default-devtools.timeline.stack', // JS stacks for TimerInstall etc.
      'toplevel',
      'blink.user_timing',
      'v8.execute',
      'cc',
      'viz',
      'gpu',
    ],
  });
  ipcStats = {};
  snapshot(); // fresh pid → role map
  await new Promise(r => setTimeout(r, sec * 1000));
  const ipc = ipcStats;
  await contentTracing.stopRecording(tracePath);
  for (const p of profiles) {
    const { profile } = await p.dbg.sendCommand('Profiler.stop');
    fs.writeFileSync(path.join(outDir, `profile-${p.role}-${stamp}.cpuprofile`), JSON.stringify(profile));
    p.dbg.detach();
  }
  fs.writeFileSync(path.join(outDir, `ipc-${stamp}.json`), JSON.stringify({ seconds: sec, stats: ipc }, null, 1));
  emit('trace-done', { stamp, sec, tracePath, roles: profiles.map(p => ({ role: p.role, pid: p.pid })) });
}

// ---- composited layers of a window (scripts/bench/layers.mjs) ----
// Each composited layer gets its own GPU tiles / shared images in the GPU process.
async function dumpLayers(role) {
  const w = findWindow(role);
  const dbg = w.webContents.debugger;
  dbg.attach('1.3');
  const layers = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no layerTreeDidChange')), 10000);
    dbg.on('message', (e, method, params) => {
      if (method === 'LayerTree.layerTreeDidChange' && params.layers) {
        clearTimeout(timer);
        resolve(params.layers);
      }
    });
    dbg.sendCommand('DOM.enable').then(() => dbg.sendCommand('LayerTree.enable')).catch(reject);
  });
  const out = [];
  for (const l of layers) {
    let reasons = [];
    try {
      reasons = (await dbg.sendCommand('LayerTree.compositingReasons', { layerId: l.layerId })).compositingReasonIds || [];
    } catch (e) {}
    let node = '';
    if (l.backendNodeId) {
      try {
        const n = (await dbg.sendCommand('DOM.describeNode', { backendNodeId: l.backendNodeId })).node;
        const attrs = {};
        for (let i = 0; i < (n.attributes || []).length; i += 2) attrs[n.attributes[i]] = n.attributes[i + 1];
        node = `${n.localName || n.nodeName}${attrs.id ? '#' + attrs.id : ''}${attrs.class ? '.' + attrs.class.trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
      } catch (e) {}
    }
    out.push({
      id: l.layerId,
      parent: l.parentLayerId,
      w: Math.round(l.width),
      h: Math.round(l.height),
      drawsContent: l.drawsContent,
      paintCount: l.paintCount,
      reasons,
      node,
    });
  }
  dbg.detach();
  const file = path.join(outDir, `layers-${role}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  emit('layers-done', { role, file, count: out.length });
}

// ---- dialog open latency (scripts/bench/dialog-latency.mjs) ----
const DIALOGS = {
  Settings: { open: "getResource('SettingsService').showSettings()", title: 'Settings' },
  AddSource: { open: "getResource('SourcesService').showShowcase()", title: 'Add Source' },
};

async function measureDialog(name) {
  const d = DIALOGS[name];
  const worker = findWindow('worker');
  const before = findWindow('child');
  if (before) before.setTitle(''); // warm mode: make the title check meaningful
  const t0 = Date.now();
  await worker.webContents.executeJavaScript(`window.servicesManager.${d.open}; true`);
  const out = { name, warm: !!process.env.SLOBS_WARM_CHILD, created: !before };
  while (Date.now() - t0 < 20000) {
    const c = findWindow('child') || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL() === '');
    if (c && out.visibleMs == null && c.isVisible()) out.visibleMs = Date.now() - t0;
    if (c && c.getTitle() === d.title) {
      out.titleMs = Date.now() - t0;
      // two animation frames in the child ≈ the component has been painted
      await c.webContents.executeJavaScript(
        'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))',
      );
      out.paintedMs = Date.now() - t0;
      break;
    }
    await new Promise(r => setTimeout(r, 10));
  }
  emit('dialog-timing', out);

  const t1 = Date.now();
  await worker.webContents.executeJavaScript(
    "window.servicesManager.getResource('WindowsService').closeChildWindow(); true",
  );
  while (Date.now() - t1 < 10000) {
    const c = findWindow('child');
    if (!c || !c.isVisible()) break;
    await new Promise(r => setTimeout(r, 10));
  }
  emit('dialog-closed', { name, ms: Date.now() - t1, destroyed: !findWindow('child') });
}

async function emitGpuInfo() {
  try {
    const info = await app.getGPUInfo('complete');
    const aux = info.auxAttributes || {};
    emit('gpu-info', {
      devices: (info.gpuDevice || []).map(d => ({
        active: d.active,
        vendorId: d.vendorId,
        deviceId: d.deviceId,
        driverVersion: d.driverVersion,
      })),
      glRenderer: aux.glRenderer,
      glImplementationParts: aux.glImplementationParts,
      hardwareAccelerationDisabled: !!process.env.SLOBS_BENCH_DISABLE_HA,
      switches: process.env.SLOBS_BENCH_SWITCHES || '',
      featureStatus: app.getGPUFeatureStatus(),
    });
  } catch (e) {
    emit('gpu-info', { error: String(e && e.message) });
  }
}

app.on('ready', () => {
  emit('app-ready', { pid: process.pid, scenario });
  setTimeout(emitGpuInfo, 15000);
  setInterval(snapshot, 5000);

  const readyPoll = setInterval(() => {
    const main = findWindow('main');
    if (main && main.isVisible()) {
      clearInterval(readyPoll);
      emit('main-window-shown');
      applyScenario(scenario).catch(e => emit('scenario-error', { message: String(e && e.message) }));
    }
  }, 500);

  setInterval(() => {
    if (!fs.existsSync(controlFile)) return;
    const cmd = fs.readFileSync(controlFile, 'utf8').trim();
    fs.unlinkSync(controlFile);
    if (cmd === 'snapshot') snapshot();
    if (cmd.startsWith('layers')) {
      dumpLayers(cmd.split(/\s+/)[1] || 'main').catch(e =>
        emit('layers-error', { message: String(e && e.message) }),
      );
    }
    if (cmd === 'logout') {
      findWindow('worker')
        .webContents.executeJavaScript(
          "window.servicesManager.getResource('UserService').logOut().then(() => true)",
        )
        .then(() => emit('logged-out'))
        .catch(e => emit('scenario-error', { message: String(e && e.message) }));
    }
    if (cmd.startsWith('record ')) {
      setRecording(cmd.endsWith('on')).catch(e => emit('scenario-error', { message: String(e && e.message) }));
    }
    if (cmd.startsWith('perfmode ')) {
      // hides the mixer volume meters via the real setting (customization performanceMode)
      const on = cmd.endsWith('on');
      findWindow('worker')
        .webContents.executeJavaScript(
          `window.servicesManager.getResource('CustomizationService').setSettings({ performanceMode: ${on} }); true`,
        )
        .then(() => emit('perfmode', { on }))
        .catch(e => emit('scenario-error', { message: String(e && e.message) }));
    }
    if (cmd.startsWith('trace ')) {
      // trace <seconds> <role,role>   e.g. "trace 20 main,worker"
      const [, sec, roles, mem] = cmd.split(/\s+/);
      traceIdle(Number(sec) || 20, (roles || 'main,worker').split(','), mem === 'mem').catch(e =>
        emit('trace-error', { message: String(e && e.message) }),
      );
    }
    if (cmd.startsWith('dialog ')) {
      measureDialog(cmd.slice(7).trim()).catch(e =>
        emit('dialog-error', { message: String(e && e.message) }),
      );
    }
    if (cmd.startsWith('scenario ')) {
      applyScenario(cmd.slice(9).trim()).catch(e =>
        emit('scenario-error', { message: String(e && e.message) }),
      );
    }
    if (cmd === 'quit') {
      if (currentScenario === 'S3') setRecording(false).catch(() => {});
      emit('quit-requested');
      const main = findWindow('main');
      if (main) main.close();
      else app.quit();
    }
  }, 1000);
});

app.on('quit', () => emit('app-quit'));
