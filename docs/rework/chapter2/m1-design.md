# M1 design: media core and editor (step a)

*2026-11-20. Input for three parallel agents: (1) core (backend, OBS adapter, collections, slices and
commands), (2) editor UI in the main window, (3) main-process display support. Contracts:
`src/shared/contracts/{scenes,sources,audio,display,collections,main-rpc,index}.ts`
(`CoreContract` = app + all domain contracts). Paths below are relative to `legacy/app/services/`
unless they start with `src/`.*

## 1. Findings in the legacy implementation

### 1.1 Files on disk (`userData/SceneCollections/`)
- `manifest.json`, `<id>.json`, `<id>.json.bak`, `<id>.json.absolute.bak`
  (`scene-collections/state.ts:98-150`, paths `:205-215`). The `.tmp` + rename write is
  `file-manager.ts:245-262`; writes are queued in memory, retried 10 times (`file-manager.ts:188-218`).
- All files are `JSON.stringify(x, null, 2)`: UTF-8, LF, **no trailing newline**
  (`scene-collections.ts:1000-1006`, `state.ts:100-103`). Verified on all 5 fixture collections:
  `JSON.stringify(JSON.parse(f), null, 2) === f`. So a parse/serialize round trip is byte-exact as long as key order
  is kept (JS preserves insertion order, except integer-like keys, which do not occur in node data).
- Manifest = Vuex state minus top-level `auto`: `{activeId, collections: [{id, name, modified, auto,
  operatingSystem, deleted, needsRename, serverId?, sceneNodeMaps?}]}` (`state.ts:15-19,98-103`). Entry key order in fixtures: `id,name,modified,auto,operatingSystem,deleted,needsRename,serverId`.
  Recovery of bad entries: `state.ts:79-98`.
- `.bak` = the data of the **last successfully loaded** primary file, written verbatim right after a
  load (`scene-collections.ts:758`). `.absolute.bak` = pre-migration copy, written once (`:768-775`).
- Collections are never deleted from disk, only `deleted: true` (`:1209-1224`).
- Cloud sync (`safeSync`, `serverId`) is a feature (M5). M1 preserves `serverId` and does not sync.

### 1.2 Node tree (every node serializes as `{schemaVersion, nodeType, ...data}`, `nodes/node.ts:207-229`)
`RootNode` (v5) keys in save order (`nodes/root.ts:63-95`): `sources, scenes, transitions, hotkeys,
guestCam, relativeCoordinates, baseResolution, baseResolutions{horizontal,vertical}, selectiveRecording,
dualOutputMode, operatingSystem` and `nodeMap` last, only when present.

| Node (version) | Content | Core or feature |
| --- | --- | --- |
| `SourcesNode` (5) `items[]` | per source, keys in this order: `hotkeys` (HotkeysNode), `id,name,type,settings,volume,channel,muted,deinterlaceMode,deinterlaceFieldOrder, filters:{items[]}, propertiesManager,propertiesManagerSettings`, then for audio sources `forceMono,syncOffset{sec,nsec},audioMixers,monitoringType,mixerHidden` (`nodes/sources.ts:126-158`). Filter keys: `name,type,settings,enabled,visible,displayType` (`:115-122`). | core; widgets/streamlabels/platformApp are feature-owned via `propertiesManager*` (opaque) |
| `ScenesNode` (1) `items[]` | `hotkeys, filters (SceneFiltersNode), sceneItems (SceneItemsNode), id, name, active` (`nodes/scenes.ts:363-388`). A scene's id equals its source id; scenes are not in `sources` (`sources.ts:70`). | core |
| `SceneItemsNode` (1) `items[]` | **bottom-first** (`scene.getNodes().slice().reverse()`, `nodes/scene-items.ts:499-501`). Item keys: `hotkeys,id,sourceId,x,y,scaleX,scaleY,visible,crop{...,referenceWidth,referenceHeight},locked,rotation,streamVisible,recordingVisible,scaleFilter,blendingMode,blendingMethod,sceneNodeType:'item',display` (`:515-535`). Folder: model spread + `childrenIds, display` (`:542-546`). Old files (v2) lack many of these keys. | core |
| `TransitionsNode` (2) | `transitions[{id,name,type,duration,settings,propertiesManagerSettings}], connections[{fromSceneId,toSceneId,transitionId}], defaultTransitionId` (`nodes/transitions.ts:37-60`); v1 migration `:89-111`; alias `TransitionNode` (`scene-collections.ts:61-72`). | core |
| `HotkeysNode` (2) | items with bindings only (`nodes/hotkeys.ts:709`); at root, per scene, scene item, source. | core (M3 implements; M1 preserves) |
| `GuestCamNode` (1) | `audioSourceId, videoSourceId` (legacy save drops `screenshareSourceId`, `nodes/guest-cam.ts:16-21`). | feature (M5; preserve) |
| `NodeMapNode` (1) | `sceneNodeMaps` of dual output, mirrored in the manifest entry (`nodes/node-map.ts`, `state.ts:134-218`). | core (vertical canvas; preserve) |

