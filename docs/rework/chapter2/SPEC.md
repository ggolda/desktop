# Streamlabs Desktop "reborn": target architecture specification

*Version 0.1, 2026-11-19. Status: draft for owner review. This document is the contract for
implementation. Background: [discovery-distribution.md](discovery-distribution.md),
[discovery-obs.md](discovery-obs.md), [discovery-modules.md](discovery-modules.md),
[modules-proposal.md](modules-proposal.md) §10, [framework-bench-results.md](framework-bench-results.md),
ADR-0004…0008.*

Foundations, in priority order: **PERFORMANCE**, **MODULARITY**, **FUTURE-PROOF**. The core
experience is streaming and recording. It must be the fastest and leanest path in the app. Everything
else is optional, and costs nothing until used.

---

## 1. Requirements

### 1.1 Hard requirements (owner)
| # | Requirement |
| --- | --- |
| R1 | Auto-updater and distribution work as today: same CDN, same `bootstrap` → `latest-updater.exe` differential update, same install layout and exe name (`Streamlabs OBS.exe`), same userData (`%APPDATA%/slobs-client`). |
| R2 | The OBS backend (obs64, obs-studio-node builds and installation) is **not touched**. Only how we call it may change. |
| R3 | The rework installs over current users through the existing update mechanism. There is no full re-download, only the normal differential update. |
| R4 | Frontend **hotfix bundles keep working**: atomic, checksummed, self-healing, and covering all hotfixable JS (windows, core, features). |
| R5 | **No new native modules.** Only existing prebuilt ones may be used: obs-studio-node, crash-handler, font-manager, node-fontinfo, node-libuiohook, game_overlay, color-picker, node-window-rendering, node-win32-np, node-screenshots. Native modules we stop using may be dropped (e.g. `realm`). |
| R6 | **100 % compatibility** with the External API (everything reachable today, including the internal-service fallback), the Platform Apps API, user data (settings, scene collections, local storage) and `slobs://` links. |
| R7 | Windows and macOS both supported at code level. **macOS signing and testing are out of scope** for this rework; it must still build. |
| R8 | One big release. Master is ignored; the rework is a clean rewrite on `reborn`. |
| R9 | Electron **45.x**. |
| R10 | **UI/UX parity with legacy (owner, 2026-11-20): every screen must look and behave like the legacy app** — same layout, same icons (legacy icon font `icomoon` + Font Awesome as used today), same fonts (Roboto), same colors, spacing, sizes, panel structure, controls and interactions — rebuilt with Vue 3 + UnoCSS + shadcn-vue. Pixel perfection is not required, but a user must not notice a different app. No redesigns, no substitute icon sets (e.g. lucide) for legacy icons. See §6.1. |

### 1.2 Budgets (verified with `scripts/bench/` and enforced in CI)
| Metric (Electron tree, Task Manager "Memory") | Today (prod) | Chapter 1 PoC | **Target** |
| --- | --- | --- | --- |
| Typical user, idle, preview on | 558 MB | 360–390 MB | **≤ 250 MB** (estimate 215–315 MB) |
| Power user (18 apps), idle | 1250 MB | ~430 MB | **≤ 280 MB** (apps load only when opened) |
| Idle CPU, focused / unfocused | — | 0.1–0.4 % / 0.08 % | **≤ 0.2 % / ≈ 0 %** |
| Recording CPU (Electron tree) | 2.5 % | 0.55 % | **≤ 0.4 %** |
| Dialog window open (cold) | ~1 s+ | — | **≤ 250 ms**, +15–25 MB while open, 0 after close |
| Startup to interactive editor | — | — | measured in M1, then budgeted |

Chat (third-party web content, +100–160 MB) and platform apps (+60–150 MB each) are outside the
budget while open. A native chat view is a later feature.

### 1.3 Performance rules (non-negotiable; see `performance-guidelines.md` and CLAUDE.md)
- No `infinite` CSS animations, looping spinners or pulses on persistent UI.
- No permanent `requestAnimationFrame` loops. No polling of observable state; use events and
  observers.
- Live data flows only at visible rates (meters ≤ 10–15 Hz, stats 1 Hz), and only while visible.
- Nothing hidden "for speed": no warm hidden windows or pages. Everything is created on demand.
- Core-process code never imports UI code.

---

## 2. Process model

