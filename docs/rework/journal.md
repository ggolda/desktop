# Rework journal

Append-only. Newest at the bottom. Keep entries short: what was done, what was
learned, where we stopped, what's next.

---

## 2026-11-17 — Kickoff, docs structure

- **Did:** created `docs/rework/` (README status board, goals, roadmap,
  benchmarking methodology, hypotheses backlog, ADR-0001/0002); added a pointer to
  the rework in `CLAUDE.md`.
- **Learned:**
  - Electron is already **43.8.3**, so the 45.x upgrade is a small step.
  - OBS runs out-of-process (`obs64.exe` via `obs.IPC.host`) → must be part of
    measurements; the budget definition needs owner input.
  - Vite migration will need **Vue 2.6 → 2.7** (required by `@vitejs/plugin-vue2`).
  - Existing `test/performance/` measures startup/CPU/memory in WDIO tests — useful
    reference, but we'll build an external harness (see benchmarking.md).
  - Codebase: ~421 service files / 95 registered services, ~340 React `.tsx`,
    ~46 `.vue` files.
- **Stopped at:** waiting for owner answers to goals.md Q1–Q5.
- **Next:** build the Phase 0 harness.

## 2026-11-17 — Owner answers

- Target = Electron tree; obs64 reported separately. Scenarios S0/S1/S1u/S2, all
  logged in. Reference = owner's laptop. `reborn` is an isolated PoC: no master merges.
- Electron upgrade deferred. Yarn → npm added to Phase 1 (with Vite).
- ADR-0002 accepted.

## 2026-11-17 — Benchmark harness

- **Did:** `yarn install` (the Electron binary didn't download during install; fixed
  with `node node_modules/electron/install.js`), `yarn compile:production`. Built
  `scripts/bench/` (runner, PowerShell sampler, in-app hook gated by
  `SLOBS_BENCH_OUT`, focus-steal helper, fixture maker); one `require` line added to
  `main.js`; `.bench/` gitignored. Smoke-tested S0/S1/S1u/S2 with an empty
  (logged-out) fixture — all scenario checks pass.
- **Learned:**
  - Must launch with `--local-bundles`, or the bundle updater pulls release bundles
    from the CDN over our build (`updater/bundle-updater.ts`).
  - Smoke numbers (not a baseline): Electron ≈ 690 MB, GPU process largest
    (≈ 212 MB), hidden child window ≈ 121 MB; idle CPU ≈ 1–2 % of the machine.
  - Found shutdown hang I1 (see hypotheses.md).
- **Stopped at:** need a logged-in fixture.
- **Next:** owner runs `make-fixture.mjs`; then run the full baseline on an idle machine.

## 2026-11-17 — First baseline

- **Did:** owner created the logged-in fixture. The 90-min single-mode baseline was
  stopped after one S0 run at the owner's request (too slow); its timeline showed
  memory settling only after ~4 min, so I added **sequence mode** (one launch, all
  scenarios, ~7 min) as the default. Fixed scenario control: S1u focus now via an
  in-app `BaseWindow`; focus check uses the foreground-window owner PID (the OBS
  preview window belongs to obs64). The sampler now also covers OBS helper exes and
  labels obs64 CEF subprocesses. Wrote [baseline.md](baseline.md).
- **Learned:** Electron ≈ 1250 MB, of which 18 platform-app BrowserViews ≈ 605 MB.
  Idle CPU 0.6–0.9 % of the machine, barely affected by minimize/preview-off. Native
  OBS ≈ 330 MB incl. ~190 MB of CEF.
- **Stopped at:** proposed first fixes in baseline.md; waiting for the owner to pick the order.

## 2026-11-17 — Typical-user baseline

- **Did:** owner created a `typical` fixture (fresh account, no apps); ran the
  sequence benchmark on it. Relaxed the S1u check (another app in the foreground is
  fine for S1u).