Unknown `nodeType`s are kept as plain objects with a warning (`scene-collections/parse.ts:14-22`).
`FiltersNode` is deprecated and ignored.

### 1.3 Load order and how OBS objects are created (`nodes/root.ts:101-129`)
1. apply `baseResolutions` to the video contexts (`root.ts:103`, `settings-v2/video.ts:454-462`) **before** any
   scene graph exists; `selectiveRecording`, `dualOutputMode`; 2. `nodeMap`; 3. transitions
   (`TransitionFactory.create`, `transitions.ts:470-490`); 4. sources: sanitize (drop duplicate ids and
   channels, `nodes/sources.ts:182-198`), drop unsupported types (`:203-222`, `windowsSources`
   `sources/sources.ts:87-110`), force `is_media_flag=false` (`:248`), drop `face_mask_filter` and invalid
   `__PRESET` filters (`:254-271`), then **one bulk `obs.createSources([...])`** with `name = source.id`
   (the OBS source name is the Streamlabs source id) (`:313-330`); sources OBS did not return are
   reported and lost (`:334-356`); per source: register in app state, `setMul(volume)`, audio settings with
   defaults `forceMono=false, syncOffset 0, audioMixers=255, monitoring None (browser_source default
   MonitoringOnly)`, hotkeys, filter state (`:358-405`); 5. scenes: all `SceneFactory.create(id)` first
   (`scenes/scenes.ts:423-428`), filters, **then** items per scene (so nested scenes work): `obsScene.add(input,
   transform, videoContext)` per item (`scenes/scene.ts:464-524`; OSN also has a bulk
   `addItems(scene, items[])`, `module.d.ts:736`), `active` scene, hotkeys (`nodes/scenes.ts:408-433`);
   items whose source is missing are dropped (`scene.ts:471-474`); 6. root hotkeys, guestCam.
   Item errors are swallowed per item (`nodes/array-node.ts:259-287`).
- Scene item `x,y,scale` are passed to OSN as stored. "Relative coordinates" (`relativeCoordinates`,
  schema <5, `root.ts:136`) are handled inside OSN/obs64; the app only (a) writes `.absolute.bak` once,
  (b) loads in "strict" mode (any failure aborts persisting the migration, `scene-collections.ts:764-776,
  923-950`), (c) saves immediately after load (`:762-765`). Reproduce this exactly.
- Empty collection: scene "Scene", `Desktop Audio` (channel 1, `wasapi_output_capture`), `Mic/Aux`
  (channel 3, `wasapi_input_capture`), default transition (`scene-collections.ts:1155-1190`).
- Startup choice (`scene-collections.ts:171-195`): active collection if its `operatingSystem` matches,
  else the most recently modified loadable one, else create one (`auto: true`).

### 1.4 Save, recovery
- Save = `new RootNode().save()` then stringify (`:1000-1006`). Per source it **reads from OBS**:
  `obsInput.save()`, `.settings`, `.volume`, filters' `.settings` (`nodes/sources.ts:96-142`) – blocking
  IPC per object. Triggers: a 60 s interval, skipped while Live (`:1233-1244`); collection switch,
  create, shutdown (`persistForShutdown`, `:209-215`), video settings changes, login/logout. There is
  no change tracking: a crash loses up to 60 s.
- Load failure ladder: primary parse/load error -> `.bak` (`:690-725`, `.bak` read `:712`) -> (server copy, M5) -> dialog +
  brand-new empty collection, old files untouched (`:892-906`, `:735-745`). There is no safe mode.
  Migration failures keep the file and block saving it (`:714-731`).
- Missing/unsupported source types are **dropped and lost on the next save** (dialog only,
  `scene-collections.ts:926-936,982-996`). SPEC 5.5 says they must stay: see 3.6.
- Things that change the data on load/save and are therefore documented exceptions (3.4): `is_media_flag`,
  `hw_decode=false` (<4), `av_capture_input` rename (<5), `DesktopAudioDeviceN` rename (<3), duplicates,
  `mediasoupconnector` settings emptied, replay `local_file` removed, `syncOffset` rounded to ms,
  hotkeys without bindings dropped, OBS-normalized `settings`/`volume` floats.

