# Target architecture (vision) — draft for discussion

> Guiding principle ([ADR-0004](decisions/0004-no-legacy-constraints.md)): the current
> architecture and dependencies are **not constraints**. This document describes where we
> want to end up; migration cost is a planning input, never a reason to keep a bad design.

Status: **parked draft, 2026-11-17.** Written too early — the agreed plan is measure → fix →
re-measure in phases, with the stack/architecture consolidation as the *final* phase. Use this
as input then (or earlier, piece by piece, if a specific fix needs one of these ideas). Numbers marked *(est.)* are estimates to be validated by
the architecture spike (roadmap Phase A).

## 1. Why separate windows (and why we keep them)

The current app uses real OS windows for dialogs instead of in-app modals. Inferred reasons,
all still valid for a streaming tool:

1. **Multi-monitor / side-by-side.** Streamers keep Settings, Source Properties, Filters next
   to the preview or on a second screen while live.
2. **The OBS preview is a native window** (owned by `obs64.exe`) layered over the main
   window. HTML can't be drawn over it; the in-window modal path needs "style blockers"
   that hide the preview while a modal is open. Separate windows don't fight the preview.
3. **Isolation.** A dialog that blocks or crashes doesn't freeze or take down the editor
   (today sync IPC blocks the calling renderer — in a modal it would freeze the main UI).
4. **Modeless work.** Several tools can be open at once (e.g. Settings + Advanced Audio).

What went wrong is not "separate windows", but that **every window boots the whole app**:
11 MB bundle, all ~95 service proxies, Vue + React + 8 antd themes, a full copy of the app
state — and that one such window is kept alive permanently just to hide the boot time.

## 2. Target process model

```
┌──────────────────────────── Electron main process (thin) ─────────────────────────────┐
│ app + window lifecycle · updater · protocol links · crash handling                     │
│ creates windows, creates MessagePorts and hands them out — NOT a message router        │
└──────────────┬───────────────────────────────┬───────────────────────────────────────┘
               │ spawns                        │ creates (on demand)
┌──────────────▼──────────────┐   MessagePort  ┌▼──────────────────────────────────────┐
│ Core  (Electron              │◄──────────────►│ Main window  (UI only, lean)          │
│ utilityProcess = Node only,  │◄──────┐        └───────────────────────────────────────┘
│ no Chromium renderer)        │       │ MessagePort  ┌───────────────────────────────┐
│ • all domain services        │       └─────────────►│ Dialog / tool windows         │
│ • single source of truth     │◄────────────────────►│ (one small page each, only     │
│ • OBS bridge (obs-studio-node)│                      │  while open)                  │
│ • persistence                │                      └───────────────────────────────┘
└──────────────┬───────────────┘
               │ OSN IPC
        ┌──────▼──────┐
        │ obs64.exe   │  (native; CEF for browser sources)
        └─────────────┘
```

- **No hidden worker renderer.** Services move into a Node-only `utilityProcess`: no DOM,
  no Blink, no GPU compositor client — a fraction of a renderer's memory *(est. 40–70 MB vs
  112 MB today)*. Services don't need a DOM; the browser coupling found (≈ 25 files use
  `window.`, 14 `localStorage`, 8 `document.`) is bounded and replaceable (fs/SQLite
  persistence, Node `fetch`, explicit event emitters).
- **No routing through the main process.** Each window gets a direct `MessagePort` to the
  core (Electron `MessageChannelMain`). Today every call does UI → main → worker → main → UI.
- **No permanent hidden windows.** Dialog/tool windows exist only while open.
- **Embedded web content** (platform apps, chat, dashboards) as `WebContentsView`s created when
  shown and destroyed when hidden; apps that truly need background execution get an explicit,
  opt-in mechanism.

## 3. Communication protocol

Replace JSON-RPC-over-`ipcRenderer` + sync calls + Vuex mutation broadcast with one typed
protocol over `MessagePort`:

| Concern | Today | Target |
| --- | --- | --- |
| Commands | `Service.actions.x()` / `.return` / **sync** `Service.x()` | async typed RPC only — **no sync calls** |
| State | full Vuex state copied to every window, every mutation broadcast to every window | **subscriptions to slices**: window asks for `sources`, `scene:abc/items`, `settings.video`…; core sends a snapshot, then patches for that slice only |
| Events | RxJS subjects proxied as "STREAM" subscriptions | same channel, explicit topic subscriptions |
| Cross-process state | Vuex replication **and** Realm (two mechanisms) | the subscription protocol; persistence is the core's private concern |
| Types | runtime proxy over service classes | a shared, generated/declared contract (schema per method/slice) |