```
┌──────────── Electron main process (thin, NOT hotfixable) ────────────┐
│ app lifecycle · bootstrap/bundle updater (unchanged contract) ·      │
│ window manager · protocol handlers (slbundle://, slobs://) ·         │
│ MessagePort broker · crash-handler · native handles (HWND) for core  │
└──────────────────────────────────────────────────────────────────────┘
        │ MessageChannelMain (one port per window ↔ core, set up by main)
┌──────────── CORE: utilityProcess (Node, no DOM, hotfixable) ─────────┐
│ state store · commands · event bus · persistence · feature registry  │
│ MediaBackend (obs adapter: the ONLY importer of obs-studio-node)     │
│ platforms · go-live · outputs · settings · External API server       │
│ features/* services (lazy)                                           │
└──────────────────────────────────────────────────────────────────────┘
        │ MessagePort per window
┌─ main window ─┐  ┌─ dialog windows (thin) ─┐  ┌─ one-off (projector, pop-out chat…) ─┐
│ Vue 3 shell + │  │ one entry per dialog,   │  │ own small entries                    │
│ editor, lazy  │  │ created on demand,      │  │                                      │
│ feature pages │  │ destroyed on close      │  │                                      │
└───────────────┘  └─────────────────────────┘  └──────────────────────────────────────┘
  sandbox: true · contextIsolation: true · nodeIntegration: false · no @electron/remote
```

- **Main process.** Kept minimal, because it lives in app.asar and can only change with a full
  update. It owns:
  - Electron-only APIs that core can't call: `BrowserWindow`, `dialog`, `shell`,
    `powerSaveBlocker`, `screen`, `Menu`/tray, `protocol`, `globalShortcut`, `desktopCapturer`.
  - The bundle updater.
  - Crash handling.

  Core reaches these through a small typed **main RPC** (`main.dialog.showOpen`, `main.shell.openExternal`, …).
- **Core process** (`utilityProcess.fork`). Replaces today's hidden worker *window*: no Chromium
  page, no DOM, no Vue. It holds all domain logic and state, the only obs-studio-node client, and
  the External API server. Its entry file is loaded from the bundle set, so it is **hotfixable** (§8).
- **Windows.** All sandboxed. The preload exposes exactly one thing: `connectCore()`, which returns a
  MessagePort, plus `window.close/minimize` helpers. There are no direct Node or Electron APIs in
  windows. Each window type has its own Vite entry and loads only what it renders.
- **Window catalogue:**
  - main window;
  - dialogs: source properties, filters, add source, rename, settings, go-live, scene-collection
    manager, hotkeys, …;
  - one-offs: projectors, pop-out chat/dock, platform-app pop-outs;
  - platform-app and chat webviews: `WebContentsView`, created when shown and destroyed after a grace
    period.

### 2.1 OBS display (preview) without remote
1. The window creates a placeholder element and reports its rect with `ResizeObserver` and
   `IntersectionObserver`. This replaces today's 500 ms `getBoundingClientRect` polling.
2. Main supplies the native handle (`getNativeWindowHandle()`, an 8-byte HWND) to core on request.
   HWNDs work across processes, and obs64 already parents to a foreign HWND.
3. Core calls the backend's `createDisplay(handle, rect)` and `moveResize`.
4. macOS: today's IOSurface + `node-window-rendering` path stays in main and is exposed through main
   RPC.

---

## 3. IPC, state and data flow

### 3.1 Protocol (one per MessagePort)
Messages are structured-clone objects:
- `call {id, target, method, args}` → `result {id, value | error}`. These are **commands**: async,
  typed, and run in core.
- `sub {slice, key?}` / `unsub` → `patch {slice, ops}`. These are **state slices**: initial snapshot,
  then patches.
- `event {name, payload}`: events from the core bus that the window subscribed to.

Contracts are TypeScript types in `src/shared/contracts/*`. Window code calls them through generated
typed proxies: `core.scenes.makeActive(id)`.

### 3.2 State
- **Core is the single source of truth.** State lives in plain reactive stores in core
  (`@vue/reactivity`, the same engine as the windows, usable in Node). It is organized as named
  **slices**: `scenes`, `sources`, `sceneItems:<sceneId>`, `audio`, `outputs`, `streaming`,
  `settings:<category>`, `user`, `features`, plus feature slices. Changes are batched per microtask
  and sent as patches **only to windows subscribed to that slice**. This replaces the Vuex broadcast
  to every window and Realm replication.
