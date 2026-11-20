# M1 dialogs design: dialog windows, Add Source, Source Properties, Name/Rename

*2026-11-20. Input for two parallel agents: (A) core + main (dialog window manager, source catalogue, creation,
properties API), (B) UI (dialog window entries in the legacy look). Contracts, all types only:
`src/shared/contracts/{dialogs,source-types,properties,main-rpc,index}.ts` (`CoreContract` includes them).
Reference screenshots: `docs/rework/ui-reference/dialogs/` (README there). Paths below are relative to `legacy/`
unless they start with `src/`.*

## 1. Findings in the legacy implementation

### 1.1 The child window (all dialogs)
- **One** child `BrowserWindow` hosts every dialog (`main.js:399-441`): `frame:false`, `titleBarStyle:'hidden'`,
  `fullscreenable:false`, background `#17242D`, no menu. It is **not modal and has no parent**: the main window stays
  interactive and can cover it. Created on demand by `window-ensureChildWindow` (`main.js:855`), destroyed on close
  (`window-closeChildWindow`, `main.js:866`; ADR-0003; `SLOBS_WARM_CHILD` keeps the old warm window).
- `WindowsService.showWindow(options)` (`app/services/windows.ts:318`) = ensure window + `centerChildWindow`
  (`:345`): it **replaces the dialog in place** when one is open (no confirmation), centers on the main window's
  bounds only when `componentName` changed (`:319-324`, so navigating inside Settings does not jump), clamps
  `size` to the work area of the main window's display (`:326-337`) and sets **min size = open size** (`:354`, the
  window can only grow, and has maximize). The page swaps the component after a 50 ms timeout
  (`components/windows/ChildWindow.tsx:129`) and sets the OS title from `options.title`.
- Child title bar is the custom `TitleBar` (`ChildWindow.tsx`): app icon, title, **refresh** (`window.location.reload()`),
  minimize, maximize, close (screenshots). Closing (X, Alt+F4) goes through the page first (`main.js:427-431`), which
  then closes via IPC; closing focuses the main window (`windows.ts:421-428`).
- Sizes and titles (`$t` keys): Add Source showcase 900x700 "Add Source" (`sources.ts:995`); Add Source naming 600x320
  "Add Source" (`:1006`); Source Properties 600x800 "Settings for %{sourceName}" (`:809-870`, name = display name of the
  type); Name Scene 400x250 "Name Scene" / "Rename Scene" (`scenes.ts:611`); Duplicate Scene 400x250 "Name Scene"
  (`:643`); Name Folder 400x250 "Name Folder" / "Rename Folder" (`:623`); Rename Source 400x250 "Rename Source" (`:1018`).
- **Results** do not travel back: the dialog component calls services directly (editor commands, undoable) and closes
  itself (`WindowsService.closeChildWindow()`); `queryParams` carry the input (`useChildWindowParams`).
- **OBS display while a dialog is open**: nothing happens to the main display. Only *in-window* modals hide it
  (`hideStyleBlockers` -> `Display` destroys/recreates the OBS display, `components-react/shared/Display.tsx:50-80`),
  because the native HWND draws over the DOM. A dialog is a separate top-level window, so there is no overlap. The
  dialog's own preview display is hidden for 200 ms while the dialog window is being resized (`ChildWindow.tsx`
  `windowSizeHandler`). *The current reborn main window uses in-window stand-ins (`src/ui/components/NameDialog.vue`
  with `useOccluder`); they are replaced by these windows.*

### 1.2 Add Source
Three steps, all in the one child window (each replaces the previous):
1. **Showcase** (`components-react/windows/source-showcase/`): tabs *All Sources / Media Categories / Widgets /
   (Apps, only when platform apps exist)* + fuzzy search (Fuse; keys type 1, name .8, shortDesc .5, description .2,
   threshold .3), tiles in a 3-column grid, collapsible sections (all open), 300 px side panel (demo image or video from
   `media/source-demos/<night|day>/<file>`, name, description, "Supports:" bullets, optional link), footer
   Close / **Add Source**. Click = inspect, double click or Add Source = continue. Initial selection `ffmpeg_source`
   (logged out) or Alert Box (logged in). Sections of the All tab: *Essentials* (game_capture, dshow_input,
   ffmpeg_source in that order, then Alert Box, Chat Box, Game Pulse, Stream Label when logged in), *Capture Sources*,
   *Video and Audio*, *Media*, *Widgets*, *Apps*. Essentials are **repeated** in their group (screenshot: Game Capture
   twice). Hidden: `text_ft2_source` on Windows, `scene` with <= 1 scene, `mediasoupconnector` unless guest cam is enabled
   and logged in. Always appended: "Instant Replay" (`replay`), "Custom Icon" in designer mode. Logged out, the Widgets
   tab shows the sleeping-Kevin empty state "You must be logged in to use Widgets" + "Click here to log in".
