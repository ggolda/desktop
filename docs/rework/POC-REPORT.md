# Streamlabs Desktop — performance PoC report

*Branch `reborn` (personal fork), November 2026. Status: chapter 1 complete — "how far can we get
with minimal changes".*

## TL;DR

Streamlabs Desktop's Electron side used far more memory and idle CPU than the work it does
justifies. Most of it came from **a handful of specific, fixable things**, not from the
architecture. With targeted changes (no rewrite, no framework migration) we measured:

| Electron process tree | Production baseline | PoC |
| --- | --- | --- |
| RAM, idle, typical user (logged in, no platform apps) | **558 MB** | **~360–390 MB** |
| RAM, idle, power user (~18 platform apps installed) | **~1,250 MB** | **~430 MB** *(before the last memory fixes)* |
| Idle CPU, window visible | **0.73–0.79 %** of the machine | **~0.1–0.4 %** |
| Idle CPU, app in the background / unfocused | 0.28–0.73 % | **0.08 %** |
| CPU while recording | **2.5 %** | **0.55 %** |
| Main window frames per second while idle | **239** (240 Hz display) | **≤ 10** (only when something visibly changes) |

Field report from the owner (own Task Manager, logged in with Twitch, streaming with chat open):
**~2.6 GB** in the production build vs **~600 MB** in the PoC build.

The native OBS side (`obs64.exe` and its embedded browser for browser sources, ~330 MB / ~0.4 % idle)
is outside these numbers and was not changed.

---

## 1. How we measured

Without numbers it's guesswork, so the first step was a reproducible benchmark harness
(`scripts/bench/`, details in [benchmarking.md](benchmarking.md)):

- **External sampler** reads Windows per-process counters every second — the same "Memory (active
  private working set)" users see in Task Manager, plus private bytes and CPU time — for the
  whole Electron process tree, labeled per window/webview by a small in-app hook that is inactive
  unless `SLOBS_BENCH_OUT` is set.
- **Production build**, fresh copy of a logged-in user profile per run, ~7-minute "sequence" run
  through user states: **preview on (S2)**, **visible but unfocused (S1u)**, **minimized (S0)**,
  **preview off (S1)**; later also **recording (S3)** and **live dock with chat (S5)**.
- **Profiles:** "typical" (fresh account, no platform apps) and "power user" (real account with
  ~18 platform apps), plus a logged-out copy.
- **Tracing tools:** Chromium timeline + CPU profiles with timer attribution
  (`trace-idle.mjs`), memory-infra breakdowns (`memdump.mjs`), composited-layer dump
  (`layers.mjs`), dialog-open latency (`dialog-latency.mjs`), and a **minimal Electron app**
  (`minimal-floor.mjs`) as the "bare Electron" floor.
- **Reference machine:** Ryzen AI 9 HX 370 (24 threads), 31 GB, RTX 4060 Laptop + Radeon 890M,
  2560×1600 @ **240 Hz**, Windows 11. CPU % is of the whole machine (1 % ≈ a quarter of one core).

**Caveats:** one machine; a 240 Hz high-DPI display makes frame-related costs ~4× higher than on
a 60 Hz monitor; the GPU process varies ±10–20 MB between identical runs, so small differences
need repeated runs. All raw results are in [benchmarks/](benchmarks/) ([SUMMARY.md](benchmarks/SUMMARY.md)).

**Bare-Electron floor** for comparison (same window size, hardware acceleration on): 116 MB for a
static page — GPU process 69 MB (~105 MB with real full-window content), main process 25 MB,
renderer 15 MB, network service 7 MB. Every Streamlabs renderer is ~15 MB of Electron plus ~40–90 MB
of our own code and data.

---

## 2. What we found and fixed

### Memory

#### 2.1 Platform-app pages were all loaded at startup — up to ~800 MB
Every installed platform app's page marked `persistent` got its own browser view (a full renderer
process, ~30 MB each) **at launch**, whether or not the user ever opened the app. On the power-user
account: 18 hidden pages, ~600 MB working set / ~800 MB private.
**Fix:** `persistent` pages are created on first open (and kept afterwards, as `persistent`
promises); only `background` pages start at launch. None of the 18 apps had one.
**Result:** power user **~1,250 → ~430 MB**. *(`app/services/platform-apps/container-manager.ts`)*