- **Learned:** typical user Electron ≈ 558 MB / 0.77 % CPU (0.28 % minimized).
  Gap to 400 MB ≈ 150 MB; the warm child window alone is 94 MB. Idle CPU in this
  fixture comes from the main window + GPU repainting while visible. Shutdown hang
  I1 reproduced in normal use.
- **Next:** owner decides on the child-window trade-off; start profiling idle repaints.

## 2026-11-17 — ADR-0003 trial: child window on demand

- **Did:** owner chose "on demand + destroy, fall back to in-app dialogs". Implemented
  in `main.js` (`createChildWindow`, `window-ensureChildWindow`, close instead of hide,
  `SLOBS_WARM_CHILD=1` keeps the old behaviour) and `app/services/windows.ts`
  (`ensureChildWindow`, null-safe child access); `touch-bar.ts` guarded. Added
  `dialog <name>` to the bench hook and `scripts/bench/dialog-latency.mjs`.
- **Learned:** −91…−112 MB WS (Electron 446 MB). Dialogs: 0.7 s (Add Source) /
  1.25 s (Settings) to paint vs ~0.1 s warm. Found I2: crash handler kills the app
  when a registered renderer exits — on-demand child is no longer registered.
- **Stopped at:** owner verdict on the latency.

## 2026-11-17 — Direction change: no legacy constraints

- Owner directive (ADR-0004): current architecture/dependencies are not constraints;
  build the proper long-term design. Separate windows stay (multi-monitor, native
  preview, isolation), but each window must load only what it needs.
- Measured bundle composition: 8 compiled antd themes = 5.2 MB (28 %) of bundled source,
  libraries 39 %, services 16 %, React UI 13 %, Vue UI 3 %.
- Wrote [architecture-vision.md](architecture-vision.md): core in a Node-only
  `utilityProcess` (no worker renderer), direct MessagePorts (main process not a router),
  async typed RPC + slice subscriptions (no full-state copies, no broadcasts, no sync
  calls), one entry per window, CSS-variable theming, UI framework chosen by spike.
- In-app dialogs dropped; on-demand child (ADR-0003) kept as interim.
- **Next:** owner review of the vision; Phase A spike.

## 2026-11-17 — Scope correction

- Owner pointed out the architecture-vision doc jumped ahead of the agreed phase plan
  (measure → fix → re-measure; architecture/stack consolidation is the final phase).
  Vision parked as a draft for Phase 5; status board back on Phase 3. ADR-0004 stays:
  fixes are designed without legacy constraints, but within the phase plan.

## 2026-11-17 — Dialog direction recorded

- Agreed: dialogs = separate windows with very thin, isolated, fast content; underlying
  architecture decided later (ADR-0003, "Agreed direction"). Moving on to H16 (idle repaint).

## 2026-11-18 — Idle repaint (H16)

- **Did:** added passive IPC counters + `trace <sec>` (contentTracing + CPU profiles) to the
  bench hook and `scripts/bench/trace-idle.mjs`. Found two per-vsync rAF loops in the main
  window (GLVolmeters, OverlayScrollbars autoUpdate). Fixed: volmeters draw only on visible
  change (≤ 30 fps, timer-scheduled, ResizeObserver instead of 500 ms polling, theme via
  `settingsChanged`); Scrollable wrappers use `autoUpdate: null`.
- **Learned:** main window 239 → 30 frames/s, main-thread frame work ~10×  lower; process
  CPU of the main renderer ≈ halved. IPC at idle is negligible (H5/H10 rejected for idle).
  Remaining 30 fps comes from meters reacting to mic background noise (H17).
- **Caveat:** both post-fix benchmarks had failed scenario checks (foreground taken by another
  app ~45 s in; S0 window un-minimized mid-sample). Runner now records the foreground
  process name. S0 numbers of those runs are invalid.

## 2026-11-18 — Meters 15 fps, pause when hidden, spare renderer

- Owner: meters at 15 fps. Done (peak hold 100 → 50 draws to keep ~3.3 s). Also: meters
  unsubscribe while `document.hidden` (H17), `disable-features=SpareRendererForSitePerProcess`
  (H13), fixed I3 (`=` vs `===` in `unsubscribeVolmeter`).