- **Windows.** A Pinia store per domain wraps `useSlice()` (read-only, live) plus local UI state
  (selection, open panels). Components read stores. Writes always go through commands.
- **High-rate data** never goes through the store:
  - meters arrive on a dedicated `meters` channel, peak-merged in core, ≤ 15 Hz, sent only while the
    mixer is visible and the window is focused or visible;
  - stats arrive at 1 Hz, only to subscribers.
- Subscriptions are tied to component lifetime, so an unmounted view receives nothing.

### 3.3 Persistence and migration (user data, R6)
- The userData path is unchanged. Scene collections (`SceneCollections/*.json`), OBS configs
  (`basic.ini` etc., owned by obs64) and file formats stay **byte-compatible**: the same readers and
  writers are reimplemented in core.
- Settings and state that live today in renderer `localStorage` (Vuex persisted state) and in Realm
  files are read **once** on first launch of the new version by a migration step in core. The data
  moves into `reborn-state/*.json`, with atomic writes and a versioned schema. Original stores are
  **left untouched**, which keeps a downgrade safe.
- Migrations are forward-only and idempotent, and are recorded in `reborn-state/meta.json`.
- `realm` is dropped as a dependency after migration. Its data is read with a minimal reader shipped
  in the migration step: either the existing realm module (allowed, it is already installed), or an
  export performed once by the last legacy-capable code path. **To verify in M0.**

---

## 4. Media backend

- Interface `MediaBackend` in `src/core/media/backend.ts`, as sketched in discovery-obs.md. It covers
  sources, filters, transitions, audio/faders/volmeters, scenes, scene items, canvases (dual output
  is core), outputs (stream, record, replay, virtual cam), encoders, displays, screenshots, hotkeys
  and stats. Its methods are **async**, even though OSN is synchronous underneath, so other backends
  stay possible.
- `src/core/media/obs/` is the only directory allowed to import `obs-studio-node`. It is enforced by
  lint. Its jobs:
  - start and stop obs64 with the same arguments and paths as today (R2);
  - map OSN callbacks to bus events;
  - coalesce volmeter callbacks.
- Startup: the backend initializes in parallel with window creation. The editor renders scene and
  source state as soon as the collection is loaded, and the preview attaches when ready.
- The shutdown sequence keeps today's order (outputs → sources → OSN shutdown) and adds the fix for
  the I1 shutdown hang.

---

## 5. Modularity: modular monolith with lazy features

(Agreed in modules-proposal.md §10, refined on 2026-11-19.)

### 5.1 Layout
```
src/
  main/          Electron main process (thin)
  preload/       single preload for all windows
  core/          core process: store, bus, commands, persistence, media/, platforms/, golive/,
                 outputs/, scenes/, sources/, audio/, settings/, hotkeys/, external-api/, compat/
  windows/       window entries: main/, dialogs/<name>/, projector/, …
  ui/            shared Vue components (shadcn-vue based), theme, i18n runtime
  shared/        contracts (types), utilities usable everywhere (no Node, no DOM)
  features/
    registry.ts  the ONLY place features are wired into core
    highlighter/ { service.ts, api.ts, ui/*.vue, locales/ }
    app-store/ ai/ widgets/ guest-cam/ chat/ media/ onboarding/ importers/ diagnostics/
legacy/          old app moved here for reference while porting; not built; deleted at the end
```

### 5.2 Rules (enforced by ESLint import rules and CI)
1. Dependencies point one way: `features → core/public`. **Core never imports a feature.** Core
   reads `features/registry.ts` only.
2. A feature may import only `core/public`, `shared`, `ui`, and other features' `api.ts`.
3. Core-process code never imports `.vue`, `ui/` or `windows/`. Window code never imports `core/`
   (only `shared/contracts`).
4. Feature code is loaded with dynamic `import()` from the registry only, so each feature becomes its
   own chunk.

### 5.3 Registry and activation
```ts
export const features = defineFeatures([
  { id: 'highlighter', default: true, flag: 'highlighter',          // user/server flag (optional)
    service: () => import('./highlighter/service'),                 // core half, lazy
    startOn: ['output.replayBufferSaved'],                          // optional events that load it
    nav:    { title: 'nav.highlighter', icon: 'clapperboard', page: () => import('./highlighter/ui/Page.vue') },
    goLive: () => import('./highlighter/ui/GoLiveToggle.vue'),
    settingsPage: undefined, dock: undefined },
  …
]);
```
- **Enabled** = registry default, AND user/server flags (incentive and rollout flags as today), AND
  the user's local setting. When disabled, nothing loads, nothing renders, and nothing is fetched.
