# Roadmap

Each phase has **exit criteria**. Don't start the next phase until they are met (or
an ADR explains why we moved on).

> **Change vs. the original plan:** the original plan upgraded the toolchain first
> and benchmarked second. We measure a baseline on the **current** toolchain first
> (Phase 0), because Electron/Chromium and bundler changes alter memory by
> themselves — without a pre-upgrade baseline we can't separate "toolchain effect"
> from "our fixes", or catch the upgrade regressing things.
> See [ADR-0002](decisions/0002-baseline-before-toolchain-upgrade.md).

## Phase 0 — Measurement harness + baseline (current)

Build a harness that runs **outside the app** (so the same harness measures the
current webpack/Electron 43 build, the post-upgrade build, and OBS Studio).

- [x] Harness per [benchmarking.md](benchmarking.md) (`scripts/bench/`), smoke-tested
      on all four scenarios
- [x] Logged-in user-data fixture (owner's power-user account)
- [x] Second fixture `typical` (fresh account, no apps) — **primary fixture from now on**
- [x] Production build of current code
- [x] Baseline → [baseline.md](baseline.md) (sequence mode; one long single-mode S0 run for calibration)
- [ ] OBS Studio floor run for S2
- **Exit:** baseline numbers per process per scenario, reproducible within ~±5 %.

## Note on ADR-0004 (2026-11-17)

Fixes in every phase are designed without legacy constraints (ADR-0004), but the phase
order stays as agreed. [architecture-vision.md](architecture-vision.md) is a parked draft
for Phase 5 (stack consolidation).

## Phase 1 — Toolchain modernisation

Goal: a faster dev loop and better instruments — **not** performance by itself.

- ~~Electron 43.8.3 → 45.x~~ — **deferred** (owner, 2026-11-17): a 2-major jump
  won't change the picture; revisit later
- **Yarn Berry → npm**, done together with the Vite move (both replace the
  dependency/build setup). Watch: `yarn.lock` → `package-lock.json` resolution
  drift, the OSN tarball dependency, `postinstall` script, yarn plugin-licenses
  used by `generate-licenses`
- **webpack 5 → Vite** (likely via `electron-vite`). Known risks found so far:
  - `@vitejs/plugin-vue2` requires **Vue ≥ 2.7**; we're on 2.6.9 → bump Vue to 2.7
    first (mostly compatible; `vue-property-decorator` 7 / class components in ~80
    files need checking)
  - Renderers use `nodeIntegration: true` + `require` of Node/native modules —
    these must be externalised in the renderer build
  - `emitDecoratorMetadata` is off ✅ (esbuild-compatible); legacy
    `experimentalDecorators` are fine with esbuild
  - Many custom less/style loader rules (local/global style injection) to port
- **HMR** for UI windows only. The worker hosts services + OBS: a change there
  means restarting the app (acceptable; document it)
- **Playwright (`_electron`)** for new exploration/perf scripts. Existing WDIO e2e
  suite stays as-is for now; porting it is out of scope
- **Exit:** app runs with full feature smoke-test parity; re-run benchmarks and
  record the toolchain delta vs. Phase 0.

## Phase 2 — Profile and attribute

- Per-process breakdown; heap snapshots of each renderer; CPU profiles at idle
- Count idle activity: IPC messages/sec, Vuex mutations/sec, timers firing, rAF,
  webview processes, obs64 work
- Turn [hypotheses.md](hypotheses.md) entries into *measured* findings with an
  estimated saving each, ranked by saving ÷ effort
- **Exit:** a ranked list that explains where ≥ 90 % of the memory and idle CPU go,
  and an honest feasibility estimate for 400 MB / 0 %.

## Phase 3 — Fix loop

For each ranked item: fix → benchmark before/after → update hypotheses.md. ADR for
anything architectural or any feature cut (owner approval first).

## Phase 4 — Feasibility checkpoint

If incremental fixes plateau above target, consider structural changes (each its
own ADR, discussed with the owner), e.g.:

- fewer always-on renderers (merge worker into main window or main process; drop
  the warm child window)
- per-window bundles instead of one bundle loaded in every window
- lazy-create webviews; tear them down when hidden
- cut or make opt-in heavy features

## Phase 5 — Stack consolidation (later)

Remove the Vue 2 + Vuex + React + Realm mix in favour of one UI framework and one
state model. **Not decided yet** — note for the eventual ADR: the codebase already
has ~340 React `.tsx` components vs ~46 Vue files, so "finish React, drop Vue 2 and
Vuex" is likely far cheaper than moving everything to Vue 3 + Pinia. Phase 2 data
(how much each runtime/state system costs) should drive the choice.

## Cross-cutting risks

- **OBS native floor:** obs64 + GPU may consume a large part of 400 MB on their own.
  Phase 0's OBS Studio floor run tells us early.
- ~~Branch drift~~ — none: `reborn` is an isolated PoC, no merges from master.
- **Test coverage:** e2e suite is slow; fixes need a cheap smoke check
  (Playwright) to avoid silent feature breakage.
