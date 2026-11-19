// Benchmark shell. Args: --fw <name> --page <editor|settings|rename>. Env: BENCH_SCENARIO, BENCH_ON_TOP.
// Prints one JSON line {event:'ready', rendererPid, corePid, coldOpenMs} once the page reports
// its first painted frame with data (window creation -> paint).
const { app, BrowserWindow, ipcMain, utilityProcess, MessageChannelMain } = require('electron');
const path = require('path');

const arg = n => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const fw = arg('fw');
const page = arg('page') || 'editor';

app.whenReady().then(() => {
  const core = utilityProcess.fork(path.join(__dirname, 'core-mock.cjs'), [], { env: { ...process.env } });
  const t0 = performance.now();
  const win = new BrowserWindow({
    width: 1469,
    height: 870,
    show: true,
    backgroundColor: '#171717',
    alwaysOnTop: !!process.env.BENCH_ON_TOP,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  ipcMain.once('painted', () => {
    // BENCH_SCREENSHOT=<file.png>: capture the window 1.5 s after first paint (visual check)
    if (process.env.BENCH_SCREENSHOT) {
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        require('fs').writeFileSync(process.env.BENCH_SCREENSHOT, img.toPNG());
        console.log(JSON.stringify({ event: 'screenshot', file: process.env.BENCH_SCREENSHOT }));
      }, 1500);
    }
    console.log(
      JSON.stringify({
        event: 'ready',
        fw,
        page,
        rendererPid: win.webContents.getOSProcessId(),
        corePid: core.pid,
        coldOpenMs: Math.round(performance.now() - t0),
      }),
    );
  });
  win.webContents.once('dom-ready', () => {
    const { port1, port2 } = new MessageChannelMain();
    core.postMessage({ type: 'port' }, [port1]);
    win.webContents.postMessage('core-port', null, [port2]);
  });
  win.loadFile(path.join(__dirname, '..', 'dist', fw, `${page}.html`));
});

app.on('window-all-closed', () => app.quit());