2. **AddSource** (`AddSource.tsx`): if sources of the same type and properties manager exist (`Source.isSameType`,
   `source.ts:108`: same type + manager, never a source with a `channel` = global audio, never the target scene), shows
   "Add Existing Source" (menu list + 200x200 display preview of the selected one + switch "Add a new source instead",
   `addExisting` checks `canAddSource`: a scene cannot contain itself, else a native error box). Otherwise the form
   "Add New Source": required text input prefilled with `suggestName(<English description of the type>)` (the
   untranslated `getAvailableSourcesTypesList` text: "Image", "Color Block", "Video Capture Device", ...; names are
   `name`, `name (1)`, `name (2)`, `naming-helpers`; Replay "Instant Replay", Stream Label, Custom Icon, widgets and
   apps have their own names). Footer Cancel / **Add Source**; Enter submits.
3. After creation (`AddSource.tsx` `addNew`): `!source.video && source.hasProps()` (audio-only) -> **Advanced Audio
   Settings** window (`AudioService.showAdvancedSettings`); `hasProps()` (= `configurable`) -> **Source Properties**
   (same window, replaced); else close.
- **Creation** is `CreateNewItemCommand` -> `Scene.createAndAddSource` (`scenes/scene.ts:204`) = `createSource` +
  `addSource`: id `<type>_<uuid>`; OBS `InputFactory.create(type, id, settings)`; the item is added to the scene
  (OBS default transform: position 0,0, scale 1; **no fit-to-screen**), is **selected** (`options.select` defaults to
  true), `display: 'horizontal'`. Undo = remove the item (and the source, as no scene uses it).
- **Settings defaults** (`sources.ts:613-660`, `getObsSourceCreateSettings`): `browser_source`: `shutdown:true`,
  `url:'https://streamlabs.com/browser-source'` (width 800 / height 600 / CSS come from OBS defaults, see screenshot);
  `text_gdiplus`: `text = name`, `version = 3`; `dshow_input`: `video_device_id` = default video device (settings of
  Default Hardware) and the default preset filter; `is_media_flag` forced false (`:365`); `smart_browser_source` is
  remapped to `browser_source` with `webpage_control_level 5`, 1280x720 (feature). Platform apps pass `width/height`.
  Everything else is left to OBS (color source: white 400x400, window capture: Automatic / Capture Cursor on, ...).
  The default properties manager additionally runs on **every** creation and load (`default-manager.ts`):
  `game_capture` and `screen_capture` get `auto_capture_rules_path = <userData>/game_capture_list.json`,
  `auto_placeholder_image` and `window_placeholder_image = capture-placeholder.png`, messages "Looking for a game to
  capture" / "Specified window is not a game", `capture_overlays ??= true`; media backup (logged in, feature),
  Google font download for text sources with a missing `custom_font` (feature/network). After adding, a missing
  audio `device_id` is reset to `'default'` (`sources.ts:507-525`). The new source gets the mixer defaults of M1
  design 1.3 (`audioMixers 255`, monitoring off, `mediasoupconnector` monitor-only).
- *Existing core code diverges*: `src/core/sources/service.ts` `defaultSettings` sets browser `width/height/fps` and color
  1280x720 and lacks `shutdown/url/version/auto-capture`; replace by the list above.

### 1.3 Source Properties
- Which implementation: `showSourceProperties` (`sources.ts:809`) -> special windows for `screen_capture`
  (ScreenCaptureProperties, 690x800), `mediasoupconnector` (Guest Cam), widgets, platform apps, icon library (features);
  otherwise **`SourceProperties` (React)** for `color_source`, `browser_source`, `ffmpeg_source`, `game_capture`,
  `dshow_input`, `openvr_capture` with the `default` manager, else **`SourcePropertiesDeprecated` (Vue)**
  (`components/windows/SourceProperties.vue`) for all other types (image, slideshow, text, monitor/window capture, audio...).
  Both 600x800, title "Settings for <type name>" (Replay "Instant Replay", Stream Label "Stream Label").
- Layout (`ModalLayout`): top **fixed 200 px** section with the **source preview display**
  (`<Display sourceId>`, background `--section`), scrollable body, footer 53 px. The two variants differ visually:
  React = horizontal antd form (labels right aligned, rendered by `ObsForm`), footer is the default one: a single
  **Close**; Vue = `GenericForm` (labels left, controls right), footer **Cancel** + **Done**.
- **Cancel/Close/Done all just close.** There is no revert and no draft: every edit is applied immediately
  (`EditSourcePropertiesCommand`, a *combinable* undo command, consecutive edits of one source merge,
  `edit-source-properties.ts`). A source added by Add Source stays in the scene even if properties are closed with
  Cancel. The window closes by itself when the source is removed (`sourceRemoved`).