### 1.5 Displays and audio
- `Display` (`video.ts:39-315`): window -> `createOBSDisplay(electronWindowId, name, mode, type, sourceId?)`
  -> `OBS_content_createDisplay(hwnd, name, mode, false, videoContext)` (`:377-408`); position from a 500 ms
  `getBoundingClientRect` poll x `scaleFactor` (`:27,146-201`); `OBS_content_moveDisplay/resizeDisplay/
  destroyDisplay/setPaddingColor(11,22,28)/setPaddingSize/setShouldDrawUI/setDrawGuideLines/
  getDisplayPreviewOffset/getDisplayPreviewSize` (`:410-444`); mac IOSurface path `:213-249,451`. Output
  region (letterbox) is fetched after each resize (`:283-301`) and used by the editor for hit testing
  (`editor.ts:111-116`); mouse events are on a DOM wrapper, the display child window is mouse-transparent
  (`components-react/root/StudioEditor.tsx:177-300`). While a modal is open the display is **destroyed**
  (`hideStyleBlockers`, `components-react/shared/Display.tsx:50-80`) because a native child window draws over DOM.
  Selection guides: core sets `obsSceneItem.selected` for every item of the scene (`selection/index.ts:126-153`).
- Video contexts: `VideoFactory.create()` + settings from OBS config (`settings-v2/video.ts:387-452`);
  `horizontal` and `vertical` are both created at init in legacy; scene items carry `display` and the
  matching `IVideo` (`scene.ts:480-496`).
- Audio: per audio source one `Volmeter` + one `Fader` (IEC) attached (`audio/audio.ts:379-389`); a single
  global `NodeObs.RegisterVolmeterCallback` (`:99-101`) gets `{sourceName(=id), magnitude[], peak[], inputPeak[]}`;
  merge by max and forward <= 20 Hz per source (`:396-419`); muted `wasapi_input*` are overwritten with
  -65535 (`:329-350`). "You are muted"/"no signal" detection (`:308-367`) is M3.
- Source flags/size come from `RegisterSourceCallback` (`sources/sources.ts:742-754`); source size and
  `audio/video` flags drive the mixer and the editor.

### 1.6 OSN surface used by M1 (`node_modules/obs-studio-node/module.d.ts`)
`IPC.host`, `NodeObs.OBS_API_initAPI`, `InitShutdownSequence`; `VideoFactory.create`, `IVideo`;
`InputFactory.create(id,name,settings)`, `createSources(SourceInfo[])` (`:758`), `getSourcesSize`;
`SceneFactory.create`, `IScene.add/addItems/moveItem/orderItems/getItems`, `ISceneItem` (position, scale,
rotation, crop, visible, stream/recordingVisible, scaleFilter, blending*, `selected`, `video`, remove);
`TransitionFactory.create`, `Global.setOutputSource(0, transition)` (`transitions.ts:347-390`);
`FaderFactory/VolmeterFactory`; `NodeObs.RegisterVolmeterCallback/RegisterSourceCallback/
RegisterTransitionCallback`; `NodeObs.OBS_content_*` (untyped: `[key: string]: any`).

## 2. Key design decisions

1. **Document model, not "rebuild from live state"**. Core keeps the parsed file as the persistence
   document (`CollectionDocument`) next to the live state. Save merges: unchanged nodes are re-emitted
   from the original JSON, changed nodes are the legacy shape overlaid on the original object (unknown keys
   survive, key order stays). This is what makes load -> save byte-identical despite OBS float
   rounding and feature-owned data.
2. **Dirty tracking by command**, not by polling OBS: every command that changes persisted data marks the
   node (source, scene, item, transitions, root) dirty. Only dirty nodes read from OBS at save time.
   A file is rewritten only if something is dirty (opening and closing never touches a file).
3. **Two-phase load**: document phase (no OBS) fills slices so lists render; media phase creates OBS
   objects in chunks.
4. **Domain enums are strings** in contracts; numeric file values live in `collections/format.ts`, numeric OSN
   values in `media/obs/enums.ts`.
5. **Multi-canvas ready**: `CanvasId` on items and displays; backend API is keyed by `CanvasId`; M1
   creates only `horizontal`. Items of other canvases stay in the document as foreign nodes (see 3.5).

## 3. Collections

### 3.1 Layout (core)
```
src/core/collections/format.ts     file types (node JSON schemas), numeric enum maps, schema versions
src/core/collections/codec.ts      parse (+ legacy migrations) -> CollectionDocument; serialize
src/core/collections/document.ts   CollectionDocument: raw tree, dirty sets, foreign/passthrough nodes
src/core/collections/store.ts      manifest + files: atomic write, .bak, .absolute.bak, debounced flush
src/core/collections/loader.ts     document -> services + backend (the load order of 1.3)
src/core/collections/saver.ts      services + backend -> document (merge rules of 3.3)
src/core/collections/service.ts    commands (contracts/collections.ts), startup choice, autosave scheduling
```

