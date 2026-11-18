# ADR-0006: Keep hardware acceleration on

- **Status:** Accepted
- **Date:** 2026-11-18
- **Owner approval needed:** — (owner's decision)

## Context
Experiment `exp-gpu-noha` (2026-11-18): disabling hardware acceleration shrinks the GPU process
from ~140 MB to ~46 MB WS (~−95 MB), at the cost of software compositing (+~0.35 % idle CPU at
the time, mostly WebGL meter redraws).

## Decision
Hardware acceleration stays **on** (owner: "not good for Electron projects" — software
compositing makes every animation, embedded web content and video more CPU-expensive and is
an unusual, less-tested Electron configuration). The existing user opt-out (`HADisable`)
stays as it is.

## Consequences
The GPU process (~145 MB WS, mostly ANGLE/D3D11 driver path + window surfaces) is treated as a
largely fixed cost; only reductions that keep acceleration on are in scope (Chromium GPU
flags, fewer composited surfaces). This makes the 250 MB target (ADR-0005) much harder —
see journal 2026-11-18.
