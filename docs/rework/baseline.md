# Baseline — 2026-11-17

Two fixtures, same machine, same build, sequence mode:

- **Typical** (primary from now on): fresh account, no platform apps —
  [`benchmarks/2026-11-17_SEQ_baseline-e43-webpack-typical_1.json`](benchmarks/2026-11-17_SEQ_baseline-e43-webpack-typical_1.json)
- **Power user**: owner's account with ~18 platform apps — details further below.

## Typical user (primary)

| Scenario | Electron WS | Electron private | Electron CPU (machine %) | Native OBS |
| --- | --- | --- | --- | --- |
| S2 visible, preview on | **558 MB** | 766 MB | **0.77 %** (≈ 18 % of one core) | 337 MB / 0.31 % |
| S1u visible, unfocused | 546 MB | 771 MB | 0.73 % | 335 MB / 0.26 % |
| S0 minimized | 537 MB | 769 MB | **0.28 %** | 336 MB / 0.48 % |
| S1 preview off | 558 MB | 786 MB | 0.79 % | 337 MB / 0.31 % |

Electron breakdown (S2, WS / private / CPU %):

| Process | WS MB | Private MB | CPU % |
| --- | --- | --- | --- |
| GPU process | 182 (167–189) | 215–241 | 0.31–0.33 visible, 0.15 minimized |
| Main window | 120 | 150 | 0.30–0.37 visible, 0.04 minimized |
| Worker (hidden) | 112 | 175 | 0.07–0.10 |
| Child window (hidden, warm) | 94 | 124 | 0.00 |
| Electron main process | 34 | 76 | 0.01 |
| Network + audio services | 15 | 24 | 0.00 |
| crash handlers | 3 | 5 | 0.00 |

Observations:
- **Gap to target: ~150 MB.** The child window alone is 94 MB.
- **GPU process ≈ main window ≈ 0.3 % CPU each** while visible; minimizing cuts
  both (main → 0.04 %, GPU → 0.15 %), so in this fixture idle CPU *is* largely
  rendering/compositing of the main window — i.e. the UI repaints or animates
  while nothing changes. Preview off (S1) doesn't help, so it's not the preview.
- No spare renderer (`tab`) and no audio-service CPU here — both only appeared with
  the platform apps loaded (H13/H14 are app-related).
- Native OBS ≈ 337 MB, of which obs64 ≈ 140–150 MB and CEF (browser source + alert
  widget: 4 renderers, GPU, 2 utilities) ≈ 195 MB.

## Power user (~18 platform apps)

Source: [`benchmarks/2026-11-17_SEQ_baseline-e43-webpack_1.json`](benchmarks/2026-11-17_SEQ_baseline-e43-webpack_1.json)
(sequence mode), cross-checked against the long single-mode S0 run
[`benchmarks/2026-11-17_S0_baseline-e43-webpack_1.json`](benchmarks/2026-11-17_S0_baseline-e43-webpack_1.json).
Commit `c466c8c` + harness, Electron 43.8.3, webpack production build.
Fixture: the owner's **power-user account** (logged in, ~18 platform apps installed,
several on beta channels). Atypical but a real case. A "typical" fixture (no apps) is
still to do.

Machine: Ryzen AI 9 HX 370 (24 threads), 31 GB, RTX 4060 Laptop + Radeon 890M,
2560×1600 @ 240 Hz, Windows 11 26200, AC power, Balanced plan.

### Headline

| Scenario | Electron working set | Electron private | Electron CPU (machine %) | Native OBS (obs64 + CEF) |
| --- | --- | --- | --- | --- |
| S2 visible, preview on | **1250 MB** | 1693 MB | **0.82 %** (≈ 20 % of one core) | 327 MB / 0.48 % |
| S1u visible, unfocused | 1232 MB | 1676 MB | 0.86 % | 328 MB / 0.44 % |
| S0 minimized | 1264 MB | 1708 MB | 0.63 % | 329 MB / 0.44 % |
| S1 preview off | 1254 MB | 1725 MB | 0.73 % | 328 MB / 0.47 % |