- Owner needs the laptop during the day → benchmarks are batched for when the laptop is
  free; the 15 fps benchmark run was stopped before recording. Build is current for 15 fps
  only; the later changes need `yarn compile:production` first.

## 2026-11-18 — Platform-app pages on first open (H6)

- `PlatformContainerManager.registerApp` created a BrowserView for every `persistent`
  page at startup. Now only `background` pages start at registration; persistent pages
  are created on first mount and then kept (existing `getContainerInfoForSlot` path).
  Added a log line per container created. Needs a power-user (`default` fixture) run to
  measure and to see how many of the 18 views were background pages.

## 2026-11-18 — Batch results + GPU process investigation

- Batch (owner away ~30 min): typical Electron **415–435 MB**; power user **~430 MB**
  (was ~1250; log: 0 app pages at startup). Spare renderer gone.
- The foreground thief in recent runs is **WindowsTerminal** (the terminal hosting the
  Claude session) ~45 s into each run → "S2 focused" ≈ visible-unfocused. Harmless for
  memory; S0 checks of some runs still flaky.
- GPU experiments (S2, typical): base 423 MB / 0.18 %; HA off 327 MB / 0.53 % (GPU process
  140 → 46 MB, CPU up); meters hidden 412 MB / 0.14 % (meters = most of main+GPU CPU);
  low-power GPU = no change (iGPU already active). memory-infra: GPU footprint 216 MB is
  mostly driver path (win_heap 39, shared_images 41, cc 18); renderers ~170 MB footprint
  each with ~31 MB script source cache + ~43 MB V8 → bundle size matters (H18).
- Fixed analyzer: memory dumps are split across trace events.

## 2026-11-18 — Target 250 MB; remaining idle CPU

- Owner lowered the memory target to 250 MB (ADR-0005).
- Trace with timer stacks: main window timers = meter draws (GLVolmeters, ~15/s per draw
  cycle) + one pre-existing interval (~13/s); worker = store flush (1/s), performance stats
  (`performance.ts`), socket pings. Worker JS ≈ 10 ms/s, mostly volmeter forwarding
  (`audio.ts`) + OSN callbacks. Stack capture inflates setTimeout cost → don't use for CPU.
- Found H19: main window background throttling disabled → meters never pause, timers run
  while minimized/occluded. H20: obs64 ≈ 0.35–0.4 % is the biggest idle CPU item now.
  H21: non-ASCII in bundles → two-byte script storage; `ascii_only` enabled (unbuilt).

## 2026-11-18 — Meters rework + ascii_only measured