#### 2.2 A hidden "warm" dialog window was kept alive all session — ~100 MB
All ~30 dialogs (Settings, Add Source, Source Properties, Filters, Go Live, …) live in one child
window that was created at startup and only ever hidden, to make dialogs appear instantly.
**Fix:** create the dialog window on open, destroy it on close (`SLOBS_WARM_CHILD=1` restores the
old behavior for comparison). **Result:** **−91 to −112 MB** working set (−140 MB private).
**Trade-off:** dialogs now open in ~0.7 s (Add Source) / ~1.25 s (Settings) instead of ~0.1 s,
because each open boots a full copy of the app (11 MB bundle, all service proxies, full state copy).
The agreed long-term direction is separate but *thin* dialog windows that load only what they need
([ADR-0003](decisions/0003-child-window-on-demand.md)).
*(`main.js`, `app/services/windows.ts`)*

#### 2.3 The embedded chat was never freed — ~160 MB while it exists
When streaming starts, the live dock opens and shows the platform's **full chat website**
(Twitch/YouTube/… chat) in a browser view: measured **+159 MB** with Twitch chat open. It was
**never destroyed** — collapsing the dock or ending the stream only detached it — it **leaked on
every logout**, and multistreaming kept a second, unthrottled chat page.
**Fix:** both chat pages are destroyed 60 s after they were last shown and re-created when shown
again; properly closed on logout. **Trade-off:** re-opening a chat hidden for > 60 s reloads it.
*(`app/services/chat.ts`, `app/services/restream.ts` — code-reviewed and typechecked, lifecycle not
yet benchmarked.)* While the chat is visible it still costs a website (see §5).

#### 2.4 Every window loaded the whole app — the worker carried all UI code
The hidden **worker** window runs all services and never renders, yet it loaded the full 16 MB
UI bundle (React, Vue, Ant Design, 8 compiled themes, every component).
**Fix:** a separate **worker-only bundle** (`app/worker.ts`, `webpack.worker.config.js`) that
replaces the 18 UI modules services import with a stub; the bundle shrinks **16.3 → 4.5 MB**.
**Result:** worker **~93 → ~50–59 MB**. *(`main.js` loads `worker.html` when present;
`SLOBS_FULL_WORKER=1` uses the old bundle.)*

#### 2.5 One non-ASCII character doubled script memory in every window — ~35 MB
Chromium/V8 store a script as two-byte text if it contains any non-ASCII character. Our bundles
had a few hundred, so each renderer held ~31 MB of script source for ~16 MB of code.
**Fix:** Terser `format.ascii_only`. **Result:** **~−17 MB per renderer**. *(`webpack.prod.config.js`)*

#### 2.6 Small ones
- Chromium's **spare renderer** (pre-spawned for navigations, useless here): disabled, ~17 MB with apps.
- **Audio service started at launch** by a pre-created notification `Audio` element: now created on
  first play, ~6 MB.
- Volume meters moved from **WebGL to a 2D canvas**: ~−23 MB in the GPU process (see §2.8).

### CPU

#### 2.7 The main window rendered a frame on every display refresh — 239 fps while idle
Two permanent `requestAnimationFrame` loops "checked if it's time": the volume meters (drawing was
capped at 30 fps, but the loop ran every vsync) and OverlayScrollbars with `autoUpdate: true`
(its "200 ms interval" is a per-frame loop). Each rAF forces Chromium to produce a frame.
**Fix:** event-driven meters; scrollbars use `autoUpdate: null` (MutationObserver).
**Result:** main window **239 → 30 → ≤ 10 frames/s**, frame work **63 → 6 ms/s**.
*(`GLVolmeters.tsx`, `shared/Scrollable.tsx` ×2)*

#### 2.8 Volume meters were ~70 % of the remaining idle CPU
A/B with the preview off: 0.48 % with meters vs 0.15 % without. Every meter redraw = a full frame
through renderer → compositor → GPU process.
**Fix:** 2D canvas instead of WebGL, **10 fps**, redraw only on a ≥ 2 px change, **paused while the
main window is unfocused or minimized** (e.g. while the streamer is in a game), worker forwards
≤ 20 updates/s per source (peaks max-merged so spikes still show).
**Result:** **0.27 %** focused with levels moving, **0.08 %** unfocused (= meters hidden).
*(`GLVolmeters.tsx`, `Mixer.tsx`, `services/audio/audio.ts`)*

