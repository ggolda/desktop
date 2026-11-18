# ADR-0001: Rework documentation structure

- **Status:** Accepted
- **Date:** 2026-11-17
- **Owner approval needed:** no

## Context
The performance rework spans many sessions (human and AI). Typical failure modes of
long reworks: a new session doesn't know where the last one stopped; the *reason*
for a decision is lost and it gets re-litigated; benchmark numbers become
incomparable because methodology drifted; hypotheses get treated as facts.

## Decision
`docs/rework/` with documents split by rate of change:

- `README.md` — mission + **status board** + working protocol (single entry point)
- `goals.md`, `roadmap.md`, `benchmarking.md` — stable; changed only deliberately
- `decisions/` — ADRs, append-only, superseded rather than edited
- `benchmarks/` — immutable per-run result files + `SUMMARY.md`
- `hypotheses.md` — backlog with explicit evidence status
- `journal.md` — append-only session log

`CLAUDE.md` (auto-loaded into every AI session) gets a short pointer to
`docs/rework/README.md`. Its legacy content stays because it still describes the
current code accurately; an accepted rework ADR overrides it where they conflict.

## Alternatives considered
- **One big plan document** — mixes fast- and slow-changing content; status gets
  buried; history of decisions is lost on rewrite.
- **Moving CLAUDE.md into docs/** — would remove still-valid invariants (e.g. Vuex
  mutation purity) from automatic context while we still edit that code. Revisit
  once the legacy architecture is largely gone.
- **Issue tracker only** — not visible to AI sessions offline; fine to mirror into
  later.

## Consequences
Small overhead per session (journal + status update). In exchange, any session can
resume in minutes and every performance claim is traceable to a benchmark file.
