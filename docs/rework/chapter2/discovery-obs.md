# Discovery: OBS / obs-studio-node integration (chapter 2)

*Source: read-only code analysis 2026-11-18. Constraint: OSN, obs64.exe, plugins and their installation
are owned by another team and are not changed; only our interaction with them may change.*

## Key facts
- Wrapper `obs-api/index.js` (repo root) does `window['require']('obs-studio-node')` and only exports
  real objects when `?windowId=worker` → **renderer-only; must be replaced by a plain `require`** (our
  code, not OSN).
- **OSN is an N-API addon** (`napi_register_module_v1`, threadsafe functions; one leftover V8 import
  `DisposeGlobal`, resolves in any Electron process). OSN's JS (`module.js`) uses only `path`, `fs`,
  `process`. obs64 is a separate server process over named-pipe IPC (`IPC.host(uuid)`).
- **Almost every OSN call is synchronous** (blocking round trip to obs64); async only:
  `OBS_content_takeScreenshot`, `AutoOptimizer`. Native→JS events via threadsafe-function callbacks
  (volmeter, source, transition, source-message, output signals, per-output `signalHandler`).
- ~85 files import obs-api/OSN. All real calls run in the **worker renderer**; UI windows only use
  `const enum`s (inlined). Main process: no OSN (only routing, MessageChannels, `remote-require` for
  `game_overlay`, `node-libuiohook`, `node-window-rendering` (mac)).

## Usage by domain (approx. call sites)
init/IPC & shutdown (worker.ts, app.ts, obs-user-plugins) · video contexts & settings ~25
(`settings-v2/video.ts`, `settings.ts` `OBS_settings_*`, encoders, hardware) · scenes/items (property
get/set on native objects — each a blocking IPC) · sources ~100 (`getObsInput().settings/update`,
`InputFactory`, `obs.createSources` bulk load, `RegisterSourceCallback`) · filters ~15 · transitions ~30 ·
audio ~20 (fader, `VolmeterFactory`, `RegisterVolmeterCallback`) · outputs ~100, almost all in
`streaming.ts` (Simple/Advanced/EnhancedBroadcasting factories, encoders, audio tracks, 6
`signalHandler`s, stats) + virtual cam + screenshots · displays 13 (`video.ts`) · hotkeys ·
dual output (`IVideo` contexts threaded through scene models) · plugins · stats (2 s poll).

## Displays today
UI window creates `Display` → sends Electron window id → worker resolves HWND via
`remote.BrowserWindow.fromId(id).getNativeWindowHandle()` (sync remote) → `OBS_content_createDisplay`;
obs64 parents its render window to that HWND. Position: 500 ms `getBoundingClientRect` polling in the
UI window → `moveOBSDisplay/resizeOBSDisplay`. Mac: IOSurface + `node-window-rendering` in main.

## Moving the OSN client to a `utilityProcess`: feasible
Not blockers: N-API addon, libuv for callbacks, HWNDs are process-agnostic (main can pass the 8-byte
handle; obs64 already parents to a foreign HWND), MessagePorts supported in utilityProcess.
**Blockers (all in our code):** the obs-api wrapper; `@electron/remote` in OBS paths (init env/app path,
HWND lookup, `dialog`, `powerSaveBlocker`, `shell` in streaming/settings/virtual-webcam/screenshot,
`node-libuiohook` via remote); `ipcRenderer` transport (14 service files); window-identity assumptions;
DOM/`localStorage` in services (25/8/14 files — the OBS-core services themselves have none); crash
handler registration; DevTools → `--inspect`. Dialogs/power-save/shell must become requests to main or
move to UI (policy out of the backend).

## OBS-specific leaks into the app (must be abstracted for a pluggable media backend)
`TObsFormData`/`IObsInput` property-form schema (35 files incl. UI, external API); legacy settings
categories (`OBS_settings_*` metadata shown directly in Settings); native `IVideo` handles in scene /
scene-item models; OBS enums as domain types (scale, blending, monitoring, deinterlace, render mode,
FPS type, output signals, hotkey types); OBS source type ids as domain ids; OSN's output/encoder model
in `streaming.ts` (~4k lines mixing policy and wiring); external & platform-app APIs exposing some of
these types.

## Proposed `MediaBackend` boundary (sketch)
Async, JSON-serializable, id-based; no native objects cross; events as a typed stream; high-rate data
(meters) over dedicated MessagePorts. Areas: lifecycle & capabilities · canvases (replace `IVideo`) ·
sources/filters/transitions (one node model, backend-neutral `PropertySchema`, bulk create,
interaction, media control) · scenes/items (transform, visibility, blending, order, program/studio
mode) · audio (volume, mute, monitoring, tracks, devices, meter ports) · outputs (declarative
`OutputsConfig`, start/stop/save replay, screenshots, vcam) · displays (HWND supplied by main;
bounds updates fire-and-forget) · hotkeys · stats · events (output state, source changed, source
message, transition, audio alerts, crash). Policy (dialogs, power-save, platform calls,
notifications) stays outside. The OBS adapter is the **only** module importing `obs-studio-node`.
