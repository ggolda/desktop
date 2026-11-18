# Benchmarking methodology

Numbers are only comparable if they're produced the same way. If you change
anything in this file, write an ADR and re-run the baseline — old results are no
longer comparable.

## Principles

1. **External harness.** The harness is a standalone Node script, independent of the
   app's build system, so it measures old builds, new builds and OBS Studio
   identically. Optional in-app hooks (e.g. labelling via `app.getAppMetrics()`) are
   enabled by an env var and must not change behaviour.
2. **Production builds only.**
3. **Whole process tree**, per process and total (see [goals.md §2](goals.md#2-what-counts-as-the-app-decided-2026-11-17)).
4. **Repeat:** ≥ 3 runs per scenario; report the median, keep all raw samples.
5. **Controlled machine:** AC power, fixed power plan, no other heavy apps, same
   display resolution/refresh rate; note background noise in the result.

## Modes

| Mode | What | Time | Use |
| --- | --- | --- | --- |
| **sequence** (default) | One launch; settle 90 s; then S2 → S1u → S0 → S1 in the same session, each 15 s transition + 60 s sample | ~7 min | Every fix iteration |
| **single** | One launch per scenario; settle 120 s, sample 300 s; 3 runs | ~90 min | Milestone baselines only |

Why sequence: memory peaks ~30 s after launch and decays for ~4 min (measured in
`2026-11-17_S0_baseline-e43-webpack_1`), so short per-scenario launches overstate
memory by 10–20 %. Settling once and walking through the scenarios keeps the total
short. Trade-off: scenarios share one session (realistic — users switch states).
CPU varies minute to minute (0.5–1.4 % in the long run), so for small CPU deltas
repeat with `--runs 3`.

**Windows caveats:** minimizing lets Windows trim working sets, so S0 working-set
numbers can drop without real savings — always check `privateMB` (commit) too.
"Focused" means the foreground window belongs to any process in the app tree: the
OBS preview is a window owned by `obs64.exe` and usually holds the foreground.

## Tooling (`scripts/bench/`)

| File | Role |
| --- | --- |
| `run.mjs` | Runner: fixture copy → launch → settle → sample → clean quit → result files |
| `sampler.ps1` | External sampler: one long-running PowerShell loop over `Win32_PerfRawData_PerfProc_Process` (private working set, private bytes, CPU ticks) + command lines of new PIDs |
| `bench-hook.js` | In-app hook, `require`d by `main.js` **only** when `SLOBS_BENCH_OUT` is set: labels PIDs (worker/main/child/webview…), records `app.getAppMetrics()` and window state every 5 s, applies the scenario, performs a clean quit on request |
| `make-fixture.mjs` | Launches the app against `.bench/fixtures/<name>` so you can log in and build the scene |

```powershell
# one-time: build + logged-in fixture (log in, build the S2 scene, quit the app)
yarn compile:production
node scripts/bench/make-fixture.mjs

# standard run (~7 min; don't touch the laptop meanwhile)
node scripts/bench/run.mjs --label <what-changed>

# milestone baseline (~90 min)
node scripts/bench/run.mjs --mode single --scenario all --label <label>

# other fixture / quick smoke test (not recorded)
node scripts/bench/run.mjs --label <label> --fixture .bench/fixtures/typical
node scripts/bench/run.mjs --label smoke --settle 15 --transition 5 --sample 10 --no-record
```

**Experiment options** (`run.mjs`): `--env KEY=VALUE` (repeatable) passes switches to the
hook — `SLOBS_BENCH_DISABLE_HA=1` (hardware acceleration off), `SLOBS_BENCH_SWITCHES="a;b=c"`
(Chromium switches; not `disable-features`); `--pre "<hook command>"` runs a hook command once
the window is shown (e.g. `perfmode on` hides the mixer meters); `--memtrace` takes a
memory-infra trace at the end and stores `memoryBreakdown` (per-process allocators) plus the
GPU process's loaded DLLs (`gpuModules`). Every result stores `gpuInfo` (active GPU, ANGLE
backend). Other tools: `trace-idle.mjs` (what wakes processes up), `dialog-latency.mjs`.

**Launch flags:** the app runs unpackaged from the repo with `NODE_ENV=production`,
`--skip-update` (no app updater) and `--local-bundles` (otherwise the bundle updater
downloads release JS bundles from the CDN *over our build*). `SLOBS_CACHE_DIR` points
at a per-run copy of the fixture.

**Scenario application** (by `bench-hook.js`, after the main window is shown):
S0 `minimize()`; S1 `CustomizationService.setLivePreviewEnabled(false)` executed in
the worker; S1u a tiny `BaseWindow` (no renderer) in the bottom-right corner takes
focus; S2 focus main window. Switching restores the previous state (un-minimize,
preview back on). The runner verifies window state
during sampling (`scenarioCheck`).

**Local artefacts** (gitignored `.bench/`): `fixtures/` (contain auth tokens — never
commit), `runs/<name>/` with app logs, raw hook output and a pretty `result.json`.

## Procedure (per run)

1. Restore the scenario's user-data fixture into a fresh directory.
2. Start the sampler, then launch the app (or OBS Studio for floor runs); the
   timeline captures startup too.
3. Wait for the main window to be shown; the hook applies the scenario.
4. **Settle 120 s** after the scenario is applied (startup work, GC, lazy loads).
5. **Sample 300 s at 1 Hz**: for every process in the tree, private working set,
   private bytes, CPU time delta → CPU %.
6. Request a clean quit; record time to the Electron `quit` event, time to process
   exit (40 s limit, then force-kill) and leftover processes.

Process discovery on Windows: walk the tree from the launched PID (parent PID via
WMI/CIM `Win32_Process`), plus `obs64.exe` (child of the worker renderer). Identify
Chromium process type from the `--type=` command-line flag; identify which window a
renderer serves via the in-app hook (`webContents.getOSProcessId()` ↔ window name).

## Result file

One JSON file per launch in `benchmarks/`, never edited after writing:

`benchmarks/YYYY-MM-DD_<SEQ|scenario>_<label>_<n>.json`, e.g.
`2026-11-17_SEQ_baseline-e43-webpack_1.json`. Schema 2 (below) has one entry per
scenario in `segments`; schema 1 (the first long S0 run) had a flat `summary`.

```jsonc
{
  "schema": 1, "name": "...", "label": "...", "scenario": "S2",
  "build": "production (...)", "git": { "commit": "...", "dirty": false },
  "app": { "version": "1.22.4", "electron": "43.8.3" },
  "machine": { "cpu", "logicalCores", "ramGb", "gpu", "display", "os", "onAcPower", "powerPlan" },
  "settleSec": 120, "sampleSec": 300, "intervalMs": 1000,
  "phases": { "launch", "mainWindowShown", "scenarioApplied", "sampleStart", "sampleEnd" },  // epoch ms
  "startup": { "mainWindowShownMs" },
  "segments": [ {
    "scenario": "S2", "phases": { "scenarioApplied", "sampleStart", "sampleEnd" },
    "electron": { "memMB": { "median", "p95", "max" }, "privateMB": { "median" }, "cpuPct": { "avg", "p95", "max" } },  // THE target
    "native": { ... },   // obs64 + CEF subprocesses
    "all": { ... },
    "byProcess": [ { "label": "renderer:window:main", "pid", "memMB", "privateMB", "cpuPctAvg", "cpuPctP95" } ],
    "scenarioCheck": true, "scenarioCheckFraction": 1, "foregroundOwners": [ "obs64" ]
  } ],
  "processes": [ { "pid", "label", "cmd" } ],   // cmd = exe + flag names only
  "webContentsAtEnd": [ { "pid", "type", "role", "url" } ],   // URLs without query strings
  "shutdown": { "clean", "durationMs", "quitEventMs", "leftoverProcesses" },
  "error": null, "notes": "",
  "timeline": { "t0", "t": [ms], "procs": { "<label>": { "memMB": [], "cpuPct": [] } } }  // whole run incl. startup
}
```

CPU % is the share of the **whole machine** (all logical cores), like Task Manager.
On this 24-thread laptop, 1 % ≈ 24 % of one core.

Plus a human-readable line appended to `benchmarks/SUMMARY.md` (one table row per
run: date, label, scenario, total MB, total CPU %, biggest processes).

## Comparing runs

A change "helps" only if the median improves beyond run-to-run noise (measure the
noise band in Phase 0; expected ~±5 %). Always quote both before and after file
names when claiming a win.