- Data flow per edit (`SourceProperties.tsx`, `ObsInput.ts:setPropertiesFormData`): the form sends **one changed
  property** (`formData[changedInd]`); the service calls button handlers (`buttonClicked`), builds a settings dictionary
  `{name: value}` (font: `custom_font = value.path`, `path` removed), `obsSource.update(settings)`, re-reads **all**
  properties, and if a `list` value is no longer among its items sets it to the first item and repeats. Then
  `sourceUpdated` fires and the window re-reads **the whole property set** (`getPropertiesFormData`). Legacy never calls
  `property.modified()`: libobs applies the settings to a fresh property set when `source.properties` is read
  (`obs_source_properties` -> `obs_properties_apply_settings`), which is how `modified` callbacks change `visible`,
  `enabled` and list items. *(libobs knowledge, to be verified by a probe, see open question 3.)*
- Debounce: browser `url` 1000 ms (`SourceProperties.tsx`), slider 500 ms (React) / 100 ms (Vue), color 500 ms, textarea
  300 ms, Vue `url` text emits on change (blur/Enter) only, everything else immediate. Validation: a number outside
  `min/max` is not emitted; resolution lists accept a custom `WxH`.

### 1.4 Property types (`ObsInput.ts:getPropertiesFormData`, `ObsForm.tsx`, `components/obs/inputs/*`)
Backend `EPropertyType`: Invalid 0, Boolean 1, Int 2, Float 3, Text 4, Path 5, List 6, Color 7, Button 8, Font 9,
EditableList 10, FrameRate 11, Group 12, ColorAlpha 13, Capture 14 (`obs-studio-node/module.d.ts:73`).

| Backend | Legacy form type | Rendering (React / Vue) |
| --- | --- | --- |
| Boolean | `OBS_PROPERTY_BOOL` | checkbox (React) / toggle switch (Vue); label next to it |
| Int, Float | `INT`, `FLOAT` (+`min/max/step`) | number input (clamped); `Slider` number type -> `OBS_PROPERTY_SLIDER`: slider + number box |
| Text default / password (`masked`) | `OBS_PROPERTY_TEXT` | text input; password masked |
| Text multiline | same, `multiline` | textarea (4 rows) |
| Text info (`TextInfo`) | same, `infoField` + `infoType` Normal/Warning/Error | framed read-only message with icon (React only; empty or "Attempting to hook process..." hidden); rich text (links) |
| Path file / Path directory | `OBS_PROPERTY_FILE` / `OBS_PROPERTY_PATH` (+`filters`, `defaultPath`) | text input + **Browse** (native open dialog, file or folder). `FileSave` is not distinguished by legacy (treated like a file) |
| List (`format` int/float/string) | `OBS_PROPERTY_LIST` + `options[{description,value}]` | dropdown. The backend does not expose combo/editable/radio. Value `0` with empty label = "Select Option". Labels pass `$translateIfExistWithCheck` |
| Color | `OBS_PROPERTY_COLOR` | swatch + hex field + eyedropper; value is int `0xAABBGGRR` (`Utils.rgbaToInt/intToRgba`), alpha always edited |
| Font | `OBS_PROPERTY_FONT` (`value {face,style,size,flags}` + `custom_font` as `path`) | "Use Google Font" switch; system font: family list, style list (from `font-manager`), size slider; Google font selector |
| EditableList (`type`: strings/files/files-and-urls, `filter`, `defaultPath`) | `OBS_PROPERTY_EDITABLE_LIST` | sortable list + Add Files / Add Directory menu, edit (replace file), remove |
| Button | `OBS_PROPERTY_BUTTON` | button; press sends `value: true` -> `buttonClicked(source)` on the backend |
| FrameRate, Group, ColorAlpha, Capture, Invalid | `undefined` | React: red "Unknown input type"; Vue: nothing. (Legacy treats alpha colors as plain color.) |
| (settings API only) `BITMASK`, `UINT`, `DOUBLE`, `RESOLUTION_LIST`, `EDIT_TEXT` | exist in `TObsType` | not source properties; out of scope here |

`visible=false` hides the row, `enabled=false` disables it. The deny list and display order of a **properties
manager** filter and sort the list (`properties-manager.ts`); the default manager has none (feature managers do).

### 1.5 obs-studio-node surface (`module.d.ts:370-450,600-660`)
`ISource.properties: IProperties {first(), last(), count(), get(name)}`; `IProperty {name, description, longDescription,
enabled, visible, type, value, next(), previous(), is_first(), is_last(), modified()}`; subtypes `IListProperty.details
{format, items[{name,value}]}`, `IEditableListProperty.details {type, filter, defaultPath, items, format}`,
`IPathProperty.details {type: File|FileSave|Directory, filter, defaultPath}`, `ITextProperty.details {type:
Default|Password|Multiline|TextInfo, infoType}`, `INumberProperty.details {type: Scroller|Slider, min, max, step}`,
`IButtonProperty.buttonClicked(source)`; `ISource.update(settings)`, `.settings`, `.configurable`, `.outputFlags`.
Every property getter is a synchronous IPC round trip to obs64 and `properties` creates a new set on each read
(see risk R1 in `m1-design.md`).

