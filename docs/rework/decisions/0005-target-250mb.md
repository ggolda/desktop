# ADR-0005: Lower the memory target to 250 MB

- **Status:** Accepted
- **Date:** 2026-11-18
- **Owner approval needed:** — (owner's decision)

## Context
After the first fixes the typical-user Electron tree is at ~415–435 MB WS (baseline 558 MB),
close to the original 400 MB target. The owner wants to see how far it can go.

## Decision
New memory target: **≤ 250 MB working set for the Electron process tree** (same definition as
goals.md §2: obs64 and its CEF subprocesses are reported separately). CPU target unchanged
(~0 % idle). 400 MB stays recorded as the first milestone (reached in all scenarios except
peaks).

## Consequences
Incremental fixes alone are not expected to reach 250 MB; structural changes (worker
without UI code or out of Chromium, lean per-window bundles, GPU process trade-offs) are
in scope as fixes, discussed one by one within the phase plan. See baseline.md / journal for
the feasibility estimate.