### 3.2 Compatibility contract
**C1 (hard)** Any collection the legacy app can read, we read; any file we write, legacy reads.
**C2 (byte identity)** `serialize(parse(F)) === F` for every legacy-written file (pure codec test, no OBS).
**C3 (no-op)** If nothing is dirty, no file is written (not the collection, not the manifest, not `.bak`
except as legacy does after a load, see C6).
**C4 (round trip with OBS)** load F into OBS, save without user changes (force-dirty all nodes in the
test) -> JSON equal to F after applying only the documented exceptions (3.4). The test compares
**paths and types, never prints values** (they may contain tokens).
**C5 (shape of changes)** A changed node is written with exactly the legacy key set and order (3.2 tables).
First real save of a schema <5 collection upgrades it to v5 the way legacy does (fills `display`,
`streamVisible`, `recordingVisible`, `baseResolutions`, `relativeCoordinates: true`, ...).
**C6** After a successful load write `<id>.json.bak` with the loaded text verbatim (legacy `:758`). If
migration is required (v<5 or `relativeCoordinates !== true`): write `.absolute.bak` once, save right away
(strict mode as in 1.3). Blocked migration -> `CollectionWarning.migration-blocked`, the collection is not saved.
**C7** Manifest: only mutate `activeId`, `modified`, entries we change; unknown keys on entries and the
root are preserved; entry key order as in 1.1.
**C8** Never write outside `userData/SceneCollections/`; atomic writes; never delete files.

### 3.3 Merge rules (saver)
For each node, `emitted = dirty ? overlay(raw, fresh) : raw`. `overlay` takes the raw object, replaces
values of keys we own, appends missing keys in legacy order, keeps unknown keys. Per field, "we own" =
the keys of the tables in 1.2. Feature-owned pieces (`propertiesManager`, `propertiesManagerSettings`,
`hotkeys`, `guestCam`, `nodeMap`, any unknown top-level key) are always raw. Source `settings` come from OBS
(`save()` then `settings`) only for dirty sources; for others raw. Items array order = reverse of node
order (bottom-first), folders' `childrenIds` in node order.
Volatile sources: types known to rewrite their own settings (to be found by test C4/T3; start with
`ffmpeg_source` replay) are always re-read and compared (deep equal after JSON normalization) to raw; they
become dirty only if different.

### 3.4 Documented exceptions (allowed differences in C4; list lives in the test file)
E1 `is_media_flag` forced false. E2 `hw_decode=false` for ffmpeg sources when schema <4. E3 dedupe of
duplicate ids/channels. E4 `DesktopAudioDeviceN`/`AuxAudioDeviceN` rename when <3. E5 `face_mask_filter`
and invalid `__PRESET` filters dropped. E6 `av_capture_input` -> `macos_avcapture` when <5. E7 exactly one
`active` scene. E8 manifest `modified` and `.bak`. E9 `mediasoupconnector` settings `{}`, replay
`local_file` removed (only when the source is dirty). E10 **deviations in our favor** (legacy loses data):
unavailable/failed sources and their items, `guestCam.screenshareSourceId`, hotkeys without bindings are
kept. E11 OBS-normalized values of dirty nodes only.

### 3.5 Dual output (vertical canvas)
Items with `display: 'vertical'` live in the same OBS scene bound to the vertical `IVideo`. M1 has no
vertical context: such items, `nodeMap`, `sceneNodeMaps` and `dualOutputMode` stay in the document as
**foreign nodes** (kept at their array position, never shown, never created in OBS). Adding vertical later =
create the context, load foreign nodes with `canvas: 'vertical'`; slices already carry `canvas`.

### 3.6 Unavailable sources (SPEC 5.5)
Unsupported types (not in the OS list) and sources OBS fails to create stay in the document as passthrough
(raw source + raw items referencing it), are not in any slice, and add a `CollectionWarning`. If the load
is in strict migration mode they block the migration instead (1.3).

### 3.7 Save scheduling
`dirty` -> debounce 2 s (trailing), max wait 30 s; flush on collection switch, on `collections.save`, and in
the shutdown sequence **before** OBS teardown (outputs -> **collections flush** -> sources -> OSN shutdown).
Saving yields to the event loop every 8 sources (OSN calls block the event loop, see 7). Allowed while Live
(only dirty nodes are read); revisit if it shows in the Recording CPU budget.

### 3.8 Testing with real collections
- Fixtures: `.bench/fixtures/<name>/slobs-client/` (git-ignored; contain tokens). Script
  `scripts/fixtures/copy-collections.mjs <fixture> <destDir> [--obs-config]` copies **only**
  `SceneCollections/**` and, with the flag, `basic.ini`, `global.ini`. Allowlist, not denylist; it must
  refuse everything else (`service.json*`, `Local Storage`, `Network`, `Preferences`, `*.realm*`, `appState`,
  `userId`, `Session Storage`...), refuse a `destDir` outside `os.tmpdir()`, and never print file contents.