## 2. Decisions

1. **Dialog windows are thin per-kind Vite entries** (`src/windows/dialog-<kind>/`), created on demand, destroyed on
   close. **One dialog window at a time**, opening another dialog **replaces it in place** (legacy parity, no new
   window flicker; the page navigates to the other entry).
2. **Window creation goes through main** (`dialogWindow.*` main RPC, generic: core sends entry, title, size). Main
   knows no dialog kinds, so sizes/titles/new dialogs are hotfixable (main is not).
3. **Not modal, no parent** (legacy). The main OBS display is untouched (a dialog never overlaps it). No result
   channel: dialogs call domain commands and close themselves.
4. **First paint with data**: core computes `DialogState` synchronously in `dialogs.open` (catalogue, suggested name,
   existing sources...) before the window exists; the page subscribes `dialog:<id>` as its first message.
5. **Properties are a dialog-scoped slice** `properties:<dialogId>` with a backend re-read after every change and
   diff-patching (that implements `modified` and the legacy refresh); edits are `properties.set` (batch of changes),
   buttons `properties.press`. Values are never in global slices.
6. **Catalogue is core-provided** (`SourceCatalogue`); feature-owned entries are `hidden` for now (`disabled` is for a
   present-but-unusable feature later).
7. **Add Source orchestration lives in core** (`dialogs.submitAddSource`): the UI sends `{mode, name | sourceId}`; core
   decides the next step (properties, or close). This keeps flow rules hotfixable and removes UI round trips.
8. **Done/Cancel/Close = close, never revert** (legacy, 1.3), with the two footers kept.

## 3. Dialog window manager

### 3.1 Roles
| Where | Responsibility |
| --- | --- |
| core `src/core/dialogs/service.ts` | commands `dialogs.*`, registry `dialogId -> {kind, params, windowId, data}`, slice `dialog:<id>`, builds `DialogDataMap`, specs table (kind -> entry, size), calls main RPC, closes dialogs bound to a removed source |
| main `src/main/dialog-window.ts` (new) + handlers in `src/main/main-rpc.ts` | create/replace/close the BrowserWindow, native file dialogs, focus main on close; knows nothing about kinds |
| window `src/windows/dialog-<kind>/` | thin Vue entry: reads `?dialog=<id>`, subscribes the slice, renders, calls commands, `window.reborn.window.close()` |

### 3.2 Specs table (lives in core, `src/core/dialogs/specs.ts`; sizes are outer DIP as legacy)
| kind | entry | size (min = size) | title (caller passes translated) |
| --- | --- | --- | --- |
| `source-showcase` | `dialog-source-showcase` | 900x700 | Add Source |
| `add-source` | `dialog-add-source` | 600x320 | Add Source |
| `source-properties` | `dialog-source-properties` | 600x800 | Settings for %{type name} |
| `name-scene` | `dialog-name-scene` | 400x250 | Name Scene / Rename Scene |
| `rename-source` | `dialog-rename-source` | 400x250 | Rename Source |
| `name-folder` | `dialog-name-folder` | 400x250 | Name Folder / Rename Folder |
Vite: add the six names to `windows` in `vite.windows.config.ts` (flat prod output `bundles/<name>.html`, the existing
`flatHtml` plugin handles it; the hotfix manifest picks them up through `slobsManifest`).

### 3.3 Lifecycle
1. UI calls `core.dialogs.open({kind, params, title})` (any window; core code may call it too).
2. Core validates params (`ENOENT` for unknown ids), builds `data`, creates `dialogId` (uuid), stores the state and
   slice, then `callMain('dialogWindow.open', spec)`. Main: no dialog window -> `new BrowserWindow({show:false,
   frame:false, titleBarStyle:'hidden', fullscreenable:false, backgroundColor: WINDOW_BG, sandbox/contextIsolation as
   main window, preload as main window})`; size clamped to the work area of the main window's display; `setMinimumSize`;
   center on the main window bounds (`position:'main'`); `loadURL(windowUrl(entry) + '?dialog=' + id)` (dev: Vite,
   prod: `slbundle://app/<entry>.html?dialog=<id>`; **verify the protocol handler ignores the query**); `ready-to-show`
   -> `show()`; `dom-ready` -> `core.connectWindow(win.id, contents)` (as the main window). Returns `{windowId}`.
   No new `setWindowOpenHandler` rules beyond the main window's (deny, external URLs to the OS browser); `will-navigate`
   is blocked except main's own `replace`.
