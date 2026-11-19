# Performance Rework — START HERE

> Every session working on the rework **reads this file first and updates the
> Status board last.** This is the handoff point between sessions.

## Mission

Cut Streamlabs Desktop's idle resource usage to **≤ 250 MB RAM** (ADR-0005; first milestone 400 MB reached) **and ~0 % idle CPU**
(precise definitions in [goals.md](goals.md)), then go lower if possible. Functionality
may be cut if it is unfixable — **only after discussing it with the project owner**
(record the outcome as an ADR).

## Guiding principle — read this first

**The current architecture and dependencies are NOT constraints.** We are building the
proper architecture for years to come. If the right design needs isolated windows that load
only what they need, a new communication protocol, a new process model, new data loading or
a new UI stack — we do it. Judge options by the target end state; migration cost is a
planning fact, never a reason to keep a bad design.
([ADR-0004](decisions/0004-no-legacy-constraints.md)). This applies to every fix in the
phase plan — it does **not** mean jumping ahead to the final architecture phase.

**Performance is the top priority** of the codebase (owner, 2026-11-18). Coding rules distilled
from the measurements: [performance-guidelines.md](performance-guidelines.md) (short version in
`/CLAUDE.md`).

## Status board

| Field | Value |
| --- | --- |
| Current phase | **Chapter 2 — target architecture** (Phase 5 brought forward by the owner): discovery done ([chapter2/](chapter2/)); next: framework/stack experiments, then specification |
| Last session | 2026-11-18 — chat lifecycle, polling → ResizeObserver, chat scenario (S5); chapter 1 report written |
| Next step | SPEC v0.1 ([chapter2/SPEC.md](chapter2/SPEC.md)) → owner review → M0 skeleton + delivery proof (Sonnet subagents) |
| Blockers | none |
| Latest baseline | [baseline.md](baseline.md) — **typical user: Electron ≈ 558 MB, idle CPU 0.77 % (0.28 % minimized)**; power user (18 apps): ≈ 1250 MB; native OBS ≈ 335 MB |
| Best result so far | typical, preview off: Electron **~386–403 MB** WS; idle CPU **0.08 %** unfocused, **0.27 %** focused with meters moving ([meters2d](benchmarks/2026-11-18_SEQ_meters2d_1.json)); power user ~430 MB (before ascii_only) |

## Document map

| Doc | What it holds | Changes |
| --- | --- | --- |
| [README.md](README.md) | Mission, status board, working protocol | Every session |
| [chapter2/](chapter2/) | Chapter 2 (architecture): discovery reports (distribution, OBS, modules), experiments, SPEC | Chapter 2 |
| [POC-REPORT.md](POC-REPORT.md) | **Shareable report of chapter 1** (minimal-change optimizations: findings, fixes, results, trade-offs, what's left) | At chapter end |
| [goals.md](goals.md) | Exact target definitions, scenarios, open questions | Rarely (via ADR) |
| [architecture-vision.md](architecture-vision.md) | **Parked draft** — ideas for the final stack/architecture phase; not the current plan | Final phase |
| [roadmap.md](roadmap.md) | Phases, exit criteria, risks | When a phase completes or the plan changes |
| [benchmarking.md](benchmarking.md) | How to measure — so numbers stay comparable | Rarely; methodology changes invalidate comparisons |
| [benchmarks/](benchmarks/) | One immutable result file per run | Append only |
| [baseline.md](baseline.md) | Baseline analysis: where memory/CPU go, first-fix proposals | Per baseline |
| [performance-guidelines.md](performance-guidelines.md) | Coding rules learned from measurements (no infinite animations, no polling, …) | When a new rule is learned |
| [hypotheses.md](hypotheses.md) | Suspected bottlenecks + evidence status + measured savings | Often |
| [decisions/](decisions/) | ADRs — *why* we chose X. Never rewrite; supersede | Append only |
| [journal.md](journal.md) | Short per-session log: did / learned / stopped at | Every session (append) |

Legacy architecture reference: [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) and
[`/CLAUDE.md`](../../CLAUDE.md). They describe how the **current** code works (useful to
understand and migrate it) — they are **not** rules for the target architecture.

## Working protocol (for every session)

1. Read this file, then the latest entries of [journal.md](journal.md), then whatever
   the "Next step" points to.
2. Work on one phase step at a time. Keep changes on the rework branch in small,
   reviewable commits.
3. **No performance claim without a benchmark file.** Any change claimed to save
   CPU/RAM must have a before/after run recorded in `benchmarks/` using the
   methodology in [benchmarking.md](benchmarking.md).
4. Architectural choices (removing a window, replacing a library, cutting a feature,
   changing the methodology) get an ADR in `decisions/`.
5. Feature cuts: propose in an ADR with status `Proposed`, ask the owner, only
   implement once `Accepted`.
6. Before ending: append to journal.md, update the Status board, update
   hypotheses.md statuses.
