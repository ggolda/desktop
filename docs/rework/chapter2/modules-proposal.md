# Module system — proposal for discussion

> **Superseded in part (2026-11-18):** the owner judged the plugin-style design (manifests,
> activation events, contribution points, slots) too complex for its benefit. See §10 for the
> revised, simpler direction. §1–9 are kept for the record.

*Draft 2026-11-18. Owner's direction: "several big modules that communicate via some bus, kinda like
OBS plugins". Builds on the coupling analysis in [discovery-modules.md](discovery-modules.md).*

## 1. Goals
- A lean **core** that starts fast and works fully offline / logged out (scenes, sources, audio,
  preview, recording, streaming with a stream key, settings).
- **Big feature modules** (App Store, AI/Vision, Widgets, Highlighter, …) that can be **disabled and
  are then not loaded at all** — no code parsed, no init, no timers, no network.
- Modules never import each other's or core's internals; they talk through stable contracts.
- The **media backend** (OBS today) is itself a module behind an interface.
- Compatible with the existing update/hotfix mechanisms: modules ship inside the app and are part
  of the same atomic bundle set (no separate module store in v1).

## 2. The model (OBS plugins × VS Code extensions)
| OBS plugin concept | Our equivalent |
| --- | --- |
| `obs_module_load()` entry point | module `activate(host)` in its core bundle |
| `obs_register_source/output/encoder/service` | declarative **contribution points** in the manifest + registration calls |
| libobs API | the **Host API** (stable, versioned) |
| signal handlers (events) | the **event bus** (typed pub/sub) |
| proc handlers (call by name) | the **service registry** (typed interfaces provided by modules) |
| plugin can be absent → source "missing" | module disabled → its data preserved, its items shown as unavailable |

VS Code adds what OBS lacks and we need: a **manifest read without loading code**, **activation
events** (load only when needed) and UI contribution points rendered by the host.

## 3. Anatomy of a module
```
modules/highlighter/
  module.json        # manifest: read at startup, no code executed
  core.js            # runs in the core process (lazy: on activation)
  ui/clips-page.js   # UI bundles, loaded by a window only when that UI is shown
  ui/footer-item.js
  locales/*.json     # module-owned translations, loaded on demand
```
`module.json` (sketch):
```jsonc
{
  "id": "streamlabs.highlighter", "version": "1.0.0", "hostApi": "^1.0",
  "kind": "feature",                       // core | backend | account | integration | feature
  "dependsOn": { "streamlabs.account": "^1.0" }, "optionalDependsOn": {},
  "activation": ["onOutput:replayBuffer", "onView:highlighter.page", "onCommand:highlighter.*"],
  "process": "core",                       // core (default) | isolated (own utilityProcess)
  "contributes": {
    "navItems": [{ "id": "highlighter.page", "title": "%nav.highlighter%", "icon": "clip", "view": "ui/clips-page.js" }],
    "footerItems": [{ "id": "highlighter.status", "view": "ui/footer-item.js", "when": "output.recording" }],
    "settingsPages": [], "dialogs": [], "dockPanels": [],
    "commands": ["highlighter.open"], "hotkeys": [],
    "sourceTypes": [], "sceneCollectionSections": [],
    "outputHooks": ["onStop:recording"],
    "protocolHandlers": [], "externalApiResources": [], "platformAppApi": [],
    "events": { "emits": ["highlighter.clipAdded"], "listens": ["output.*"] }
  }
}
```

## 4. How modules communicate
1. **Host API** (the "libobs" of the app): scenes, sources, audio, outputs, canvases (via the media
   backend facade), scene collections, settings storage (per module namespace), notifications,
   windows/dialogs, commands, i18n, HTTP with auth, telemetry, scheduler (timers that pause when
   idle/disabled). Versioned with semver; modules declare `hostApi`.