Consequences: a window opening a dialog fetches a few KB of state instead of the whole app
state; idle windows receive nothing unless their slice changes; no window ever blocks on IPC.

## 4. State

- **Core**: single source of truth, plain TypeScript domain stores with immutable updates
  producing patches (immer-style). Persistence (scene collections, settings) owned by the core —
  JSON files / SQLite; no Realm.
- **UI**: one small reactive client store per window that applies snapshots/patches for the slices
  it subscribed to. UI-only state stays local to components.
- Vuex, Realm, `StatefulService`, mutation buffering, `BULK_LOAD_STATE` all go away.

## 5. Windows & bundles

- **One entry point per window type** (main, each dialog family, projector, pop-outs), built
  with Vite multi-entry; shared chunks for the framework runtime and the UI kit only.
- A dialog page contains: framework runtime + UI kit + its own code + the protocol client.
  Target **cold open ≤ 200 ms to painted** *(est.: renderer start ~60–100 ms + small bundle +
  slice fetch)*. If that's not met, optional: pre-spawn a window on hover/intent, never a
  permanently warm one.
- Chromium V8 code cache enabled for all bundles.
- Theming via **CSS custom properties**: one stylesheet, theme switch = swap variables — no
  8 compiled antd themes (5.2 MB of the current bundle).
- Security as a side effect: `contextIsolation: true`, `nodeIntegration: false`, sandboxed
  renderers with a minimal preload exposing only the port.

## 6. UI stack (open decision — decide by spike, not taste)

Requirements: smallest runtime + no idle work (fine-grained reactivity, no re-render churn),
fast cold start, good TS support, maintainable for years, a component kit that doesn't ship
megabytes of CSS.

| Candidate | Runtime | Notes |
| --- | --- | --- |
| **Vue 3 (+ Vapor mode when stable) + Pinia-like client store** | small | owner's initial preference; large ecosystem; fine-grained reactivity |
| **Svelte 5** | smallest (compiled) | runes = fine-grained; very small per-window bundles |
| **SolidJS** | very small | fine-grained, JSX (closest to today's React code) |
| React 19 | largest | ~340 existing components, but VDOM re-render model and runtime size work against the goals |

Spike: build the same dialog (e.g. Source Properties or Add Source) in 2–3 candidates on the new
protocol; measure bundle size, cold-open time, renderer memory, idle CPU. Component kit: headless
components + our own styles, or a light kit — not antd.

## 7. Expected outcome *(est., typical user)*

| Process | Today | Target *(est.)* |
| --- | --- | --- |
| Main process | 34 | 30–40 |
| Worker renderer → core utilityProcess | 112 | 40–70 |
| Main window renderer | 120 | 60–90 |
| Child window (permanent) | 94 | 0 when no dialog is open |
| GPU process | 160–190 | to investigate (H11) |
| Utilities / crash handlers | 18 | ~15 |
| **Electron total** | **558** | **~300–400** |
| Idle CPU | 0.3–0.8 % | ~0 (nothing hidden, nothing broadcast, nothing re-rendering) |

## 8. Migration path (strangler, inside this PoC)

1. **Phase A — architecture spike** (validate before committing): core in a `utilityProcess`
   hosting the existing services + OBS; MessagePort protocol with slice subscriptions for a few
   slices; one dialog as a lightweight page in 2–3 UI candidates. Measure. Decide UI stack (ADR).
2. **Phase B — core move**: all services into the core; headless where they touched the DOM;
   protocol covers all slices; old windows talk to the core through a compatibility adapter so
   the app keeps working.
3. **Phase C — windows**: port dialogs one family at a time to lightweight pages; then the main
   window; then pop-outs/projectors.
4. **Phase D — delete**: Vuex, Realm, Vue 2, old IPC, worker window, antd themes.

Each step is benchmarked with `scripts/bench/` like every other change.

## 9. Open questions

- UI framework + component kit (spike).
- Persistence format for the core (keep JSON scene collections vs SQLite).
- Platform apps that rely on always-running background pages — inventory needed.
- Can the GPU process be reduced (H11) — independent of this vision, still needed.