- **Activation.** A feature's service loads on first need: its page is opened, its go-live control
  is used, one of its `startOn` events fires, or another feature calls its `api.ts`. Its UI chunks
  load only when shown.
- **Deactivation.** A feature's `start(core)` returns a disposer. Calling it releases listeners,
  timers and sockets. This happens when the feature is disabled at runtime, or after idle for
  features that opt in.
- **Core integration points** read from the registry: nav tabs, go-live extras, settings pages,
  dock panels, Add-Source entries (widgets) and source context-menu items. **There are no other slots.**
  A feature that needs something new from core adds a generic core API or event in the same PR.

### 5.4 Core vs feature
Core contains only what streaming and recording need:
- editor, scenes, sources, filters, transitions, audio/mixer;
- outputs (stream, record, replay, virtual cam), multi-canvas;
- go-live, and platform adapters (`core/platforms/<name>.ts` implementing `Platform`), lazily
  imported per platform the user actually uses;
- settings, hotkeys, projectors, scene collections (local);
- login (minimal);
- External API, compat layers.

Everything else is a feature: highlighter, app-store, ai/vision (incl. Kevin, on demand), widgets,
guest-cam, chat, media gallery and backup, onboarding, importers, diagnostics/support,
marketing/announcements, cloud sync and remote control.

### 5.5 Removing a feature
1. Delete its folder and its registry entry.
2. Fix the compile errors. They point at every reference.
3. Decide about leftover user data (keep, or add a cleanup migration).
4. If the feature exposed External API or Platform-Apps API surface, the compat layer answers
   "feature removed" (R6).
5. Sources of its types stay in collections as "unavailable".

---

## 6. UI

- **Stack (ADR-0007):**
  - Vue 3.5+ (`<script setup>`, TS); Vapor mode allowed per component later;
  - Pinia, @vueuse/core, vue-router (main window only);
  - shadcn-vue on reka-ui, @lucide/vue, vue-sonner;
  - UnoCSS (preset-wind3, preset-shadcn, preset-animations for transitions only, typography,
    directives) with @unocss/reset;
  - unplugin-auto-import and unplugin-vue-components;
  - vue-tsc.
- **UI/UX parity (R10, §6.1):** the existing LESS theme variables (night/day/prime themes) are ported to
  CSS variables and UnoCSS theme tokens. shadcn-vue components are restyled to match the current
  components (buttons, inputs, modals, tabs, dropdowns, sliders). There is a visual reference check
  per screen against the legacy app.
### 6.1 UI/UX parity process (R10)
1. **Reference first.** Before a screen is built, capture reference screenshots of the legacy app for
   that screen at 1280×800 and 1920×1080, plus hover and active states and open menus. Store them in
   `docs/rework/ui-reference/<screen>/`, and record the legacy component and LESS sources used.
2. **Same assets.** Reuse the legacy assets: the icon fonts (`media/fonts/icomoon.woff` and the
   classes in `legacy/app/styles/custom-icons.less`, plus Font Awesome from `vendor/`), Roboto, images
   and the exact LESS variable values (colors, spacing, radii, font sizes, row heights). Port them to
   CSS variables and UnoCSS tokens.
3. **Same structure.** The DOM and layout follow the legacy component tree: title bar, side nav,
   editor layout variants, dock resize bars, panel headers, list rows, footer. shadcn-vue
   components are restyled to the legacy look; their default look is never used.
4. **Same behavior.** Interactions match legacy: hover-only row actions, context menus, inline
   rename, drag and drop, keyboard shortcuts, tooltips, empty states.
5. **Check.** Every screen is compared side by side with its reference (screenshot diff in
   `test-results/`). A screen is done only when the owner can't tell them apart at a glance.

- **i18n:** existing locale JSON files are reused. Each window or feature loads only its namespaces,
  on demand.
- **Lists:** the source list, scene list and app lists are virtualized when larger than about 100
  rows.
- Dialogs are thin windows (§2). They open with data already prefetched by core (the snapshot is
  sent with the port).

