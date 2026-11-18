# Performance guidelines

**Performance is the top priority of this codebase** (owner, 2026-11-18). Streamlabs Desktop
runs next to games and an encoder; every idle wake-up and every megabyte is taken from the
user's stream. These rules come from measurements in this rework — each links its evidence.
`/CLAUDE.md` carries the short version; this file explains why.

## 1. No continuous animation in always-visible UI

Any visible change makes Chromium produce a full frame: style → paint → layerize → commit →
raster → **composite and present the whole window** in the GPU process. A continuously running
animation does this on **every display refresh**.

Measured on the reference laptop (240 Hz, 2566×1521 px window): one infinite CSS `box-shadow`
pulse costs **~2.1 % CPU on an empty Electron page** and ~2.4 % on a content page (idle ≈ 0 %);
in Streamlabs it was 2.5 % for the REC button while recording (hypotheses H22, guideline note).
It is not a framework problem — no JavaScript runs.

- **Don't:** `animation: … infinite` on anything that stays on screen (status dots, glows, REC/LIVE
  indicators, skeleton shimmer), FontAwesome `fa-spin` / `fa-pulse` on persistent elements,
  animated GIF/WebP/Lottie that loop on main screens.
- **If an animation is essential:** drive it from JS at ≤ 10 updates/s (see `useRecordingPulse` in
  `StudioFooter.tsx`), stop it when the window is hidden/unfocused, and prefer finite animations.
- Short, finite transitions on user interaction (open/close, hover) are fine. If you animate,
  animate `transform`/`opacity` only (compositor-only, no repaint) — they still cost frames.

## 2. No per-frame loops, no polling

- **Never** run a permanent `requestAnimationFrame` loop "to check if it's time" — each rAF forces
  a frame at display rate (240/s here). Found twice: volume meters and OverlayScrollbars
  `autoUpdate: true` (H16: main window 239 → 30 frames/s after the fix).
- Don't poll with `setInterval` for state that can be observed: use `ResizeObserver`,
  `MutationObserver`, service subscriptions / events.
- Schedule work only when something changed, and only if the change is visible (the meters skip
  updates below 2 px).

## 3. Live data at the rate the user can see

- Volume meters: 10 fps, redraw only on visible change, paused while the main window is not
  focused; the worker forwards ≤ 20 updates/s per source (H17). Apply the same thinking to any
  live indicator (stats, timers): ≤ 1–10 updates/s, nothing when nobody can see it.
- Prefer a cheap rendering path (2D canvas or DOM) over WebGL for small widgets — a WebGL context
  costs ~35 MB in the GPU process (H17).

## 4. Nothing hidden "for speed"

- Don't keep hidden windows, BrowserViews or pages alive to make something open faster. The warm
  child window cost ~94–112 MB (ADR-0003); platform-app pages created at startup cost ~600 MB for a
  power user (H6). Create on demand; make the on-demand path fast instead.

## 5. Every window loads only what it needs

- Bundle size is memory in every process: each renderer keeps the whole script source (~31 MB for
  the 16 MB bundle before `ascii_only`) plus V8 heap. The worker-only bundle cut the worker from
  ~93 to ~59 MB (H18). Don't import UI modules from services (they end up in the worker).
- Keep build output ASCII-only (Terser `ascii_only`): a single non-ASCII character makes Chromium
  store the whole script as two-byte text (H21).

## 6. Measure, don't guess

- Before/after every performance-relevant change: `node scripts/bench/run.mjs --label <change>
  --fixture .bench/fixtures/typical` (~7 min, machine untouched) — see [benchmarking.md](benchmarking.md).
- To find what wakes a process: `scripts/bench/trace-idle.mjs`. To compare with a bare Electron app:
  `scripts/bench/minimal-floor.mjs` (keep the window visible — covered windows produce no frames).
- Test the states users actually spend time in: idle, unfocused/behind a game, **recording,
  streaming**, logged in and out — the recording bug (H22) was invisible to idle-only benchmarks.