3. Dialog already open -> main `dialogWindow.replace`: `setTitle`, size and min size, center on main **only when the
   entry changed** (legacy), `loadURL` of the new entry. The old page's port disconnects; core drops the previous
   dialog record (and its `properties:<oldId>` slice, display, subscriptions) and closes nothing else.
4. Page connects, sends `sub dialog:<id>` first, renders from the snapshot (no further call needed to paint), sets
   `document.title`. Dialog-specific data (properties) is a second `sub properties:<id>` sent in the same tick.
5. Close: Close/Cancel/Done/X -> `window.reborn.window.close()` (existing preload API) -> main destroys the window and
   focuses the main window. Core learns from the port closing: **add** `{type:'window-closed', windowId}` to
   `MainToCoreMessage` (in addition to `rt.onDisconnect`) so the registry is cleaned even if the port event is late;
   core then emits `dialog.closed`. `dialogs.close(id)` = `dialogWindow.close` for programmatic closes (source removed:
   core closes the `source-properties` dialog of that source, like `sourceRemoved` in 1.3; collection switch closes
   all dialogs; shutdown destroys them before OBS teardown).
6. Window destroyed with no dialog open = nothing remains (no warm window, no timers).

### 3.4 Parent, modality, display
No `parent`, not modal (legacy 1.1). The user can interact with the main window while a dialog is open; the dialog
may fall behind it. The main OBS display is never destroyed for a dialog window. Dialogs that show a preview
(`source-properties` 200 px area, `add-source` existing 200x200) create a **display bound to `sourceId`** with
the existing `display.create` command (`DisplayCreateOptions.sourceId`), owned by the dialog connection (destroyed on
disconnect). The dialog page must hide it (view `visible:false`) while an in-window overlay covers it (a dropdown
list, tooltip) and while the window is being resized (200 ms, legacy) using the existing `useOccluder` machinery.
Open decision: whether to add a `parent`/modal later (open question 1).

### 3.5 Title bar and chrome (B)
Custom title bar for dialogs: app icon, title, refresh (reload), minimize, maximize, close, same look as the main
title bar (`src/windows/main/components/TitleBar.vue`, make a shared `DialogTitleBar` in `src/ui/`). Body = legacy
`ModalLayout`: `--background`, content area scrollable, footer `--section` 53 px with right-aligned buttons
(`button--default` "Close"/"Cancel", `button--action` primary "Done"/"Add Source"), fixed 200 px preview section for
properties.

### 3.6 Native file dialogs
Browse buttons (path, editable list, file inputs) call `core.dialogs.pickPath(options)`. Core reads the caller's
window id with `rt.caller()` (before the first await, rule R-c) and calls `dialog.showOpen/showSave` with it as parent
(legacy used `remote.dialog.showOpenDialog`). Filters use the shape of `PathFilter`.

## 4. Properties schema

### 4.1 Wire format
`Property` = discriminated union on `kind` (`contracts/properties.ts`): `bool, int, float, slider, text, password,
multiline, info, path-file, path-save, path-dir, list, color, font, editable-list, button, unsupported`, each with
`name, description, longDescription?, enabled, visible` and kind-specific `value` and metadata (number
`min/max/step`, list `format/items`, path `filters/defaultPath`, info `severity`, color `alpha`, editable list
`listType/filters/defaultPath`). `description` and list item names are English libobs strings (UI translates with
`$translateIfExist`). Values: bool boolean; numbers number; text/path string; list string|number matching `format`;
color int `0xAABBGGRR`; font `{face,style,size,flags,path?}`; editable list `string[]`; button no value.
Conversion from the backend (`src/core/properties/convert.ts`, a pure function with unit tests on fake property
objects): `EPropertyType`/`details` -> kind as in 1.4; paths: `File` -> `path-file`, `FileSave` -> `path-save`,
`Directory` -> `path-dir`; text details; `Slider` number type -> `slider`; filters parsed with the legacy
`parsePathFilters` rules (`;;` separated `Name (*.a *.b)`, `*.*` -> All Files); `custom_font` from settings goes
into `font.path`; `FrameRate/Group/Capture` -> `unsupported`; `ColorAlpha` -> `color` with `alpha`.

### 4.2 Backend additions (`src/core/media/backend.ts`, `media/obs/sources.ts`, fake)
```ts
export interface BackendProperty { /* as read from IProperty + details, plain data, see convert.ts */ }
sources: {
  /** Fresh property set (backend re-applies the settings, so `modified` callbacks have run). One bulk call. */
  getProperties(id: string): Promise<BackendProperty[]>;
  pressButton(id: string, name: string): Promise<void>;
}
```
`updateSettings(id, patch)` exists. The OSN adapter iterates `first()/next()` and reads each field once.

### 4.3 Slice and updates
- `properties:<dialogId>` is a **factory slice** (created at first subscribe, disposed after last). On subscribe core
  reads the set (`getProperties`) once.
