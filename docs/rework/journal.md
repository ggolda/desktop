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
