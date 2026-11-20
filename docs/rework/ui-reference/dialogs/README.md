# Legacy dialog UI reference (M1 dialogs)

Screenshots of the LEGACY Streamlabs Desktop 1.22.4 child-window dialogs (commit `b995c47ff`), for SPEC R10 /
§6.1. Same capture conditions as `../editor/README.md` (`typical` fixture, logged out, throw-away
`SLOBS_CACHE_DIR` profile, night theme, DPR 1, main window 1280x800). Dialog windows have a fixed size, so only
one size is captured. Main-window screens: `../editor/`.

Capture is `PrintWindow` of the dialog's own top-level window (the PNG includes the invisible 8 px resize border
that frameless Windows windows have: 916x708 PNG = 900x700 window; the three 616x328 PNGs of the Add Source
naming step are cropped by that border at the top, the title bar is the same as in the others).
The preview area at the top of Source Properties is the native OBS display (black = source has no content, e.g.
an empty Image or Window Capture).

## Files

| File | Window (legacy component, size) | Shows |
| --- | --- | --- |
| `add-source-all.png` | `SourceShowcase`, 900x700, title "Add Source" | All Sources tab: Essentials, Capture Sources, Video and Audio; side panel of the selected tile (Media File) |
| `add-source-media-categories.png` | same | "Media Categories" tab (no Essentials) |
| `add-source-widgets-logged-out.png` | same | Widgets tab, logged out: "You must be logged in to use Widgets" + login button |
| `add-source-selected-window-capture.png` | same | Selected tile "Window Capture" (highlight + side panel) |
| `add-source-existing-image.png` | `AddSource`, 600x320 | "Add Existing Source" list + 200x200 preview display + "Add a new source instead" switch (an Image source exists) |
| `add-source-existing-window-capture.png`, `add-source-existing-audio-input.png` | same | The same step for Window Capture and Audio Input Capture (existing source of that type) |
| `add-source-name-image.png`, `-color`, `-browser`, `-window-capture`, `-text-gdi`, `-audio-input` | same | "Add New Source": "Please enter the name of the source" with the suggested name (Image, Color Block, Browser Source, Window Capture, Text (GDI+), Audio Input Capture (1)) |
| `properties-image.png` | `SourcePropertiesDeprecated` (Vue), 600x800 | Image: Image File + Browse, Unload image when not showing, Apply alpha in linear space. Footer Cancel / Done |
| `properties-window-capture.png` | `SourcePropertiesDeprecated` | Window (list), Capture Method, Window Match Priority, Capture Audio (BETA), Capture Cursor, Multi-adapter Compatibility. Cancel / Done |
| `properties-text-gdi.png` | `SourcePropertiesDeprecated` | Text (GDI+): Use Google Font, Font Family/Style/Size (slider + number), Read from file, Text (textarea), Antialiasing, Text Transform, Vertical, Color (hex + picker), Opacity slider... Cancel / Done |
| `properties-audio-input.png` | `SourcePropertiesDeprecated`, title "Settings for Audio Input Capture" | Device list, Use Device Timestamps. Cancel / Done. Opened from the mixer menu; Add Source opens Advanced Audio Settings instead |
| `advanced-audio-after-add-audio-input.png` | Advanced Audio Settings (not in M1 dialogs) | What legacy opens after adding an audio-only source (Source Settings tab with the new source expanded) |
| `properties-color.png` | `SourceProperties` (React), 600x800 | Color Block: horizontal labels, Color (swatch + hex + eyedropper), Width, Height. Footer: single "Close" |
| `properties-browser.png` | `SourceProperties` (React) | Browser Source: Local file, URL, Width, Height, Control audio, Use custom frame rate, Custom CSS (textarea), Shutdown source when not visible, Refresh browser when scene becomes active, "Refresh cache of current page" button. Single "Close" |
| `name-scene.png` | `NameScene`, 400x250, title "Name Scene" | "Please enter the name of the scene" (required `*`), Close / Done |
| `rename-scene.png` | `NameScene` with `rename`, title "Rename Scene" | Same form, prefilled with the scene name |
| `rename-source.png` | `RenameSource`, 400x250, title "Rename Source" | "Please enter the name of the source", Close / Done |

The older `../editor/dialog-add-scene-1280x800-1.png`, `dialog-add-source-1280x800-1.png` and
`dialog-mixer-advanced-settings-1280x800-1.png` show the same windows with the title bar uncropped.

## Legacy sources used

`legacy/app/components-react/windows/source-showcase/*`, `AddSource.tsx`, `NameScene.tsx`, `RenameSource.tsx`,
`SourceProperties.tsx`, `components/windows/SourceProperties.vue(.ts)`, `components/ModalLayout.vue`,
`components-react/shared/ModalLayout.tsx`, `components/windows/ChildWindow.tsx`,
`components-react/obs/ObsForm.tsx`, `components/obs/inputs/*`; styles in `SourceShowcase.m.less`,
`SourceGrid.m.less`, `AddSource.m.less`, `ModalLayout.m.less`.

## Reproduce

Same prerequisites as `../editor/README.md` (legacy worktree `..\legacy-ref`, playwright-core in `%TEMP%\pw`).

```
node scripts/ui-reference/capture-legacy-dialogs.mjs          # launch + capture everything (~4 min)
node scripts/ui-reference/capture-legacy-dialogs.mjs --no-launch --only color   # one source type
powershell -File scripts/ui-reference/stop-legacy.ps1         # graceful close + cleanup
```

Driven only through CDP (mouse events dispatched inside the pages, `Runtime.evaluate`) and `PrintWindow`;
never the real mouse or keyboard. The Rename Scene/Rename Source windows and the audio-source properties are opened
through the legacy `window.servicesManager` of the main page because their normal entry is a native context menu
(which would need real input). Source types that are not captured are listed in the design doc (section 4.6).
