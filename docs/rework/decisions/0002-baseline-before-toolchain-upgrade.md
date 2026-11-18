# ADR-0002: Measure a baseline before upgrading the toolchain

- **Status:** Accepted (2026-11-17; Electron upgrade itself deferred)
- **Date:** 2026-11-17
- **Owner approval needed:** yes (changes the original phase order)

## Context
The original plan: (1) upgrade Electron/Vite/HMR/Playwright, (2) benchmark. But a
Chromium/Electron bump and a bundler change both shift memory and CPU on their own
(bundle size and shape, V8 version, Chromium process model). Benchmarking only after
the upgrade makes the starting point a *different app* than what users run today.

## Decision
Phase 0: build an **external** measurement harness (independent of the build
system) and record a baseline on the current Electron 43 + webpack production build.
Then do the toolchain upgrade (Phase 1) and re-measure with the same harness.

## Alternatives considered
- **Upgrade first, then baseline** (original plan) — loses the "what users have
  today" number and can hide regressions introduced by the upgrade.
- **Use the existing WDIO `test/performance` suite** — it runs inside the e2e
  framework and measures selected events; it won't measure OBS Studio or the full
  process tree consistently. Kept as a reference.

## Consequences
Phase 0 adds a few days before the toolchain work, but the harness is needed anyway
and is reused for every later measurement.
