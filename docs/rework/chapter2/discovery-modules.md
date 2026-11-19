# Discovery: features, startup cost, coupling, external interfaces (chapter 2)

*Source: read-only analysis 2026-11-18 of app/services (747 `@Inject`s → 534 feature edges),
app/components-react, app/components, main.js, guest-api/.*

## How services start today
`@Inject()` is lazy, but **`@InitAfter('X')` force-initializes** a service when X initializes; X =
UserService/StreamingService/SourcesService/… all start in `AppService.load()` → **31 `@InitAfter`
observers run at every start** (vision, automations, kevin, reactive-data, recent-events, streamlabels,
platform-apps, nav-menu, highlighter, chat, diagnostics, guest-cam, widgets, game-overlay, restream,
announcements, outage, remote control, …) whether or not the feature is used.

## Feature inventory (condensed)
| Feature | Size svc/UI KB | Startup | Class |
| --- | --- | --- | --- |
| Platform apps + App Store | 108 / ~16 | eager; on login reloads apps, store visibility, **re-downloads all app assets to compare checksums**, background pages | optional (fan-out 26) |
| "Vision" + AI suite (vision process, automations, stream-avatar, Kevin/Sidekick agent, reactive data) | ~200 / ~160 | eager; **Kevin opens a socket.io connection for every logged-in user**; vision process starts if enabled; automations fetch + retry timers; reactive-data OBS callback + fetch | optional |
| Highlighter | 134 / ~195 | eager; sync `fileExists` per persisted clip at startup | optional (entangled with streaming) |
| Game overlay | 16 / ~4 | eager, cheap | optional |
| Widgets & alert box, streamlabels, recent events | ~210 / ~300 | eager; streamlabels **permanent 1 s interval**; recent events 5 fetches at login | optional ("Streamlabs widgets") |
| Streamlabs websocket | 6 | socket.io after collection load | infrastructure |
| Chat, restream/multistream | 79 / ~260 | eager subscribe; restream fetch at login; restream hard-wired into go-live (~20 calls in streaming.ts) | platform integration |
| Dual output / vertical | 41 / ~17 | `ScenesService @InitAfter('DualOutputService')`; used by 18 features incl. every editor command | **de-facto core** (multi-canvas) |
| Guest cam / collab cam | 52 / ~26 | eager subscriptions; owns scene-collection key `guestCam` | optional |
| Media gallery/backup | 15 / 15 | lazy | optional |
| Engagement (onboarding, announcements, patch notes, outage **5-min poll**, prime/marketing, grow) | ~60 / ~110 | eager fetches at login | optional |
| Auto-optimizer, troubleshooter, diagnostics (**60 s flush**) | ~200 / ~40 | mostly lazy | optional / support |
| Usage statistics | 10 | **10-min heartbeat**; fan-in 30 | infrastructure (→ event sink) |
| Platform integrations (twitch, youtube, facebook, tiktok, kick, x, instagram, patreon) | 283 / ~280 | `getPlatformService()` **instantiates all 8** (~50 call sites) | per-platform plugins |
| Scene collections | 158 | **critical path: cloud `safeSync()` before load**; 60 s autosave | core |
| Settings (OBS, video v2, stream) | 148 / 153 | eager migration on login | core |
| Editor, commands/undo, selection | 145 / 109 | light | core |
| Sources, scenes, audio, filters, transitions | 219 | scene-collection load | core |
| Streaming/recording/replay (`streaming.ts` **211 KB, >5,100 lines**) | ~315 / ~260 | eager | core (most entangled) |
| Performance monitoring | 15 | **2 s polling via main** | core |
| i18n | 9 (+**11.9 MB locale JSON**) | eager | core (lazy-load locales) |
| User/auth | 58 | **`await autoLogin()` chains network calls before the scene appears**; fan-in 38 | core infrastructure |
| External API / remote control | 145 | named pipe + SockJS listen; **1 s rate-limit interval** | core (external interface) |
| Dead: `SseService` | 1 | no consumer | delete |

