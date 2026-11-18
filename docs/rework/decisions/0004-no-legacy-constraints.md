# ADR-0004: The current architecture and dependencies are not constraints

- **Status:** Accepted
- **Date:** 2026-11-17
- **Owner approval needed:** — (owner's directive)

## Context
While discussing lightweight per-window pages, options were judged by how hard they are
to fit into today's code (eager service registry, `WindowsService` importing every dialog,
full-state Vuex replication). The owner rejected that framing.

## Decision
Owner, verbatim intent: *"I absolutely don't care about current architecture or
dependencies. We are doing a rework and our goal is to make a proper vision for years to
come. If the proper way is isolated windows that load the smallest possible version of only
what they need, this needs to be done. If we need to change the communication protocol,
architecture, data loading or whatever is necessary, it can be done."*

Therefore:
- Options are evaluated by the **target end state** (memory, idle CPU, startup,
  maintainability, security), not by compatibility with the current design.
- Migration effort is reported as a planning fact (sequencing, risk), never as a reason to
  keep a design that blocks the goals.
- `/CLAUDE.md` and `/ARCHITECTURE.md` describe the legacy system; they are reference material
  for understanding and migrating it, not rules for the target.

## Consequences
- The target architecture is defined in [architecture-vision.md](../architecture-vision.md).
- Interim fixes on the legacy code (e.g. ADR-0003) are fine when they measure progress or
  de-risk, but must not shape the target.