- `properties.set(sourceId, changes)`: apply `changes` -> `settings` (`font` split into `font` and `custom_font`,
  buttons excluded) -> `backend.sources.updateSettings` -> mark the source dirty -> `getProperties` -> list-value check
  (value missing from items -> first item, repeat once) -> diff against the slice -> patches (changed `value`, `visible`,
  `enabled`, `items`; full `items` replace only if names/order changed) -> `rev++`. Coalesced: calls arriving while
  one is running are merged into one `updateSettings` + one re-read (OSN calls block the event loop).
- `properties.press(sourceId, name)` -> `pressButton` -> re-read. `properties.refresh` -> re-read only.
- Events: emit `source.updated`. After a change of `browser_source` `url` etc. the source size changes through the
  existing `source-changed` backend event.
- Core records an undo step per source (combinable) as soon as the undo feature exists (M2/M3 hook: one call
  `history.record('edit-source', sourceId)`; nothing to build now).

### 4.4 Which properties are shown
Everything the backend lists, in backend order, minus the properties manager's deny list / plus its order. For the
`default` manager both are empty (M1 has only default). Feature managers (widget, streamlabels, platformApp...) own
their own dialogs and are out of scope.

### 4.5 UI rendering rules (B)
`src/ui/properties/PropertyForm.vue` renders `Property[]` with one component per kind (shadcn-vue restyled to legacy):
two layouts, **horizontal** (React variant: label column right-aligned, 600 px body) and **vertical-label-left**
(Vue variant, `chrome:'cancel-done'`). Local state: optimistic value per property until the next patch for that
property; commit rules = the debounce table of 1.3 implemented with `useDebounceFn` (no timers while idle);
`number` outside `min/max` is not sent; `list` values are sent in the item's own type. `visible:false` -> not
rendered, `enabled:false` -> disabled. `unsupported` renders nothing. `info` renders message + icon + severity
frame (rich text: links open via the external-URL path of the main window handler). Font input needs the system font
list (open question 4). The page sends `properties.set` with a **single** changed property like legacy.

### 4.6 Source types captured for reference
Captured: image, color, browser, window capture, text (GDI+), audio input (`ui-reference/dialogs/`). Not captured
(no new UI is needed, they use the same property kinds): game capture, video capture device (long lists, device
dependent), media file, display capture, slideshow, Scene.

## 5. Source type catalogue and creation

### 5.1 Entries (core, `src/core/sources/catalogue.ts`; text = legacy `sources-data.ts`)
Order = legacy `allowlistedTypes`. `availability` assumes M1 (no features, logged out). Every legacy entry
(`demo` = `demoFilename`; `supports` as in `sources-data.ts`):

| id | name | group | essential | M1 availability |
| --- | --- | --- | --- | --- |
| `image_source` | Image | media | | available |
| `color_source` | Color Block | media | | available |
| `browser_source` | Browser Source | capture | | available |
| `ffmpeg_source` | Media File | media | 3 | available |
| `slideshow` | Image Slide Show | media | | available |
| `text_gdiplus` | Text (GDI+) | media | | available |
| `text_ft2_source` | Text (FreeType 2) | media | | hidden (backend/OS: hidden on Windows) |
| `monitor_capture` | Display Capture | capture | | available |
| `window_capture` | Window Capture | capture | | available |
| `game_capture` | Game Capture | capture | 1 | available |
| `dshow_input` | Video Capture | av | 2 | available |
| `wasapi_input_capture` | Audio Input Capture | av | | available |
| `wasapi_output_capture` | Audio Output Capture | av | | available |
| `decklink-input` | Blackmagic Device | av | | by backend (hidden when OBS lacks it) |
| `ndi_source` | NDI source | capture | | by backend |
| `openvr_capture` | OpenVR Capture | capture | | by backend |
| `screen_capture` | Screen Capture | capture | | available; **properties window is feature-like** (ScreenCaptureProperties 690x800, out of M1: opens the generic Source Properties) |
| `liv_capture` | LIV Client Capture | capture | | by backend |
| `ovrstream_dc_source` | OvrStream | capture | | by backend |
| `vlc_source` | VLC Source | media | | by backend |
| `soundtrack_source` | Twitch Soundtrack | media | | by backend |
| `wasapi_process_output_capture` | Application Audio | av | | by backend (add it to `KnownSourceType`; legacy list has it, the M1 union misses it) |
| `spout_capture` | Spout2 capture | capture | | by backend |
| `scene` | Scene | media | | hidden while there is <= 1 scene (`reason:'scenes'`) |
| `mediasoupconnector` | Collab Cam | av | | hidden, `feature:guest-cam` (login + rollout) |
| `smart_browser_source` | Reactive Source | capture | | hidden, `feature:vision` (special create path, manager `smartBrowserSource`) |
| `replay` | Instant Replay | media | | hidden, `feature:replay` (`ffmpeg_source` + manager `replay`) |
| `icon_library` | Custom Icon | media | | hidden (designer mode feature) |
| `streamlabel` | Stream Label | widget (essential) | | hidden, `feature:streamlabels` (login) |
| `widget:*` (Alert Box, Chat Box, Game Pulse, Event List, Viewer Count, goals, flair ...) | per `widgets.ts` | widget | Alert Box, Chat Box, Game Pulse, Stream Label | hidden, `feature:widgets` (login) |
| `app:<id>:<src>` | from the platform app manifest | app | | hidden, `feature:platform-apps` |
Backend availability = type is in `backend.sources.types()` (legacy `InputFactory.types()`, add it to `MediaBackend`) and
in the OS list `WINDOWS_SOURCE_TYPES` (already in `collections/format.ts`). `tiles` of unavailable types are not
shown. The **Widgets tab** is shown with the logged-out empty state (sleeping Kevin image `images/sleeping-kevin-<night|day>.png`,
"You must be logged in to use Widgets"); the login button is hidden until a `user` feature exists (open question 2).
Features register entries later through their `api.ts` (`owner:'feature:<id>'`); the catalogue builder merges
them and applies their own availability.