#### 2.9 Recording made the window animate at 240 fps — 2.5 % CPU
The REC button's glow was a CSS `animation: … infinite` on `box-shadow`, which can't be offloaded
to the compositor: a repaint + full-window composite **every display refresh** for the whole
recording (traced: ~220 frames/s, ~440 paints/s, no JavaScript at all).
**Fix:** the same glow driven from JS at 10 updates/s. **Result: 2.5 → 0.55 %** while recording.
*(`StudioFooter.tsx`, `StudioFooter.m.less`)*

> **Why one tiny animation costs that much** — measured in a bare Electron app with the same CSS:
> **2.1 % on an empty page**, 2.4 % on a content page, vs ~0 % without it. It's not the framework:
> it's one full frame per display refresh × compositing a 2566×1521 px window. On a 60 Hz monitor
> it would be ~4× less — but it's never free.

#### 2.10 Polling
Each editor panel polled its own size every 500 ms and the notifications area every 1 s; replaced
by `ResizeObserver`. The live-dock stream timer ticked 5×/s for a once-per-second value; now 1×/s.

---

## 3. What we tried and rejected

| Idea | Result | Decision |
| --- | --- | --- |
| Disable hardware acceleration | GPU process 140 → 46 MB, but idle CPU 0.18 → 0.53 % (software compositing) | **Rejected** — keep acceleration on ([ADR-0006](decisions/0006-keep-hardware-acceleration.md)) |
| Chromium/V8 switches: worker `paintWhenInitiallyHidden: false`, lazy `game_overlay`, V8 `--optimize-for-size`, low-end device mode, no GPU rasterization | No measurable effect (within run-to-run noise); no-GPU-raster made it worse | Rejected, reverted |
| Force the integrated GPU | Chromium already used the iGPU | No effect |
| In-app (modal) dialogs instead of a dialog window | Would save the same memory with instant opens, but loses multi-monitor dialogs, fights the native preview, and couples dialogs to the main window | Not pursued; thin separate windows preferred |

---

## 4. Bugs found along the way