- Vitest `test/collections/*.test.ts` (no OBS, no Electron): C2 for every fixture file (fixtures present:
  `default` has v2 and v5 files, a `.bak` and an `.absolute.bak`; `typical`, `loggedout`, `try`); C3; C7;
  schema upgrade golden tests with synthetic small collections committed under `test/fixtures/` (no tokens);
  recovery ladder (corrupt primary, corrupt both, missing file).
- C4/T3 integration (`npm run test:obs`, like `smoke.mjs`: throw-away userData, `SLOBS_USERDATA_DIR`):
  copy fixture -> launch -> load -> force-dirty -> save -> diff report (paths only) -> compare with E1-E11.
  Also: after load wait 10 s, re-read all source settings, report types whose settings changed (feeds the volatile list).

## 4. MediaBackend (`src/core/media/backend.ts`; write it exactly as below)
Async, JSON-serializable, id-based; no native object crosses. Ids are strings (OBS source name = source id);
`ItemRef` is the backend's opaque scene item handle (OSN: the numeric id), stored next to the persistent item id.
```ts
import type { CanvasId, SceneItemSettings, Transform, PartialTransform } from '../../shared/contracts';
import type { MeterFrame } from '../../shared/contracts';

export type ItemRef = number;
export interface BackendInfo { name: string; version?: string }
export interface SourceFlags { audio: boolean; video: boolean; async: boolean; doNotDuplicate: boolean }
export interface SourceHandleInfo extends SourceFlags {
  id: string; type: string; width: number; height: number; configurable: boolean;
  muted: boolean; volume: number; audioMixers: number; monitoring: number; syncOffsetMs: number;
}
export interface FilterSpec { name: string; type: string; settings: Record<string, unknown>; enabled: boolean }
export interface SourceSpec {
  id: string; type: string; settings: Record<string, unknown>;
  muted?: boolean; volume?: number; syncOffsetMs?: number; deinterlaceMode?: number; deinterlaceFieldOrder?: number;
  filters?: FilterSpec[];
}
export interface ItemSpec extends SceneItemSettings { sourceId: string; canvas: CanvasId; transform: Transform }
export interface ItemInfo { ref: ItemRef; transform: Transform } // as the backend normalized it

export interface CanvasInfo { id: CanvasId; baseWidth: number; baseHeight: number; outputWidth: number;
  outputHeight: number; fpsNum: number; fpsDen: number }

export interface BackendEvents {
  'source-changed': { id: string; width: number; height: number } & SourceFlags; // coalesced, only real changes
  'crashed': { reason: string };
}

export interface MediaBackend {
  readonly info: BackendInfo;
  init(opts: { appDataPath: string; version: string; installPath: string }): Promise<BackendInfo>;
  /** Order: stop volmeters, remove displays, release scenes/sources, then backend shutdown. */
  shutdown(): Promise<void>;
  on<K extends keyof BackendEvents>(e: K, cb: (p: BackendEvents[K]) => void): () => void;

  canvases: {
    /** Creates the canvas context from the backend's stored video settings if needed. Idempotent. */
    ensure(id: CanvasId): Promise<CanvasInfo>;
    get(id: CanvasId): Promise<CanvasInfo | null>;
    setBaseResolution(id: CanvasId, size: { width: number; height: number }): Promise<void>;
    destroy(id: CanvasId): Promise<void>;
  };
  sources: {
    /** Bulk create (one backend call). Entries missing in the result failed. */
    createMany(specs: SourceSpec[]): Promise<{ ok: SourceHandleInfo[]; failed: string[] }>;
    remove(id: string): Promise<void>;
    getSettings(id: string, opts?: { persist?: boolean }): Promise<Record<string, unknown>>; // persist: signal save() first
    updateSettings(id: string, patch: Record<string, unknown>): Promise<void>;
    getInfo(id: string): Promise<SourceHandleInfo | null>;
    getFilters(id: string): Promise<FilterSpec[]>;
    assignChannel(channel: number, id: string | null): Promise<void>; // Global.setOutputSource
  };
  scenes: {
    create(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    duplicateItems(from: string, to: string): Promise<void>;
    /** Items in bottom-first backend order. Bulk. */
    addItems(sceneId: string, items: ItemSpec[]): Promise<ItemInfo[]>;
    removeItem(sceneId: string, ref: ItemRef): Promise<void>;
    updateItem(sceneId: string, ref: ItemRef, patch: Partial<SceneItemSettings> & { transform?: PartialTransform }): Promise<ItemInfo>;
    /** Full order, top-first (UI order). */
    reorder(sceneId: string, refsTopFirst: ItemRef[]): Promise<void>;
    setSelected(sceneId: string, refs: ItemRef[]): Promise<void>; // backend draws guides
    getItem(sceneId: string, ref: ItemRef): Promise<ItemInfo | null>;
  };
  transitions: {
    create(spec: { id: string; type: string; settings: Record<string, unknown> }): Promise<void>;
    remove(id: string): Promise<void>;
    /** Program switch: `transitionId` null = cut. */
    switchScene(toSceneId: string, transitionId: string | null, durationMs: number): Promise<void>;
  };
  audio: {
    attach(id: string): Promise<{ db: number; deflection: number; mul: number }>; // fader
    detach(id: string): Promise<void>;
    setMuted(id: string, muted: boolean): Promise<void>;
    setFader(id: string, patch: { deflection?: number; db?: number; mul?: number }): Promise<{ db: number; deflection: number; mul: number }>;
    setSettings(id: string, patch: { forceMono?: boolean; syncOffsetMs?: number; mixers?: number; monitoring?: number }): Promise<void>;
    /** Volmeters exist only while enabled; frames are raw backend data, unmerged. */
    setMetersEnabled(enabled: boolean, ids: string[]): Promise<void>;
    onMeterData(cb: (batch: { id: string; peak: number[]; magnitude: number[]; inputPeak: number[] }[]) => void): () => void;
  };
  displays: {
    create(spec: { id: string; handle: Uint8Array; canvas: CanvasId; sourceId?: string; mode: 'main' | 'streaming' | 'recording';
      paddingColor?: { r: number; g: number; b: number }; paddingSize?: number; drawUi: boolean }): Promise<void>;
    /** Device pixels relative to the parent window's client area. */
    moveResize(id: string, r: { x: number; y: number; width: number; height: number }): Promise<void>;
    setDrawUi(id: string, draw: boolean): Promise<void>;
    setGuidelines(id: string, on: boolean): Promise<void>;
    setPadding(id: string, p: { color?: { r: number; g: number; b: number }; size?: number }): Promise<void>;
    getOutputRegion(id: string): Promise<{ x: number; y: number; width: number; height: number }>; // device px
    destroy(id: string): Promise<void>;
  };
}
```
`MeterFrame` is imported only for core meter encoding. Not in M1: filters editing, outputs, hotkeys,
stats, screenshots, interaction (M2/M3; areas already exist in SPEC 4). OSN objects live in
`media/obs/*` as `Map<id, native>`; ids are the only handles outside.