---

## 7. Compatibility layers (R6)

- **External API** (named pipe + websocket JSON-RPC, used by Streamlabs Remote / Stream Deck / third
  parties). A **catalog** of every service/method/event reachable today, including the
  internal-service fallback, is generated from the legacy code at the start of M4 and becomes the
  contract test suite. `core/compat/external-api/` maps legacy names and shapes to new commands and
  slices.
- **Platform Apps API**: the same approach. Legacy module names and methods map onto new commands;
  apps run in `WebContentsView`s with the existing preload contract.
- **`slobs://` links:** the same handlers, registered in main, dispatched to core.
- **Scene collections and configs:** byte-compatible (§3.3).

---

## 8. Build and distribution (R1, R3, R4)

### 8.1 Toolchain
npm (Yarn removed), Node 22 LTS, Electron 45.x, TypeScript, Vite 7 (or newest stable), ESLint 9 flat
config, Prettier, vue-tsc, Playwright (Electron) for e2e. electron-builder keeps producing the same
layout, exe name, appId and NSIS installer. The **updater, bootstrap and `updater/` contract are
unchanged.**

Vite builds:
| Target | Format | Location |
| --- | --- | --- |
| `main` | CJS, Node | app.asar (not hotfixable) |
| `preload` | sandboxed preload, single file | bundle set |
| `core` | ESM, Node, utilityProcess entry + feature chunks | bundle set |
| `windows` | ESM multi-page, per-window entries + shared/feature chunks | bundle set |

### 8.2 Full updates (unchanged mechanism)
The new version is a normal release: `{version}.sha256` plus per-file `.gz` on the CDN. The
differential updater replaces changed files, which includes app.asar as one file. Install layout,
exe name and userData don't change, so the existing updater delivers the rework like any release
(R3). The first launch runs the migration (§3.3).

### 8.3 Hotfix bundles v2 (R4)
How it works today, as the owner asked:
- At every startup, `bundle-updater.ts` fetches `{version}/bundles/manifest.json` from the CDN, for
  this exact app version.
- If the manifest names a different `renderer.js` or `vendors~renderer.js`, those files are
  downloaded to `userData/bundles/{version}`. A small 400×180 progress window appears during the
  download. The files are md5-checked, cached, and served via `slbundle://` instead of the copies
  in app.asar.
- A failure falls back to the local bundles. A broken cached bundle self-heals on the next start.

For the rework: **keep the existing format and flow**, and only generalize the hard-coded file list.

Today's `bundles/manifest.json` (written by `webpack-manifest-plugin` and `WebpackManifestChecksumPlugin`):
```json
{
  "renderer.js": "renderer.349f8366….js",
  "renderer.js.map": "renderer.349f8366….js.map",
  "vendors~renderer.js": "vendors~renderer.8fbb0f24….js",
  "checksums": { "renderer.349f8366….js": "<md5>", "vendors~renderer.8fbb0f24….js": "<md5>" }
}
```