### 5.2 Showcase behavior (B)
Tabs All Sources / Media Categories / Widgets (/ Apps when entries exist), search (Fuse over `id, name, shortDescription,
description`, threshold .3; `fuse.js` is a legacy dependency, or a 20-line own matcher: both fine), sections per 1.2
(Essentials repeated in groups), collapse state in memory only, side panel with `demo` (image; `<video autoplay loop>`
for `video` demos, **only while the window is visible/focused**), double click = continue. "Add Source" ->
`dialogs.open({kind:'add-source', params:{catalogueId}, title:'Add Source'})`, replacing the showcase.

### 5.3 Naming defaults (core)
`suggestedName = suggestName(<legacy English description>)`: image "Image", color "Color Block", browser "Browser
Source", media "Media File", slideshow "Image Slide Show", text "Text (GDI+)", display "Display Capture", window "Window
Capture", game "Game Capture", dshow "Video Capture Device", wasapi in/out "Audio Input Capture"/"Audio Output
Capture", ... (the list in `getAvailableSourcesTypesList`, untranslated). Unique among all source **and scene** names
(`SourcesService.views.suggestName`), pattern `name`, `name (1)`. Scene dialog: new "New Scene", duplicate =
`suggestName(scene name)`, rename = current name. (The comment of `SourcesContract.suggestName` says `name 2`: wrong,
the implementation in `collections/format.ts` is right.) Validation: non-empty only (no uniqueness check, legacy).

