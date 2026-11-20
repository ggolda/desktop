# ADR-0008: Chapter 2 constraints (owner, 2026-11-19)

- Status: accepted

## Decisions
1. **No new native modules.** Use only existing prebuilt binaries, so nothing needs to be rebuilt
   for Electron. Native modules that become unused may be dropped.
2. **Electron 45.x** for the reworked app.
3. **Ignore master.** The rework is short, and `reborn` is a clean rewrite.
4. **macOS:** keep it compiling. Signing and testing are out of scope.
5. **Look:** UI/UX parity with legacy: same layout, icons, fonts, colors and interactions, rebuilt with the new stack (ADR-0007). Pixel perfection is not required, but it must not look like a different app (tightened 2026-11-20, SPEC R10 / §6.1).
6. **Feature list** confirmed (SPEC §5.4). Feature enablement = code registry + user/server flags +
   local setting.
7. **No per-feature process isolation** initially. Everything runs in the core process.
8. **Working method:** Sonnet subagents write the code; the main session briefs and verifies.

## Consequences
SPEC.md §1, §5, §8.4 and §9. The M0 gate checks that all used native modules load under Electron 45.