| ID | Issue | Status |
| --- | --- | --- |
| I1 | **App can hang after quit**: main process + crash handler stay alive after the `quit` event (all other processes gone); the last watchdog is cleared at `quit`. Reproduced in normal use. | open |
| I2 | **Crash handler kills the whole app when any registered renderer exits** (e.g. if the dialog window's renderer crashes). | worked around for the on-demand dialog window |
| I3 | `AudioService.unsubscribeVolmeter` used `=` instead of `===` (picked/renamed the first channel, could close the wrong port). | fixed |
| I4 | Editor panels' "element too small" check never runs (`containerRef.current` is `null` on first render and captured once). | open — UX decision |
| — | Chat page leaked on every logout (see §2.3). | fixed |

---

## 5. What's left

### Smaller wins still available without architecture changes
| Item | Estimated gain |
| --- | --- |
| Main window bundle diet: active theme as one CSS file instead of 8 compiled themes in JS; load dialog-only libraries (CodeMirror, `streamlabs-beaker`, pickers, highlighter, onboarding) on demand | −20 to −35 MB |
| Worker trims guided by a heap snapshot | −10 to −20 MB |
| Chat page in reduced-motion mode (animated emotes) + throttled when the app is not visible | large share of chat CPU while streaming *(to measure)* |
| Worker processes OBS meter callbacks at a lower rate for the "muted / no signal" warnings | −0.05 to −0.1 % CPU |

### Architecture-level options (for the next chapter)
| Option | Expected effect |
| --- | --- |
| Run services in a Node-only `utilityProcess` instead of a hidden Chromium window, with direct channels to windows | −40 to −60 MB (incl. its GPU share), no main-process routing |
| Native chat panel instead of embedding the platform website | ~−160 MB while streaming with chat, much less chat CPU |
| Thin, isolated dialog windows (own small bundle, only the data they need) | dialog opens ~0.2 s instead of 0.7–1.25 s |
| One UI framework and one state model (today: Vue 2 + Vuex + React + Realm) | smaller bundles in every window, less per-frame work |

Rough estimate: the remaining small wins → ~320–340 MB idle; with the architecture options, the
original stretch target of ~250 MB looks reachable with hardware acceleration on.

---

## 6. Trade-offs and risks of the PoC changes

- **Dialogs open slower** (0.7–1.25 s) until thin dialog windows exist.
- **Chat reloads** if re-opened after being hidden > 60 s.
- **Persistent platform-app pages start on first open** instead of at launch; an app misusing a
  `persistent` page as a background job would only start when opened.
- **Worker-only bundle**: UI modules imported by services are stubbed in the worker. Startup,
  idle, dialogs and recording were exercised; any untested service path that genuinely uses one of
  the 18 stubbed modules would silently misbehave — needs a full QA pass.
- **Meters**: 10 fps, freeze while the main window is not focused.
- **Not yet covered by benchmarks**: streaming with a busy chat, long sessions (memory growth),
  60 Hz / lower-end machines.

---

## 7. Team guidelines that came out of this

Added to `/CLAUDE.md` (short) and [performance-guidelines.md](performance-guidelines.md) (with evidence):

1. **No continuous animation in always-visible UI** (`animation: … infinite`, looping spinners, glows).
   If essential: ≤ 10 updates/s from JS, stop when hidden.
2. **No per-frame loops or polling**; use events, `ResizeObserver`, `MutationObserver`.
3. **Live data at visible rates only**, nothing while nobody can see it.
4. **Nothing hidden "for speed"** — no warm hidden windows, views or pages.
5. **Services must not import UI modules.**
6. **Measure before/after**, and test real user states (recording, streaming, background), not just idle.

---

## 8. Try it / reproduce it

- **PoC installer** (installs side by side as "Streamlabs Desktop PoC", own profile, never
  auto-updates, unsigned): `yarn package:poc` → `dist\Streamlabs Desktop PoC Setup <version>.exe`.
- **Run from the repo** on a copy of a test profile: `node scripts/bench/make-fixture.mjs <name>`.
- **Benchmark a change**: `yarn compile:production`, then
  `node scripts/bench/run.mjs --label <change> --fixture .bench/fixtures/typical` (~7 min,
  machine untouched). Profiles are created with `make-fixture.mjs` (gitignored — they contain
  auth tokens).
- **Full trail** (status, decisions, every measurement): [README.md](README.md),
  [journal.md](journal.md), [hypotheses.md](hypotheses.md), [decisions/](decisions/),
  [benchmarks/](benchmarks/).

### Code changes at a glance

| Area | Files |
| --- | --- |
| Dialog window on demand | `main.js`, `app/services/windows.ts`, `app/app.ts`, `app/services/touch-bar.ts` |
| Platform-app pages, spare renderer | `app/services/platform-apps/container-manager.ts`, `main.js` |
| Chat lifecycle | `app/services/chat.ts`, `app/services/restream.ts`, `app/components-react/root/LiveDock.tsx` |
| Worker-only bundle | `app/worker.ts`, `worker.html`, `webpack.worker.config.js`, `app/util/worker-ui-stub.js`, `app/services/settings/settings.ts`, `package.json`, `electron-builder/base.config.js` |
| ASCII-only bundles | `webpack.prod.config.js` |
| Meters | `app/components-react/editor/elements/mixer/GLVolmeters.tsx`, `.../elements/Mixer.tsx`, `app/services/audio/audio.ts` |
| Idle repaint, polling | `app/components-react/shared/Scrollable.tsx`, `app/components/shared/Scrollable.tsx`, `app/components-react/editor/elements/hooks.tsx`, `app/components-react/root/NotificationsArea.tsx` |
| Recording glow | `app/components-react/root/StudioFooter.tsx`, `StudioFooter.m.less` |
| Notification sound | `app/components-react/root/NotificationsArea.tsx` |
| PoC build | `electron-builder/poc.config.js`, `main.js` (`poc` flag), `package.json` |
| Tooling & docs | `scripts/bench/`, `docs/rework/`, `/CLAUDE.md` |
