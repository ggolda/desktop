# Goals and definitions

"400 MB and 0 % CPU" is only actionable once we say *which processes*, *in what
state*, *measured how*. This file pins that down. Changing anything here requires an
ADR, because it changes what every benchmark means.

## 1. Targets

| Metric | Target (v1) | Stretch |
| --- | --- | --- |
| Memory, **Electron process tree** (excl. `obs64.exe`), idle scenarios | **≤ 250 MB** ([ADR-0005](decisions/0005-target-250mb.md); first milestone 400 MB — reached) | lower |
| CPU, **Electron process tree**, idle scenarios S0/S1/S1u | ~0 % (≤ 0.5 % avg, no periodic spikes from JS) | — |
| Native OBS side (`obs64.exe` + its CEF subprocesses for browser sources) | reported separately; compared to the OBS Studio floor | — |
| No regressions | streaming/recording output quality and stability unchanged | — |

## 2. What counts as "the app" (decided 2026-11-17)

The full process tree spawned by Streamlabs Desktop:

- Electron **main process** (`main.js`)
- all **renderers**: worker (hidden), main window, child window (hidden, kept warm),
  one-offs, webviews / BrowserViews (chat, dashboards, platform apps…)
- Chromium **GPU** and **utility** (network, audio…) processes
- **`obs64.exe`** — OBS runs out-of-process via `obs-studio-node` (`obs.IPC.host` in
  `app/app.ts`); its memory/CPU are real costs to the user
- crashpad / crash handler, updater helpers if running

**The target applies to the Electron tree** (main, renderers, GPU, utility,
crashpad). `obs64.exe` is measured and reported separately on every run — it's
native OBS cost, judged against the plain OBS Studio floor rather than the 400 MB
budget. Every process is reported individually, plus Electron total and grand
total.

**Memory metric:** private working set (what Windows Task Manager shows in the
"Memory" column) — that's what users compare against. Also record private bytes
(commit) and, where available, V8 heap per renderer.

**CPU metric:** % of total machine capacity (Task Manager convention), averaged over
the sample window, plus p95 and max. Summed across the tree.

## 3. Scenarios (decided 2026-11-17)

0 % CPU is physically impossible while OBS composites and draws a live preview, so
"idle" must be defined per scenario:

All scenarios run **logged in** (primary user case) with the same scene fixture.

| ID | Scenario | Expected floor |
| --- | --- | --- |
| **S0** | Main window **minimized** | Electron ~0 %; obs64 composites at configured FPS |
| **S1** | Main window visible and focused, **preview disabled** | Electron ~0 % |
| **S1u** | Main window visible but **not focused** (another small window focused, not covering it), preview on | Electron ~0 % |
| **S2** | Main window visible and focused, preview on, typical scene (display capture + 1 browser source + 1 alert widget + mic) | Compare obs64 against **plain OBS Studio** with the same scene = native floor |
| **S3** | Same as S2 while **recording** (to the run folder; benchmarks never write to the user's Videos folder) | Electron ~idle level; added 2026-11-18 after the owner's report |

**Reference floor:** OBS Studio (same OBS version as bundled in OSN, same scene,
same settings) measured with the same harness. The gap between Streamlabs and OBS
Studio is the overhead we own and can attack. If the bundled OBS alone exceeds part
of the budget, that is a finding, not a measurement error.

## 4. Benchmark environment

- **Production build** (`yarn compile:production` or a packaged build) — dev builds
  carry devtools, source maps, unminified bundles and distort memory badly.
- Reference machine: **the owner's laptop only**. Laptops vary with power and
  thermals: always on AC, same Windows power mode, cool start, lid open, same
  external display setup. Record all of it in each result file.
- Fresh user-data directory per run (`SLOBS_CACHE_DIR`) seeded from a fixture so
  scene collections/settings are identical.

## 5. Resolved questions (2026-11-17)

| # | Question | Answer |
| --- | --- | --- |
| Q1 | Does the budget include `obs64.exe`? | Owner thought Electron-only; decided: target = Electron tree, obs64 reported separately |
| Q2 | Which states are "idle"? | S0 minimized, S1 preview off, S1u unfocused, S2 typical |
| Q3 | Logged in or out? | Logged in |
| Q4 | Reference hardware? | Owner's laptop only |
| Q5 | Branch strategy? | `reborn` is the main branch of an isolated PoC in a personal fork. No merges from master. Invasive changes are fine |
