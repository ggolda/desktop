# native-gate

Gate check: do the EXISTING prebuilt native modules from the repo's `node_modules` load and work
under Electron 45.x, in the main process and in a `utilityProcess`? Nothing is rebuilt or added.

Run: `npm install && npm start` (headless; writes `out/result.json`, prints a summary).
Override repo path with `GATE_REPO`.

Checks: `require()` of each module in main and utility (per-module try/catch); safe read-only calls
(font list, fontinfo, monitor screenshot, export keys); realm write/read in a temp file; OSN init in the
utility process (IPC.host, initAPI with a temp appData dir, scene + color_source, read back, shutdown),
step timings; utility RSS/private memory via `app.getAppMetrics()` vs an empty utility; obs64.exe pid
before/during/after (leftovers started by the test are killed after 15 s).
No crash handler, libuiohook hook or game overlay is started.