## 5. Core modules and runtime changes
```
src/core/media/backend.ts            interface above
src/core/media/obs/{adapter,canvases,sources,scenes,transitions,audio,displays,enums}.ts  osn.ts stays
src/core/media/fake.ts               in-memory MediaBackend for unit tests (no OSN)
src/core/scenes/{service,items,selection}.ts   slices scenes, sceneItems:<id>, selection, commands
src/core/sources/service.ts          slice sources, commands, source flag/size updates
src/core/audio/{service,meters}.ts   slice audio, meters sampler
src/core/display/service.ts          display slices + commands
src/core/transitions/service.ts      load from document, pick transition for scene switch (no editing in M1)
src/core/main-rpc.ts                 typed `callMain(method, ...args)` over parentPort
src/core/index.ts                    composition root: runtime<CoreContract>, init order of section 6
```
**Runtime changes needed (agent 1, `src/core/runtime/runtime.ts`)**
- R-a: `attach(transport, meta: { windowId: number })` and a synchronous `rt.caller()` ({ connId, windowId })
  valid at the start of a command implementation (set around `fn.apply`); plus `rt.onDisconnect(cb(connId))`.
  Needed by `display.*` (owner window, cleanup). `core/index.ts` passes the `windowId` of the `window-port` message.
- R-b: `MetersOptions.onActiveChange(active: boolean)`: volmeters are created only while a window has
  meters on (and destroyed ~2 s after the last one leaves). `sample()` returns the frame of `contracts/audio.ts`.
- R-c: command impls may use `rt.caller()` only synchronously, before the first `await`.

**Main (agent 3)**: handle `{type:'rpc', method:'window.nativeHandle', args:[windowId]}` from core
(`src/shared/protocol.ts` has the new `rpc`/`rpc-result` messages; types in `contracts/main-rpc.ts`) and answer
with `BrowserWindow.fromId(...).getNativeWindowHandle()` bytes as `Uint8Array`; map `windowId` -> window in
`connectWindow` (`src/main/core-process.ts:81`). Keep main thin: no display logic there.