## Startup critical path (network before the user sees the scene)
`await autoLogin()` (platforms, validate, user info, prime) · scene-collection cloud `safeSync()` before
local load · `downloadAutoGameCaptureConfig` (CDN) · `refreshModuleLoadNotifications` · all 8 platform
services instantiated. Plus ~15 login-time requests from optional features and permanent timers
(1 s ×2, 2 s, 60 s ×2, 5 min, 10 min).

## Coupling
- **One strongly connected component with 67 of ~80 features**; still 38 after removing the obvious hubs.
- Core → optional edges (extraction blockers): `AppService` (hard-coded start/shutdown of ~10 optional
  features), `SourcesService` + properties managers (widgets, platform apps, guest cam, reactive data,
  streamlabels, media backup), `StreamingService` (restream, highlighter, grow, markers),
  `SceneCollectionsService` (widgets — creates an AlertBox, guest cam node, vcam), Settings (platform-app
  state, hard-coded app id), PerformanceService → troubleshooter, protocol links, nav menu (static keys),
  window registry (all dialogs imported statically).
- Core UI reaching into optional services: StudioFooter (Kevin, Highlighter), SourceSelector,
  SceneSelector (Automations), AddSource (platform apps, widgets), LiveDock, FeaturesNav.

## External interfaces to keep 100 % compatible (owner decision 2026-11-18)
| Interface | Details |
| --- | --- |
| **External API** | JSON-RPC 2.0 over named pipe `\\.\pipe\slobs`, TCP, **SockJS on port 59650** (token auth). Resources: Sources, Scenes, Selection, Streaming, SceneCollections, Audio, Notifications, Performance, Transitions, GameOverlay, RecentEvents, Customization. **Falls back to internal services for unknown resources** → effectively every internal service is reachable. Consumers: Stream Deck, Streamlabs Remote (cloud relay), e2e tests. |
| **Platform apps API** | 19 guest-API modules (`platform-apps/api/modules/*`) injected via preload `bundles/guest-api.js`; also used by Streamlabs web pages (alertbox library, overlays, app store). |
| **`slobs://` links** | `library`, `paypalauth`, `app`, `settings`, `join` (guest cam). |
| **User data** | Scene collections `<userData>/SceneCollections/*.json` (schema v5; optional modules own keys like `guestCam`, widget/streamlabel nodes — must round-trip when a module is disabled); Realm `persistent.realm` / `ephemeral.realm`; **localStorage `PersistentStatefulService-*` for 22 services incl. User auth, API token, highlighter library** (lives in the worker's Chromium profile → needs a one-time migration if services leave Chromium); OBS ini/json configs in userData. |

## Proposed module boundaries (first cut)
- **Core:** OBS kernel (canvases, sources, scenes, audio, filters, transitions, selection, editor,
  commands, projector, hotkeys), outputs (split out of `streaming.ts`), persistence (local scene
  collections, settings), shell (windows, navigation registry, layout, theme, notifications, lazy i18n),
  **multi-canvas as core**, external API.
- **Platform/account layer (when logged in, per-platform plugins):** user/auth, platforms, restream,
  chat, go-live UI, websocket on demand, rollout, remote control.
- **Optional modules:** AI (vision, automations, stream-avatar, Kevin, reactive data) · Platform apps &
  App Store · Streamlabs widgets (widgets, alert box, streamlabels, recent events, overlay store, game
  overlay) · Highlighter · Guest cam · Media · Engagement · Optimization & support · Importers · Misc
  (recording mode, markers, vcam?).
- **Extension points needed:** source-type/properties-manager registry; scene-collection node registry
  with unknown-key round-trip; output lifecycle hooks; UI contribution registries (nav, footer,
  settings pages, windows, source badges, AddSource entries); protocol-link registry; shutdown hooks;
  external-API resource registry; telemetry event bus.

## Open questions (for the owner)
External-API internal fallback policy · data of disabled modules · multi-canvas as core · Kevin socket
for every logged-in user.