- A/B (preview off): meters were 0.33 % of 0.48 % Electron idle CPU and ~37 MB.
- Implemented together: 2D CPU-backed canvas replaces WebGL (same look as the shader),
  10 fps, ≥ 2 px change threshold, pause while the main window is unfocused/minimized
  (window focus events — chat BrowserView focus doesn't count), worker forwards ≤ 20 Hz with
  max-merged peaks. Mixer no longer probes WebGL. Hook keeps focus in S1/S2 (re-takes it once
  if stolen; logged as `refocused`).
- Result: focused 0.27 %, unfocused 0.08 % (same as hidden); meter memory ~14 MB.
  ascii_only: −17 MB per renderer. Electron ~386–403 MB (preview off).

## 2026-11-18 — Hardware acceleration stays on (ADR-0006)

- Owner rejected disabling HA. GPU process (~145 MB) becomes a mostly fixed cost; only
  HA-on reductions (GPU flags, fewer surfaces) are in scope. 250 MB now needs the GPU
  process to shrink with HA on — not yet shown to be possible.

## 2026-11-18 — Minimal Electron floor; worker-only bundle

- Measured a minimal Electron 43 app (`scripts/bench/minimal-app`, `minimal-floor.mjs`): 1 window,
  HA on, static page = **116 MB** (GPU 69, main 25, renderer 15, network 7); +1 hidden window
  +27 MB; with full-window real content GPU ≈ 105 MB (solid-color pages need no tiles). Our GPU
  process ≈ 145–150 → ~40 MB app-specific extras; renderers ≈ 15 MB base + ~85 MB ours each.
- memory-infra comparison of GPU processes (`memdump.mjs`) + layer dump (`layers.mjs`): only 4
  composited layers; the main cost is full-window tiles at 2566×1521 physical px (inherent).
- **Worker-only bundle**: `app/worker.ts` (worker path of app.ts without UI), `worker.html`
  (same CSP-hashed inline script), `webpack.worker.config.js` (separate compilation; stubs 18 UI
  modules + streamlabs-beaker with `app/util/worker-ui-stub.js`; keeps ObsInput.ts, shared/widgets
  inputs index (metadata), service-provider (plain getResource proxy); adds worker.js to the
  manifest). `main.js` loads worker.html when the build has worker.js (`SLOBS_FULL_WORKER=1` =
  old path). `settings.ts` uses @Inject instead of the React Services proxy. worker.html added to
  electron-builder files. Bundle 16.3 MB → 4.5 MB; worker ~93 → ~59 MB WS (smoke run).
  Functional checks: app boots, dialogs (Settings/Add Source) load data, no new errors.
- **Risk:** stubbed UI modules are no-ops in the worker; any worker code path that really uses
  one would silently misbehave → needs a manual test pass of the main features.

## 2026-11-18 — Recording CPU (owner report: 600 MB / 3–5 % while recording, logged out)

- Added S3 (recording) to the harness (`record on/off`, recordings redirected to the run folder),
  `logout` hook command and a `loggedout` fixture (copy of typical, logged out).
- Measured: recording raised Electron CPU 0.3 → 2.5 % (GPU + main window), logged in or out;
  obs64 +280 MB while recording (encoder, native). Trace: ~220 frames/s, 440 paints/s, no JS →
  the REC button's CSS box-shadow pulse animation. Replaced with a 10 fps JS-driven glow →
  recording 0.55 %.
- Memory: our WS during recording ~384–417 MB, private bytes ~575–620 MB — the owner's "600 MB"
  likely corresponds to private/commit or a longer session; to clarify.

## 2026-11-18 — Why one animation costs so much

- Owner asked whether the REC-pulse cost is framework misuse. Measured the same CSS animation in the
  minimal Electron app (always-on-top): empty page 2.13 %, content page 2.42 % vs idle ~0 % —
  equal to Streamlabs' 2.51 %. It's Chromium's per-frame cost at 240 Hz on a large high-DPI window.
  Guideline added to hypotheses.md: no infinite animations in always-visible UI.

## 2026-11-18 — Cheap memory experiments

- Batch of 7 short runs (base twice). Only the lazy notification `Audio` (−6 MB, audio service gone)
  is a confirmed win. Worker-no-paint, lazy game_overlay, V8 optimize-for-size, low-end mode: no
  measurable effect; no-GPU-raster worse. Toggles reverted. GPU process noise ±10–20 MB.
- Remaining memory work is code: main window bundle diet (themes, lazy-loaded dialog libs), worker
  trims / services out of Chromium.

## 2026-11-18 — Streaming memory (owner: 600–650 MB when streaming) — analysis, no benchmark

- Cause: live dock auto-expands on stream start → platform chat website in a BrowserView (own
  renderer). Never destroyed, leaked on logout; multistream adds a second, unthrottled chat page.
- Changes (typecheck only, not run): ChatService/RestreamService destroy the chat page 60 s after
  it was last shown; ChatService closes it on logout and tracks its settings subscription; LiveDock
  StreamTimer 200 ms → 1 s. Trade-off: re-opening the chat after > 60 s hidden reloads it (platform
  chats show only new messages after reload).
- Still costly while the chat is visible: it's a full website. Options for later: native chat UI
  from platform APIs (big), lighter chat page, emulate prefers-reduced-motion for animated emotes.
- Next: S4 (streaming) scenario in the harness to measure — needs a safe streaming target.

## 2026-11-18 — Chat scenario, chapter 1 closed

- S5 (live dock + chat) on the Twitch account: chat page +159 MB (118 MB page, ~22 MB GPU, 12 MB
  iframe renderer); quiet chat ≈ 0 CPU. Streaming CPU must come from live chat traffic/animated
  emotes, meters, stats — busy-chat test not done yet.
- Found `video.ts` preview-position polling (500 ms, also tracks position — kept).
- Owner field report: production ~2.6 GB vs PoC ~600 MB while streaming with chat.
- Wrote [POC-REPORT.md](POC-REPORT.md) for the main team; chapter 1 ("minimal changes") closed.

## 2026-11-18 — Chapter 2 kickoff: architecture for 2027+

- Owner goals: PERFORMANCE, MODULARITY, FUTURE-PROOF. Requirements: keep the current auto-updater and
  distribution logic; don't touch the OBS backend (only how we talk to it); deliverable to existing
  users through the existing update mechanism. Optional features (app store, vision, …) as modules that
  can be disabled and not loaded; media backend abstracted (OBS = one implementation). Carte blanche on
  framework / state / CSS (owner likes UnoCSS + Tailwind preset + shadcn); Vite if compatible.
- Owner decisions: **Windows + macOS** first-class; **100 % compatible**: external API, platform apps
  API, user data, slobs:// links; **one big release**; framework choice **performance first**.
- Discovery (3 parallel read-only investigations), saved in chapter2/: distribution (differential
  per-file updater; whole new architecture deliverable via normal app update if layout/exe/userData/
  bootstrap contract stay; generalized bundle updater + privileged scheme needed for Vite/ESM),
  OBS (OSN is N-API, client can move to a utilityProcess; blockers are our wrapper/remote/ipcRenderer;
  MediaBackend sketch), modules (31 forced @InitAfter inits; one 67-feature dependency cycle; core →
  optional edges listed; extension points needed; compatibility surfaces).

## 2026-11-18 — Owner answers (chapter 2)

- External API: must stay compatible with **everything reachable today** (incl. internal-service
  fallback) → legacy compatibility layer + generated catalog as contract.
- Disabled-module data: explained (kept verbatim) — to confirm in the module discussion.
- Multi-canvas: core. Modules: owner thinks of "big modules talking over a bus, like OBS plugins" →
  draft in chapter2/modules-proposal.md for discussion.
- Kevin: on demand (no socket at startup).
- **Bundle hotfixes must keep working for all JS** (windows, modules, core process), atomic sets,
  self-heal — owner reminded that the frontend is updated separately; release tooling for hotfix
  manifests is outside the repo (owner to identify owner/format).
- Framework experiments started: experiments/framework-bench/ (isolated npm project; Vite 8, UnoCSS
  66 + Tailwind reset; mock core in utilityProcess over MessagePort; sandboxed windows; vanilla
  reference; ports by parallel agents: Svelte 5, Solid 1.9 (Solid 2 tooling not stable), Vue 3.6 RC
  classic + Vapor, Preact 11 + signals, React 19).

## 2026-11-18 — Framework micro-benchmark results

- Full run: 7 implementations × 4 cases × 3 runs, no errors. Results in
  [chapter2/framework-bench-results.md](chapter2/framework-bench-results.md).
- Finding: a framework costs +2–7 MB per window over plain DOM. The spread between frameworks is
  about 2.5–3.5 MB. Cold open is identical (about 175 ms editor, about 210–230 ms dialogs). Idle CPU
  is the same for all; busy CPU is 0.22 % (vanilla) to 0.28 %. Bundles: Solid 10 KB → React 70 KB
  gzip. **The framework is not the bottleneck**: the Electron base and the GPU process dominate.
- Side finding: 8 DOM meter bars at 10 Hz cost about 0.65 % in the GPU process in every framework,
  including vanilla. Meter rendering design is a separate experiment.
- Recommendation to the owner: Svelte 5 or Solid (performance first, shadcn-style headless libs);
  React is viable if migration cost dominates. Optional scale test before deciding.
- **Owner decision: Vue 3** (company stack), with tooling from the Highlighter app → ADR-0007 (sandboxed
  windows and the existing distribution kept; Pinia as a window-local view of core state).
- Module discussion: the plugin-style design (manifests/slots/contribution points) was rejected by the
  owner as too complex. Revised direction: **modular monolith with lazy feature packages** (core incl.
  platforms; big optional features in `features/*` with lazy service + UI, public `api.ts`, a
  hand-written registry, lint-enforced boundaries). See modules-proposal.md §10.

## 2026-11-19 — Chapter 2 agreement checkpoint

- Module model agreed: one-way dependencies (features → core), core wires features only via
  `features/registry.ts` (nav / go-live extras / settings pages / docks read from it), features load on
  first use (tab open or opted-in event), core = only what streaming needs (platform adapters lazy).
- RAM estimate for the new architecture: typical idle ~250–270 MB (range 215–315); core process not
  measured. The owner declined the extra core-process experiment; it will be measured during
  implementation.
- Next: write chapter2/SPEC.md; open items listed for the owner (release tooling/hotfix manifest,
  mac signing, Electron/OSN version, design, master-sync strategy, feature list, who disables).
- Owner answers: no new native modules; Electron 45.x; ignore master (short rework); no mac signing or
  tests; keep the current look; feature list OK; enablement = code + user flags; no isolation at first;
  coding by Sonnet subagents (ADR-0008). Owner did not know the hotfix tooling, so the hotfix flow was
  explained in SPEC §8.3, with an action to confirm the upload of the whole bundles/ dir.
- **chapter2/SPEC.md v0.1 written** (process model, IPC/state, media backend, modular monolith, UI,
  compat, build/distribution incl. hotfix v2, milestones M0–M6, risks).
- Hotfix: keep the existing manifest format (logical → hashed name + md5 checksums, flat bundles/); only generalize the file list (SPEC §8.3).

## 2026-11-19 — M0 started

- **Native gate passed** (experiments/native-gate): Electron 45.4.1 (Node 24.22, ABI 150). All 10 existing
  prebuilt natives load in main and in a utilityProcess, with no rebuild. OSN works fully from a
  utilityProcess (init 1.7 s, scene and source created and read, clean shutdown 5.2 s; obs64 exits
  about 12 s after disconnect). Core utilityProcess memory: empty 21 MB private, with all natives
  and OSN init 73 MB private (120 MB working set).
- M0 scaffold delegated to a Sonnet agent: legacy → legacy/, npm + Vite + Vue 3 + Electron 45 project
  in src/ (main / preload / core / windows), smoke test.
- **M0 scaffold done** (verified): legacy/ moved with history; npm + Vite 7 + Vue 3.5 + Electron 45.4.1;
  src/{main,core,preload,windows,ui,shared,features}; ESLint boundary rules; smoke: OBS init ≈1 s,
  window shown ≈160 ms, ping ≈1.5 ms. CLAUDE.md rewritten for the new layout (old one in legacy/CLAUDE.md).
- **M0 protocol done** (verified): call/result, sub/snapshot/patch (recording proxy, ops s/d/x/l, batched
  per microtask, rev + resubscribe), events, lazy slice factories, meters channel only while subscribed;
  vitest 20/20. A rename in a 60-item list gives a 75 B patch.
- **M0 distribution done** (verified): manifest in the existing format (logical → hashed, md5), bundle
  updater generalized (same flags and flow), slbundle:// via protocol.handle (privileged) + CSP header,
  core/preload loaded from the complete active set dir (core-loader.cjs sets NODE_PATH), legacy startup
  flow (bootstrap/mac updater, crash-handler, slobs://), electron-builder files updated, Vue 2 updater
  UI → static page. test:hotfix 13/13 (good set / bad md5 → local / offline → cached); packaged
  win-unpacked runs. Open: crash-handler clean exit (in progress), release-engineering upload check.
- Crash handler: core is unregistered before shutdown, then terminateCrashHandler. Smoke runs with the
  handler on: exit 0, nothing left over. Killing core → handler terminates the app (as legacy); obs64 is
  orphaned in that case (TODO M1: obs64 cleanup on core crash).
- **Skeleton RAM** (private WS, idle, 25–45 s after start; Vue window + core with OSN initialized):
  Electron tree **157 MB** (largest process 88 MB, others 30/17/16/7), CPU 0 %. obs64 35 MB and
  crash-handler 2 MB are outside the tree.
- Remaining M0 exit item: install over a prod build via the real full-update flow (needs a CDN-hosted
  build or a local mirror plus a disposable prod install) and the release-engineering upload check.

## 2026-11-20 — M1 started (media core and editor)

- M1a design (Sonnet): chapter2/m1-design.md + contracts (scenes, sources, audio, display, collections,
  main-rpc). Key finding: collection files are `JSON.stringify(x, null, 2)`; parse → serialize is
  byte-exact on all 5 fixture files → document model that re-emits unchanged nodes, dirty tracking by
  command (legacy rebuilds the whole file from OBS on every save).
- Decisions on open questions: blocking OSN calls accepted (instrumented, revisit at >50 ms stalls);
  unavailable sources kept and shown as unavailable; dirty saves + full re-read at shutdown and
  collection switch; dual output / transitions editing / hotkeys / filters / widgets / guest cam
  preserved verbatim and inert in M1; OBS config files are never written in M1.
- M1b launched as 3 parallel Sonnet agents: core (backend, OBS adapter, collections, slices), editor UI
  (current look, fake core for tests), main (native-handle RPC, obs64 orphan cleanup, window state).
- **M1b done** (verified: build/typecheck/lint, 115 tests, smoke, test:collections on all fixtures).
  Real run with the typical fixture: collection ready ≈1.5 s after core start (OSN init ≈0.9 s,
  createSources ≈0.56 s); live preview and real scenes/sources/mixer. **Electron tree ≈198 MB idle,
  0 % CPU** (core + Vue editor + OBS preview). The collection file is untouched on load (a .bak copy
  is written, as legacy does). obs64 needs up to ~25 s to exit after quit.
- Found in the real run → M1c fix agent: mixer shows -Inf for volume 1, default menu bar, preview
  bg/padding colors, gap above the dock, real meters untested.
- M1c fixes (verified, 116 tests): fader volume applied from the collection (OSN volume readback is
  garbage right after createSources), real meters verified (test:meters, ≤13 frames/s, off when
  blurred), menu bar removed, preview padding color linearised (OBS encodes it to sRGB), gap fixed.
  Open: OBS doesn't draw the selection box yet.
- **Owner: UI/UX must look and behave like legacy** (the first editor used lucide icons, a different
  layout and styles). Recorded in SPEC R10 + new §6.1 (parity process: reference screenshots → same
  assets/structure/behavior → side-by-side check), ADR-0008, CLAUDE.md, memory. Reference capture
  started: legacy worktree at b995c47ff run on a temp profile (SLOBS_CACHE_DIR) with fixture
  collections → docs/rework/ui-reference/editor/.
- **Editor rebuilt to legacy parity** (Sonnet, verified: 118 tests, smoke, lint/typecheck): frameless
  window + legacy title bar, top nav, preview / Mini Feed / dock with resize bars, footer, icomoon +
  Font Awesome + bundled Roboto, legacy colors and sizes from metrics.json, native context menus via a
  typed main RPC, Name dialog (legacy has no inline rename), legacy preview padding color restored,
  lucide removed. Side-by-side composites in test-results/parity/editor/ (legacy | new | diff).
  Remaining differences: widget icons (type not in the slice), disabled unimplemented menu items,
  mixer scrollbar style, Mini Feed inert.
- Note: src/ was still untracked in git when this was written. The owner should commit to protect the work.
- **Editor overlay done** (verified: 171 tests, smoke, collections): OBS selection box fixed (root
  cause: bulk addItems has no video context; now per-item scene.add with the canvas context, as
  legacy). Click select / ctrl / cycle, drag with snapping, resize with aspect lock (Shift frees),
  Alt-crop, nudge, Delete, native preview menus; geometry fetched on demand from core
  (editor.getGeometry), transforms ≤30/s with the exact final value, no rAF. Nav bottom border added.
  Behavior deviations to align with legacy: Delete confirms (legacy doesn't), Shift+arrow = 10 px
  (legacy has none), 2 px drag threshold.
- Incident: an agent's real-mouse test clicked into the owner's browser. New rule: no real OS input
  (CLAUDE.md "Automation safety", memory).
- Behavior alignment: legacy DOES confirm Delete (global-selection.ts:62; the earlier claim was
  wrong), so the confirmation stays. Arrows only nudge unmodified; drag starts on the first move.
  Folder-selection setting deferred to M3 (settings).
- Dialogs design (m1-dialogs-design.md + contracts dialogs/source-types/properties + main-rpc
  dialogWindow/dialog.showOpen) and 24 legacy dialog references in ui-reference/dialogs/. Legacy:
  one unparented non-modal child window replaced in place; edits are live; Cancel/Done/Close only
  close; Add Source → name → Source Properties. Decisions: as legacy; feature source types hidden;
  probe OSN `modified` behavior first; font-manager (existing prebuilt) loaded lazily; Advanced Audio
  and undo deferred to M3.
- Dialogs implementation launched: A (core + main) and B (dialog UIs, legacy parity) in parallel.
- Dialogs A (core + main) done: OSN probe confirms re-reading properties applies `modified`
  callbacks; dialog window manager (one unparented frameless window replaced in place), catalogue
  (17 types), Add Source orchestration, properties slice with diff and fonts via lazy font-manager,
  legacy creation defaults fixed. Dialogs B (UI) done: 6 thin dialog entries, a form for every
  property kind, legacy parity side-by-sides in test-results/parity/dialogs/ (close match).
  Verified: 232 tests, smoke, collections.
- E2E dialogs agent launched (real UI over CDP on real OBS: add/rename/properties/remove,
  persistence, dialog cold-open timing, memory with a dialog open).
- **E2E dialogs green** (test:dialogs, 70 assertions, rerun by me): add/rename scene, Add Source →
  name → properties replaced in place, image file / color / text + 263 fonts / browser custom fps,
  Cancel doesn't revert, add existing, Delete + confirm, properties of a removed source auto-close,
  persistence across restart. Bugs fixed: a reactive proxy can't be structured-cloned (send plain
  arrays); sources without scene items are now removed (legacy scenes.ts:693-702 removes unreachable
  non-channel sources).
- **Dialog cold open 84–125 ms** (budget 250). Memory: Electron 187 MB without dialog → 215 MB with
  Source Properties → 183 MB after closing (back to baseline).
- **Dialog open made flicker-free** (verified: fast tier + test:dialogs incl. a first-frame check).
  Causes recorded frame by frame: shown on ready-to-show while still empty, late fonts, focus-ring
  transition, visible reload and resize on in-place replace, black native preview for ~40 ms. Fixes:
  hidden until the page signals ready (data + fonts + painted, 300 ms fallback), opacity-0 show
  against the compositor race, font preload, replace by a new hidden window then destroy the old one,
  native preview parked off-window until drawn. First visible frame = final UI; click → visible
  110–190 ms (≈30–50 ms later than before, in exchange for showing it complete).
- Owner: test runs were too long (one agent took 35 min). New verification tiers in CLAUDE.md +
  memory: fast tier while iterating, only the relevant OBS test once at the end.