2. **Event bus**: typed, fire-and-forget pub/sub (`output.started`, `scene.switched`,
   `user.loggedIn`, `highlighter.clipAdded`, …). Crosses process boundaries transparently (windows,
   isolated modules) over MessagePorts. Cheap when nobody listens.
3. **Service registry**: a module can provide a typed interface (e.g. `streamlabs.socket` from the
   account module, `platform.twitch.chat`); consumers declare the dependency and get a proxy.
   Calls are async; if the provider is disabled, the dependency is unmet and the consumer isn't
   activated (or degrades, if optional).
4. **Contribution points**: declarative UI and extension slots (nav items, footer items, dock
   panels, settings pages, dialogs, AddSource entries, source-list badges, context-menu items,
   source types + properties UIs, scene-collection sections, output hooks, protocol handlers,
   external-API resources, platform-app API modules). Core renders the slot from manifest data and
   loads the module's UI bundle only when the contribution is actually shown.

## 5. Lifecycle
`discovered` (manifest read) → `enabled`/`disabled` (user or remote flag) → `activated` on its first
activation event (dynamic import of `core.js`, `activate(host)`) → `deactivated` (disposables
released: listeners, timers, windows, processes) → unloaded. Disabling at runtime deactivates
immediately; nothing of a disabled module is loaded on the next start.

## 6. Disabled modules and user data
- **Scene-collection sections** owned by a module (e.g. `guestCam`) are kept **verbatim** when the
  module is disabled and handed back when it's re-enabled.
- **Sources of a disabled module's type** stay in the collection (OBS keeps them too); the UI shows
  them as "unavailable — module disabled", properties are read-only.
- **External-API resources / platform-app API modules** of a disabled module answer with a clear
  "module disabled" error (legacy compatibility layer maps old names accordingly).

## 7. Proposed module set (big modules)
| Module | Kind | Contents |
| --- | --- | --- |
| core | core | editor, scenes, sources, audio, filters, transitions, selection, commands/undo, multi-canvas (dual output), outputs (stream/record/replay), scene collections (local), settings, hotkeys, projector, shell (windows, navigation, layout, theme, notifications, i18n), external API + legacy compatibility layer |
| obs-backend | backend | the OBS adapter implementing `MediaBackend` (the only code importing obs-studio-node) |
| streamlabs-account | account | login/auth, Streamlabs socket, hosts, rollout flags, cloud scene-collection sync, remote control |
| integration-twitch / youtube / facebook / tiktok / kick / x / instagram / patreon | integration | one module per platform (go-live settings, chat provider, scopes) |
| multistream | integration | restream / dual-stream relay (via output hooks) |
| chat | feature | live-dock chat host (uses platform chat providers) |
| widgets | feature | widgets, alert box, streamlabels, recent events, overlay & alertbox library, game overlay |
| app-store | feature | platform apps, app store, guest API host (`process: isolated` candidate) |
| ai | feature | vision, automations, stream avatar, Kevin (on demand), reactive data (`process: isolated` candidate) |
| highlighter | feature | clip library/editor, replay clips |
| guest-cam | feature | collab/guest cam |
| media | feature | media gallery, media backup |
| engagement | feature | onboarding, announcements, patch notes, outage, prime/marketing, grow |
| support | feature | auto-optimizer, troubleshooter, diagnostics report, cache uploader |
| importers | feature | OBS / Twitch Studio importers (onboarding only) |