## 6. Slices, commands, events (granularity)
| Slice | Shape | Notes |
| --- | --- | --- |
| `collections` | `CollectionsState` | list, status, warnings; tiny |
| `scenes` | `{activeSceneId, scenes:[{id,name}]}` | one patch per rename/switch |
| `sceneItems:<sceneId>` | `{sceneId, nodes[]}` | factory slice, created on first subscribe, disposed after last; a drag is `['s',['nodes',i,'transform','position','x'],v]` |
| `selection` | ids, lastId | core-owned (drives OBS guides) |
| `sources` | `Record<id, SourceInfo>` | size/flags updates are patches of single fields |
| `audio` | `sources` record + `mixer{rev,ids}` | fader writes touch 1-3 fields; `mixer` changes on scene switch |
| `canvases` | `{horizontal, vertical?}` | base/output size, fps |
| `display:<id>` | `DisplayState` | status and `outputRegion` only |
Never in slices: meter data (meters channel), source settings (command on demand), stats.

Commands and events: see the contracts (`ScenesContract`, `SourcesContract`, `AudioContract`,
`DisplayContract`, `CollectionsContract`). Rules: commands validate ids and throw `ENOENT` (unknown id),
`ELOADING` (a collection is loading and the call needs OBS objects), `ENOTREADY` (backend not initialized);
every successful mutation emits the matching bus event (External API/M4 and features use them; the runtime
forwards them only to windows that subscribed) and marks the document dirty. Multi-item commands apply
atomically in one microtask so subscribers get one patch batch. Selection: `selection.set` diffs old vs new
and only calls `backend.scenes.setSelected` for changed items (legacy touches every item, `selection/index.ts:136-144`).
Active scene change also recomputes `audio.mixer` and calls `transitions.switchScene`.

## 7. Startup sequence and timing
```
t0 main: app ready -> create main window (shell, no core needed)  ||  fork core, send `init`
core:  A  collections.init: read manifest + active file (sync fs), parse, normalize, fill slices   (target < 50 ms)
       B  backend.init (OSN initAPI, ~1.0-1.7 s measured in M0, BLOCKS the core event loop)
       C  canvases.ensure('horizontal'), apply base resolutions, create transitions
       D  sources.createMany in chunks of ~8 (yield between), then scenes.create x N, addItems per scene
       E  audio attach lazily (meters only when subscribed), set active scene, status 'ready'
window: connects as soon as its port arrives; renders lists from slices (status 'loading' = skeleton on the
        preview and mixer), `display.create` when the placeholder has a size; core queues it until E
```
- A runs before B on purpose: everything that is only JSON is done before the first blocking OSN call.
  Windows subscribing during B are answered after B (event loop blocked). **Risk R1**: every OSN call is a
  synchronous IPC round trip on core's thread. Budget per call/batch is unknown; step b must instrument
  (`[perf] mark name ms` lines: `core.start, doc.loaded, slices.ready, obs.init, sources.created,
  items.added, display.created, ready` + longest event-loop stall) and report. Decision gate: if stalls >
  ~50 ms during interactive use, move the OBS adapter behind a worker/process boundary (the interface is
  async for this reason, SPEC 4).
- Target (budgeted after the first measurement): lists visible at `initObs end + 100 ms`, preview at `ready + 150 ms`.
  Bulk calls (`createSources`, `addItems`) are preferred over per-object calls.
- Shutdown: stop meters -> destroy displays -> flush collections -> release scenes/sources -> `shutdownObs`
  (M0 order plus collections).

## 8. Meters path
OSN `RegisterVolmeterCallback` (one global callback, registered when the first volmeter is created) ->
adapter converts to `onMeterData` batches -> `audio/meters.ts` keeps one accumulator per source:
peak = max since last frame (per channel), magnitude/inputPeak = latest; muted inputs report -65535 (as
legacy `:329-350`). The runtime sampler (`meters` options, <= 15 Hz, `intervalMs: 66`) calls `sample()`, which
encodes the frame of `contracts/audio.ts` for `audio.mixer.ids` and **resets the accumulators**. No timer
runs without `meters-on`. Volmeter objects: created for the sources in `mixer.ids` when meters go on
(`R-b`), re-synced when `mixer.ids` changes, destroyed 2 s after meters go off. The UI sends
`meters-on` only while the mixer is visible and the window is focused or visible (document visibility +
IntersectionObserver); `useMeters(enabled)` already does the subscription.

## 9. Display protocol
1. Window (editor Display component): placeholder `div`, `ResizeObserver` + `IntersectionObserver` +
   `matchMedia('(resolution: Ndppx)')` change (DPR change on monitor move is not reported by RO) +
   `visibilitychange`; computes `DisplayView{rect, dpr, visible}`; rAF-free: one report per observer
   callback, coalesced with a microtask. `visible=false` also while any in-window overlay (popover, menu,
   dropdown) intersects the placeholder (the child HWND draws over DOM): the UI owns an `occluders`
   counter in a small composable.