New manifest: **the same shape**, generated by a small Vite plugin:
```json
{
  "core.js": "core.a1b2c3.js",
  "preload.js": "preload.d4e5f6.js",
  "windows/main.js": "main.778899.js",
  "highlighter-page.js": "highlighter-page.0a1b2c.js",
  "main.css": "main.3d4e5f.css",
  "checksums": { "core.a1b2c3.js": "<md5>", "main.778899.js": "<md5>", "...": "..." }
}
```
- **Same rules:** logical name → content-hashed file name, plus an md5 `checksums` entry per file.
  The bundles directory is flat (no subfolders) and `.map` files sit next to their files, exactly as
  today. The release upload of `bundles/` therefore works unchanged, provided it copies every file in
  the folder (today's build already emits more than two files). Owner to confirm with release
  engineering. Old clients read only their own version's manifest, so they never see the new one.
- **Same flow** (`bundle-updater.ts`, generalized from the `BUNDLE_NAMES` pair to all manifest
  entries):
  1. Fetch `{version}/bundles/manifest.json` (or `manifest-qa.json` with `--bundle-qa`).
  2. For each file, use the copy in the app's `bundles/` if present. Content hashing means unchanged
     files are never downloaded. Otherwise use the cached copy if its md5 is valid, otherwise
     download it.
  3. **All files succeed or the whole set reverts to local.** The manifest is cached only after
     every file is valid; this is today's logic, which is already atomic per set.
  4. The progress window appears after 10 s, and fallback goes cached → local, as today.
  5. `--local-bundles`, `force-local-bundles` and the non-production → local rule are unchanged.
- **Serving:**
  - Windows: `slbundle://` keeps mapping a file name to its local or cached path, now registered
    with `protocol.handle` as a privileged standard, secure scheme, so ES modules and dynamic
    `import()` work. Relative chunk imports resolve to `slbundle://…/<file>` and go through the same
    map.
  - Core process (Node resolves files by path): when a server set is active, the updater completes
    the cache folder by copying the unchanged local files into it, so the folder holds the full set.
    The core forks from there. Preload is loaded the same way.
- `getBundleNames` (used for Sentry stack traces) is kept and returns the full map.

### 8.4 Native modules (R2, R5, R9)
All are existing prebuilt binaries. **The M0 gate:** every native module the new app uses must load
and work under Electron 45. Those are obs-studio-node (in the utilityProcess), crash-handler,
font-manager, node-fontinfo, node-libuiohook, game_overlay, color-picker, node-window-rendering
(mac), node-win32-np and node-screenshots. A module that is not N-API/ABI-compatible blocks
Electron 45: escalate to its owner, or fall back to the newest compatible Electron.
`realm` is not used by the new code (§3.3).

---

## 9. Delivery plan

Coding is done by **Sonnet subagents** with narrow briefs. The main session writes the briefs and
verifies every result (typecheck, lint, build, run, bench, review) before accepting it.

| Milestone | Content | Exit criteria |
| --- | --- | --- |
| **M0 Skeleton and delivery proof** | Move the old app to `legacy/`. npm + Vite + Electron 45 project: main, preload, core utilityProcess, MessagePort protocol, store and slices, one Vue window in the current look, bundle updater generalized to all manifest entries (same format), electron-builder config. Native-module load check. | App builds and packages with the same layout and exe. Installs over a prod build via the real update flow. A hotfix set is picked up, a corrupted one falls back. All native modules load in Electron 45. Skeleton RAM measured. |
| **M1 Media core and editor** | MediaBackend and obs adapter, scene collections (load/save compatible), scenes, sources, scene items, preview display, mixer with meters, editor UI. | Opens an existing user's scene collection unchanged. Preview and mixer work. Idle budget measured (≤ 250 MB path). |
| **M2 Outputs and go-live** | Recording, replay buffer, virtual cam, streaming with a stream key, platform adapters (Twitch, YouTube, Facebook, TikTok, Kick, X, Instagram, Patreon), login, go-live dialog, multi-canvas (dual output), multistream. | Record and go live on each platform. Recording CPU budget met. |
| **M3 Settings and dialogs** | All settings pages, source properties, filters, transitions, hotkeys, projectors, scene-collection manager, notifications, themes, i18n. | Feature parity checklist for core. Dialog budgets met. |
| **M4 Compatibility** | External API catalog and contract tests, Platform Apps API, slobs:// links, data migration from legacy stores. | Catalog contract tests pass. Migration works on real fixtures (typical, power user, logged out). |
| **M5 Features** | Ported one by one behind the registry: widgets, chat, app-store, highlighter, guest-cam, ai/vision, media, onboarding, importers, diagnostics, marketing, cloud sync, remote control. | Each: parity checklist, zero cost when disabled (bench), loads on first use. |
| **M6 Hardening and release** | Crash handling, Sentry, logging, shutdown, full bench matrix, e2e suite, delete `legacy/`. | All budgets met. Upgrade from current prod verified end to end. |

## 10. Risks and open items
| Risk / item | Mitigation |
| --- | --- |
| A native module is incompatible with Electron 45 | M0 gate first; escalate or pick the newest compatible Electron |
| obs-studio-node behaves differently in a utilityProcess (env, paths, callbacks) | Proven in M0/M1 before UI work |
| Hotfix upload: the format is unchanged, but more files | Confirm the upload copies all files in `bundles/` (owner forwards §8.3) |
| Realm data migration needs the realm module | Allowed (already installed); verify in M0 |
| External API surface is larger than expected | Catalog generated mechanically; contract tests |
| macOS untested (R7) | Keep it compiling; mac-specific paths isolated in main |
| Scope of one big release | Milestone exit criteria; bench and parity checklists per milestone |
