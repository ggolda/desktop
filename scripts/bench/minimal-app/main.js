// Minimal Electron app to measure the memory floor with hardware acceleration on.
// FLOOR_HIDDEN=1 adds one hidden window (like Streamlabs' worker).
const { app, BrowserWindow, contentTracing } = require('electron');
const path = require('path');
app.whenReady().then(() => {
  const opts = {
    width: 1469,
    height: 870,
    backgroundColor: '#17242D',
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  };
  const main = new BrowserWindow(opts);
  main.loadFile(
    path.join(__dirname, process.env.FLOOR_CONTENT ? 'content.html' : 'index.html'),
    process.env.FLOOR_PULSE ? { search: 'pulse' } : undefined,
  );
  if (process.env.FLOOR_HIDDEN) {
    const hidden = new BrowserWindow({ ...opts, show: false });
    hidden.loadFile(path.join(__dirname, 'index.html'));
  }
});
// FLOOR_TRACE=<file>: memory-infra trace (detailed dumps) 15 s after start, 10 s long.
if (process.env.FLOOR_TRACE) {
  app.whenReady().then(() =>
    setTimeout(async () => {
      await contentTracing.startRecording({
        included_categories: ['disabled-by-default-memory-infra'],
        memory_dump_config: { triggers: [{ mode: 'detailed', periodic_interval_ms: 3000 }] },
      });
      setTimeout(async () => {
        await contentTracing.stopRecording(process.env.FLOOR_TRACE);
        console.log('trace written');
      }, 10000);
    }, 15000),
  );
}
app.on('window-all-closed', () => app.quit());