2. `display.create(id, options, view)` (id = uuid chosen by the window; owner = `rt.caller()`).
3. Core: status `pending`; `callMain('window.nativeHandle', windowId)` (cached per window); waits for backend
   ready (E); `backend.displays.create`; status `ready`; `moveResize` with
   `round(rect * dpr)`; `getOutputRegion` -> `outputRegion = value / dpr`.
4. `display.update(id, view)`: keep only the latest view per display, apply on a microtask; unchanged size
   and position -> nothing. Re-read `outputRegion` after a size change and on `canvases` base-resolution
   changes (event driven). `visible=false` -> `moveResize` to 0x0 (legacy relies on that, `video.ts:174-176`),
   status `hidden`; hidden for > 10 s -> destroy (tunable; "nothing hidden for speed"), recreate on visible.
5. Owner disconnect -> destroy its displays (`rt.onDisconnect`). Shutdown -> destroy all before OSN shutdown.
6. Mouse: the display is transparent to the mouse; the editor overlay `div` receives events and does hit
   testing with `outputRegion`, source sizes (`sources`), canvas size (`canvases`) and item transforms
   (`sceneItems`), then commits through `sceneItems.transform` throttled to one call per frame. Preview lags by
   one IPC round trip, as in legacy. **To verify first (step c)**: the child HWND really passes mouse events;
   `OBS_content_*` sizes are device pixels; behavior at DPR 1.25/1.5/2 and across monitors.
7. macOS: IOSurface + `node-window-rendering` stays in main behind further `main-rpc` methods (out of scope here).

## 10. Work split and interfaces between the agents
- Agent 1 (core) owns: `src/core/**`, tests under `test/collections|core`, `scripts/fixtures/*`, `scripts/` obs
  test. Implements contracts exactly; any contract change goes through the main session.
- Agent 2 (editor UI) owns: `src/windows/main/**`, `src/ui/**` (Pinia stores per domain wrapping `useSlice`, scene
  list, source list, mixer with `useMeters`, `Display.vue` placeholder component, editor overlay). It develops against
  a mock core (`createClient` + `test/helpers` style runtime with `CoreContract` and the fake data) until agent 1 lands.
- Agent 3 (main) owns: `src/main/**`, `src/preload/**` if needed: `rpc` handler, window id map, no core logic.
- Shared and frozen for this step: `src/shared/contracts/*`, `src/shared/protocol.ts` (additive `rpc`/`rpc-result` added).
- Perf rules apply to the UI: no rAF loops, meters at <= 15 Hz drawn on change only, virtualized lists above ~100 rows.

## 11. Open questions and risks (for the owner)
1. **R1 blocking OSN on core's event loop** (7). Accepting it for M1 and measuring is proposed; the alternative
   (separate obs-host process) costs a second process (~20-70 MB, against the 250 MB budget) and a serialization hop.
2. **Unavailable sources are kept (we diverge from legacy, which drops them)** (3.6). Safer for users; it means
   a collection can carry invisible items. Confirm; the other option is to copy the legacy behavior exactly.
3. **Dirty tracking can miss sources that change their own settings** (3.3). Mitigation is the volatile list found
   by the T3 test; residual risk: a source type changes settings in a way no command sees, so the file keeps the old value
   (safe, never corrupt). Alternative: re-read every source at save (legacy parity, slower).
4. **Coordinate migration happens inside OSN** (1.3). We replicate legacy call order and values; verify with the
   `default` fixture's two v2 collections that item positions look the same as in legacy before declaring M1 done.
5. **Vertical canvas items are foreign in M1** (3.5): a dual-output user sees only horizontal items until M2 adds
   the second canvas; their data is preserved. `dualOutputMode` stays as saved.
6. **Native child window over DOM**: any in-window overlay over the preview must hide it (9.1); a context menu or toast
   drawn above the preview needs the `occluders` composable or a separate window. Needs a UI convention (agent 2).
7. **Transitions in M1** are loaded and used for scene switching only (no editor, studio mode is M3). Confirm.
8. **Hotkeys, filters, widgets, guest cam** are preserved verbatim and inert in M1 (hotkeys will not fire until M3);
   filters are created at load (via `createSources`) and saved raw.
9. **Autosave policy** differs from legacy (2 s debounce / 30 s max vs a 60 s interval, also while Live): confirm.
10. **Video context creation** (`settings-v2/video.ts:387-452`, incl. `migrateSettings` from OBS config) must be
    ported by the adapter; legacy also creates a vertical context at startup and writes vertical keys into the OBS
    config. M1 creates only horizontal; verify that skipping vertical changes nothing in `basic.ini` for users.
11. `OBS_content_*` is untyped (`NodeObs[key: string]: any`): the adapter needs a local typed shim; exact
    argument lists are in `video.ts:377-444`.
12. Fixture hygiene: collections themselves can contain widget URLs with tokens; tests must never log values and
    temp copies must be deleted after the run.