### 5.4 Creation flow (`dialogs.submitAddSource`)
1. `existing`: `sceneItems.add(sceneId, sourceId, {select:true})`; `ECYCLE` if the source is a scene that contains the
   target scene (legacy `canAddSource`; the dialog shows the legacy message inline: "Unable to add a source: the scene
   you are trying to add already contains your current scene").
2. `new`: empty name -> `ENAME`; `sceneItems.addNew(sceneId, spec, {select:true})` with `spec = {type, name,
   propertiesManager:'default', settings: defaultsFor(type, name)}` using the list of 1.2 (shutdown/url, text/version,
   dshow device, game/screen auto capture settings, `is_media_flag` false). The new source's id is `<type>_<uuid>`.
3. Next step: `configurable` -> replace with `source-properties`; else close. **Deviation to confirm**: legacy opens
   Advanced Audio Settings for audio-only sources (not an M1 dialog); until it exists, open `source-properties`
   (open question 5).
4. Undo (later): one history entry "Create <name>" (remove item and source).

### 5.5 Source Properties dialog data
`chrome = 'close'` for `color_source, browser_source, ffmpeg_source, game_capture, dshow_input, openvr_capture`
(manager default), else `'cancel-done'` (1.3). `typeName` = display name of the type (title). The dialog subscribes
`dialog:<id>` (for header data) and `properties:<id>`; the preview display uses `sourceId`.

## 6. Done / Cancel semantics (exactly legacy)
| Dialog | Footer | Behavior |
| --- | --- | --- |
| Source Showcase | Close, Add Source | Close = close; Add Source / double click = replace by `add-source` |
| Add Source | Cancel, Add Source (Enter submits) | Cancel = close; nothing was created before Add Source |
| Source Properties (`close` chrome) | Close | closes; all edits already applied |
| Source Properties (`cancel-done`) | Cancel, Done | both just close; **Cancel does not revert** |
| Name Scene / Rename Source / Name Folder | Close, Done (Enter submits) | Done validates (non-empty) -> command -> close; create also makes the new scene active (`scenes.create({makeActive:true})`); Close = close |
The properties window also closes when its source is removed or the collection changes.

## 7. Performance
- No timers or polling in dialogs: properties refresh only after a change, a button press or an explicit `refresh`
  (focus regained, optional); no `requestAnimationFrame` loops.
- Dialog window on demand, destroyed on close, nothing warm; thin entries (no router, no main-window stores): bundle
  per dialog should stay <= 300 KB gzip excluding the shared UI chunk. Measure with `scripts/bench/dialog-latency.mjs`
  (adapt the entry): budget is the ADR-0003 result (Add Source painted ~115 ms warm baseline); report cold on-demand
  numbers in the journal.
- First paint without a round trip: URL `?dialog=<id>` + `sub` as first message; the snapshot carries the catalogue /
  names (no `await core.*` before render).
- Property reads are the cost center (one OSN IPC per property field): read once on open and once per applied
  change; coalesce changes; no read while the window is hidden/minimized; large lists (dshow devices) are plain data in
  the slice, and the slice is dropped when the dialog closes. Instrument `properties.set` duration (`[perf]` mark) and
  report the worst case (video capture with many devices).
- Preview displays exist only while the dialog is open and visible; the Add Source showcase has no display; videos
  in the side panel only play while visible/focused.
- Catalogue and `DialogState` are built on demand, not kept in memory.

## 8. Work split
**A (core + main)**: `src/core/dialogs/{service,specs}.ts`, `src/core/sources/catalogue.ts`,
`src/core/properties/{service,convert}.ts`; backend `getProperties/pressButton/types()` + OSN adapter + fake;
`defaultsFor(type, name)` fixing `sources/service.ts`; `submitAddSource`; window->dialog registry and `window-closed`
message (`src/shared/protocol.ts`); main: `src/main/dialog-window.ts`, replace the `ENOTIMPL` stubs in
`src/main/main-rpc.ts`, `window-url.ts` query support; `vite.windows.config.ts` window list; tests: convert (all kinds),
catalogue availability, `properties.set` diff/patch with the fake backend, dialogs lifecycle with a fake `callMain`.
**B (UI)**: `src/windows/dialog-<kind>/{index.html,main.ts,App.vue}` for the six kinds, `src/ui/dialog/*`
(`DialogLayout` = legacy ModalLayout, `DialogTitleBar`, `useDialog()` composable: reads `?dialog`, subscribes
`dialog:<id>`, `close()`), `src/ui/properties/*` (PropertyForm and one input per kind), `SourceShowcase`, replace
`NameDialog.vue` use in the main window by `dialogs.open` (scene create/duplicate/rename, source rename). Develop
against the fake runtime (`CoreContract` mock) until A lands. Screenshot diff against `ui-reference/dialogs/`.

## 9. Open questions
1. **Modality/parent** (3.4): legacy dialogs are unparented and non-modal (the main window can cover them). Keep exact
   parity (default here), or give the dialog `parent: main` so it always stays on top and minimizes with it?
2. **Widgets tab and login** in M1: no user/login yet. Proposed: tab visible with the logged-out empty state and **no**
   login button until the `user` feature exists. Also confirm hiding (not greying) Reactive Source, Instant Replay,
   Collab Cam, Stream Label, which legacy shows (SPEC 5 says features are optional).
3. **`modified` semantics**: the design relies on "reading `source.properties` re-applies settings so `modified`
   callbacks run" (libobs). A 10-line probe against a throw-away OBS (browser source: toggle "Use custom frame rate",
   window capture: "Capture Method") should confirm before A builds the diff logic; if false, `getProperties` must call
   `property.modified()` for the changed names.
4. **System font list** for the Text font input: legacy uses the native module `font-manager` in the renderer. In reborn
   it must run in core (`utilityProcess`, lazy `require`, only when a font property is shown): is it among the
   allowed prebuilt modules (it is in the legacy `package.json`; it is not yet in `scripts/install-native-deps.js`)?
   Alternative: main `webContents` `queryLocalFonts()`-like API without a native module (family/style list
   only; style flags would need a table).
5. **Advanced Audio Settings after adding an audio-only source**: legacy opens it (mixer-wide dialog with the source
   properties inside). Not an M1 dialog. Proposed: open Source Properties for now.
6. **Properties undo**: legacy combines edits into undo steps; undo is not in M1. Confirm the hook is deferred.
7. **Refresh button** in the dialog title bar (legacy reloads the page): keep for parity or drop (it has no use for a
   page that reads live state)?
8. **Where does the "Unable to add a source: the scene ... already contains your current scene" error show**: legacy
   uses a native error box; proposed: inline error text in the Add Source dialog.
9. **Closing on collection switch**: legacy does not close the child window on collection switch (the properties window
   would show a stale source). Proposed: close all dialogs; confirm.
10. `slbundle://` query strings and the hotfix manifest: dialog entries must be listed in the bundle manifest like
    `main`; verify the protocol handler strips `?dialog=` when resolving files (A).