## 8. Open questions for the owner
1. Granularity: is this set "big enough"? (Alternatives: merge integrations into one, split widgets.)
2. Who can disable modules — user (Settings → Modules), remote config (rollout flags), both?
3. Isolation: run `app-store` and `ai` in their own processes (more memory when active, but a crash
   or leak can't affect core), or everything in the core process?
4. Third-party modules: out of scope (platform apps stay the third-party extension mechanism)?
5. Independent module updates (outside app releases) later? v1 assumes modules ship with the app.

## 9. Cross-cutting UI (discussion 2026-11-18): slots into core views
Owner concern: features appear inside core views. For example, the highlighter shows up in the top
nav *and* in the go-live dialog. Does modularity make changes to core views hard?

- **Core owns its views' layout and exposes a few typed slots** where variation really exists.
  Examples: `goLive.sections`, `goLive.lifecycle` hooks, `nav.items`, `footer.items`,
  `sourceList.badges`, `source.contextMenu`, `addSource.types`, `settings.pages`, `dock.panels`.
- **Typed manifests**: `module.config.ts` uses `defineModule()` and is compiled to JSON at build
  time. Slot props and hook signatures are types exported by core's public API package. **One monorepo
  and one release**: a slot change fails the typecheck of every contributor in the same PR. It never
  surfaces as a runtime surprise.
- **Go-live as an extension point**: core renders the dialog frame, destinations and the start button.
  Contributors fill it:
  - platforms add their title/category sections;
  - multistream adds its relay settings;
  - highlighter adds an "AI highlights for this stream" toggle;
  - guest cam adds its section.

  Each section writes only to `draft.extensions[moduleId]`. Lifecycle hooks (`validate`,
  `beforeStart`, `afterStart`, `afterStop`) run in the core process with timeouts. This replaces
  today's hard-coded imports of every platform in the go-live form.
- **Isolation of failures**: every slot contribution renders inside an error boundary, and every hook
  has a timeout and error capture. A broken optional module degrades to "section unavailable", and
  going live still works.
- **Performance**: a contributed section is a small lazy chunk, loaded only when its slot is on
  screen. A module's core half activates only if its hook or section really needs it.
- **Rule of thumb against over-modularization**: if a feature has to reach into a core view in more
  than a few typed places, or core can't work without it, it belongs **in core**, behind a setting.
  Most day-to-day work stays inside one module or inside core and crosses no boundary.
- **Tooling**: a generated slot catalog (which module contributes where) and a dev overlay that
  outlines slot contributions in the running app.

## 10. Revised direction (2026-11-18): modular monolith with lazy features
Owner feedback: the plugin model is a lot of machinery for little gain. Small things (a platform's
go-live fields) don't need it, and big features still need core changes, so core becomes the
"giga brain" anyway. Agreed: slots and contribution points pay off for a third-party ecosystem
(VS Code). We have one team, one repo and one release, and platform apps already cover third
parties.

**What we keep** (the real benefits):
1. **Disabled features are not loaded at all.** No parse, no init, no timers, no network.
2. **Clear boundaries**, enforced by lint (dependency rules). This prevents today's 67-feature
   import cycle.
3. **The media backend stays behind an interface** (OBS is one implementation).

**What we drop**: manifests, activation events, contribution points and slots, the service registry,
and versioning of a generic Host API.

**Shape:**
- `core/`: everything the app needs to work, including platforms. Each platform is a small adapter
  that implements one `Platform` interface: go-live fields, chat, scopes. This is plain code.
- `features/<name>/`: big optional features only. Each has:
  - `service.ts`: the core-process half, lazily imported;
  - `ui/`: Vue components, lazily imported;
  - `api.ts`: a public surface, the only file others may import.

  Candidates: highlighter, app-store, ai/vision, widgets, guest-cam, media gallery, onboarding.
- `features/registry.ts`: a hand-written list,
  `{ id, defaultEnabled, load: () => import('./highlighter/service') }`.
- **Core views reference features directly and explicitly.** For example, the go-live dialog has
  `<HighlighterToggle v-if="features.enabled('highlighter')"/>` where the component is a
  `defineAsyncComponent(() => import('@features/highlighter/ui/GoLiveToggle.vue'))`. This is
  greppable and refactorable, and it costs nothing when disabled.
- **Communication**: plain typed function calls through `api.ts`, plus a small typed event emitter in
  core (`output.started`, `scene.switched`, …) for reactions.
- **Lint rules**:
  - features may import `core/public` and other features' `api.ts` only;
  - core-process code may load features only through the registry (lazily);
  - nothing imports `ui/` from the core process.