Target: ≤ 400 MB and ~0 % CPU for the Electron tree. We're at **~3×** the memory
target, and CPU barely changes between states: **minimizing or turning the preview off
saves almost nothing**, so the idle cost is mostly not rendering-driven.

### Where the Electron memory goes (S2, working set / private)

| Process(es) | Count | WS MB | Private MB | CPU % | Notes |
| --- | --- | --- | --- | --- | --- |
| Platform-app BrowserViews | 18 | **605** | 801 | 0.04 | ~33 MB each; mostly apps' `settings.html` / `index.html`, all loaded at startup, none visible |
| GPU process | 1 | 178 (218 in S0) | 240 | 0.31 | Largest single process; grows when minimized |
| Main window renderer | 1 | 126 | 158 | 0.29 | |
| Worker renderer (hidden) | 1 | 115 | 176 | 0.06 | Runs all services |
| Child window renderer (hidden, kept warm) | 1 | 94 | 123 | 0.01 | Never shown in this scenario |
| Electron main process | 1 | 66 | 108 | 0.04 | |
| Network service | 1 | 35 | 41 | 0.00 | |
| Spare renderer (`tab`) | 1 | 17 | 25 | 0.00 | Chromium pre-spawned renderer, no webContents |
| Audio service | 1 | 8 | 12 | 0.08–0.15 | Non-zero CPU at idle → something holds an audio stream |
| crash handlers | 2 | 3 | 5 | 0.00 | |

Without the platform apps, Electron would be ≈ 645 MB; the typical fixture measured
558 MB (no spare renderer, no app-related network/audio load).

### Where the idle CPU goes (S2, % of the whole machine)

GPU 0.31 · main window 0.29 · audio service 0.08 · worker 0.06 · apps 0.04 ·
main process 0.04. Minimized (S0): GPU 0.14 · worker 0.12 · audio 0.15 · main
window 0.07. Nothing is idle at 0: every process wakes up regularly. Needs CPU
profiles (Phase 2) to see which timers/rAF/IPC drive it.

### Native OBS side (not in the 400 MB target)

obs64 ≈ 137 MB WS / 455 MB private, plus **OBS's own embedded Chromium (CEF)** for
the browser source and alert widget: GPU process + network + storage service +
4 renderers ≈ 190 MB WS / 500 MB private. Compare with OBS Studio on the same
scene (floor run still to do).

### Startup / shutdown

Main window shown ~1.2 s after launch (that's the loading screen, not "ready").
Memory peaks ~1.45 GB about 30 s after launch, settles ~4 min later. Shutdown
clean in ~2 s in this run (but see issue I1 in hypotheses.md).

## Proposed first fixes (ranked by saving ÷ effort, typical user first)

| # | Fix | Typical-user saving | Power-user saving | Effort / risk | Owner decision? |
| --- | --- | --- | --- | --- | --- |
| 1 | **Create the child window on demand** (and drop `backgroundThrottling: false`) | **~94 MB** | ~94 MB | Low effort; dialogs (Source Properties etc.) open slower the first time | **Yes** — UX trade-off |
| 2 | **Stop idle repaints of the main window**: find what animates/re-renders while idle (CSS animations, timers driving React/Vue updates, Vuex mutation traffic) | most of ~0.6 % CPU (main + GPU) | same | Investigation (CPU profile + paint flashing), then targeted fixes | No |
| 3 | **Investigate the GPU process** (167–189 MB) — what's allocated per window, whether hidden windows hold GPU memory, 240 Hz effects | possibly 50–100 MB | same | Investigation first | No |
| 4 | **Load platform-app pages only when shown** | 0 | up to ~600 MB | Medium; apps that need background pages may break | Maybe |
| 5 | **Disable the spare renderer** | 0 (not present) | ~17 MB | Trivial | No |
| 6 | **Per-window bundles / lighter worker & main** | part of 232 MB (main + worker) | same | High — build restructure; fits the Vite phase | No |

Rough feasibility (typical user): fix 1 → ≈ 460 MB. Reaching ≤ 400 MB then needs
~60 MB more from GPU (fix 3) or the main/worker renderers (fix 6). **The 400 MB target
looks reachable for a typical user.** ~0 % idle CPU needs fix 2 plus the remaining
worker activity (0.07–0.10 %).
