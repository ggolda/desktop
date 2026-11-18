# ADR-0003: Child (dialog) window on demand; in-app dialogs as fallback

- **Status:** Accepted as an **interim** step (2026-11-17). Next step: dialogs stay separate windows, but as lightweight pages (owner, 2026-11-17).
- **Date:** 2026-11-17
- **Owner approval needed:** yes — given 2026-11-17 ("try on demand + destroy; if not good enough, switch to in-app dialogs")

## Context
The child window hosts all ~30 dialogs (Settings, Add Source, Source Properties,
Filters, Go Live, …). It was created hidden at startup and only ever hidden, never
closed (`main.js`: "The child window is never closed, it just hides in the
background until it is needed"), so dialogs appear instantly. Cost in the typical
baseline: **~94 MB WS / ~124 MB private** for a window that is invisible most of the
session, plus it receives every Vuex mutation broadcast (H1).

## Decision
Create the child window when a dialog opens and close it when the dialog closes:

- `main.js`: no child window at startup; `window-ensureChildWindow` (sync IPC)
  creates it on demand (and replaces one that is still closing);
  `window-closeChildWindow` closes it; `getWindowIds.child` may be `null`.
- `WindowsService` (`app/services/windows.ts`): `showWindow` calls
  `ensureChildWindow()` first; all child-window access is null-safe. The new window
  renders the dialog from `state.child` once its store bulk-loads — dialog
  components are unchanged.
- `SLOBS_WARM_CHILD=1` restores the old behaviour, for A/B measurement only.
  Remove once the trial ends.

**Acceptance bar:** measured with `scripts/bench/dialog-latency.mjs` (ms from the
service call to the dialog painted). Results and verdict go below.

**Fallback if the delay is too noticeable:** in-app dialogs — render dialogs as
modals/side panels inside the main window (the app already has in-window modal
support: `modalOptions`, style blockers that hide the native OBS preview under HTML
overlays). Trade-offs discussed with the owner: dialogs confined to the main window
(no multi-monitor dialogs), preview hidden under centered modals (use side panels for
preview-affecting dialogs), small main windows (800×600 minimum).

## Alternatives considered
- **Keep warm** (status quo) — 94 MB for nothing most of the time.
- **Lazy create, keep afterwards** — saving disappears after the first dialog.
- **Create on demand, keep warm N minutes, then destroy** — middle ground if
  on-demand alone is too slow but in-app dialogs are unwanted.

## Consequences
- Saves ~94 MB (and the hidden window's mutation traffic) whenever no dialog is open.
- First paint of every dialog pays for a renderer start + 11 MB bundle load + state
  bulk load. Shrinking per-window bundles (baseline fix 6) directly reduces this.

## Trial results (2026-11-17)

**Memory** — [`benchmarks/2026-11-17_SEQ_child-on-demand_1.json`](../benchmarks/2026-11-17_SEQ_child-on-demand_1.json)
vs typical baseline: Electron **558 → 446 MB WS** (−91…−112 MB per scenario),
**766 → 627 MB private** (≈ −140 MB). CPU unchanged within noise.

**Dialog latency** (`scripts/bench/dialog-latency.mjs`, typical fixture, 5 opens each,
median ms from the service call):

| Mode | Window visible | Dialog mounted | Painted — Settings | Painted — Add Source |
| --- | --- | --- | --- | --- |
| Warm (old) | 13 | 77 | 100 (first open 696) | 115 |
| On demand | 35 (dark window + spinner) | 630 | **1250** | **715** |

≈ 600 ms is window boot (renderer start, 11 MB bundle, state bulk-load); Settings adds
≈ 600 ms of first render, which a warm window pays only once.

**Bug found and fixed on the way:** the crash handler treats any registered renderer
that disappears as a crash and **terminates the whole app** (`crash-handler.log`:
"Non critical crash detected … Terminate non critical processes"). The on-demand
child is therefore not registered, like one-off windows (`app/app.ts`). Note: this
also means that today a crash of the (permanent) child renderer kills the whole app.

**Verdict (2026-11-17):** owner first chose in-app dialogs, then — after ADR-0004 —
asked for the proper solution that keeps separate windows: lightweight per-window pages
that load only what they need. The on-demand child stays in
the code as an interim step (−100 MB); in-app dialogs are **not** pursued.

## Agreed direction for dialogs (owner, 2026-11-17)

Dialogs stay **separate windows**, each with **very thin, isolated content that renders
very fast**: own small bundle (only that dialog's UI + one theme), loads only the data it
needs and subscribes to changes of that data only, thin async service client, ideally a
direct channel to wherever services run. Rough target: painted in ~200–250 ms *(est.)*.
**Implementation is deferred** until the underlying architecture (where services run,
the protocol) is thought through; the on-demand child window stays as the interim.
