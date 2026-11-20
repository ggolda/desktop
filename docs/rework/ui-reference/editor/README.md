# Legacy editor UI reference

Screenshots and measurements of the LEGACY Streamlabs Desktop 1.22.4 editor (commit `b995c47ff`,
"pre rework"), for SPEC R10 / §6.1 UI parity. Captured with the `typical` fixture collection
(scene "Scene": Alert Box, Image, Window Capture, Webcam), logged out, fresh throw-away profile,
Windows, night theme, onboarding skipped.

## Capture conditions

- Window size = OUTER window size in physical px (`1280x800`, `1920x1080`). The CSS viewport is
  16x8 px smaller (1264x792 / 1904x1072): the frameless window has an 8 px invisible border
  left/right and 8 px at the bottom, which are part of the PNG.
- Launched with `--force-device-scale-factor=1` (DPR 1; the dev machine is 175 %), so PNG pixels = CSS px.
- Images are `PrintWindow` captures (include the native OBS preview child). Native context menus are
  separate Chromium windows and are composited next to the window, so a few PNGs are larger than the
  window (menus extending past its edge). Menu shadow pixels are transparent/dark grey.
- The preview image is the OBS render of the fixture's sample content and its size changes with the
  window; ignore it for pixel comparison, compare the chrome.

## Files

| File | Shows |
| --- | --- |
| `editor-default-<size>.png` | Editor, default state, help tips dismissed |
| `editor-default-with-tips-<size>.png` | First-run state with the two help tips ("Login", "Scene Collections") |
| `hover-scene-row-<size>.png` | Hover on the scene row (trash icon appears) |
| `hover-source-row-<size>.png` | Hover on "Alert Box" (lock / eye / trash / cog actions appear) |
| `hover-mixer-row-<size>.png` | Hover on the Desktop Audio mixer row |
| `selected-source-row-<size>.png` | Source selected (row highlight + transform box in preview) |
| `context-menu-source-<size>.png` | Right-click on a source (native menu) |
| `context-menu-scene-<size>.png` | Right-click on a scene (Duplicate / Rename / Remove / Filters / Create Scene Projector) |
| `context-menu-mixer-panel-<size>.png` | Right-click on the mixer panel background ("Unhide All") |
| `mixer-item-cog-menu-<size>.png` | Click on a mixer row's cog (source menu incl. audio items) |
| `hover-add-scene-button-<size>.png`, `hover-add-source-button-<size>.png` | Hover on the circled "+" in the Scenes / Sources headers |
| `hover-nav-settings-1280x800.png`, `hover-nav-help-1280x800.png` | Hover on top-nav settings / help icons (native `title` tooltips are NOT captured) |
| `zoom3x-footer-1280x800.png`, `zoom3x-footer-hover-golive-1280x800.png` | Footer, 3x zoom, default / Go Live hover |
| `zoom2x-nav-1280x800.png`, `zoom2x-nav-hover-layouts-1280x800.png` | Top navigation bar, 2x zoom |
| `zoom3x-titlebar-1280x800.png` | Custom title bar, 3x zoom |
| `dialog-add-scene-1280x800-1.png` | "Name Scene" dialog (child window; the "+" button). Legacy has NO inline rename: Rename uses this same dialog |
| `dialog-add-source-1280x800-1.png` | "Add Source" dialog (child window) |
| `dialog-mixer-advanced-settings-1280x800-1.png` | Advanced Audio Settings (mixer header cog; child window) |
| `metrics.json` | Computed boxes/fonts/colors/padding per region and size, plus `hover` states |
| `icons.json` | Icon element classes (icomoon `icon-*`, Font Awesome `fa*`) per region |

Notes:
- The legacy nav is a horizontal top bar (Editor, Layouts, Overlays, App Store, Highlighter, Cloudbot, Vision,
  Ultra, then tools: Dual Output, Studio Mode, help, settings, avatar), not a side nav. At 1280 wide the
  "Dual Output" / "Studio Mode" labels are hidden (icon + toggle only); at 1920 they are shown.
- Layout editor variants and studio mode are not covered.

## Reproduce

Prereqs: worktree `C:\Users\glebg\Documents\job\rnd\legacy-ref` at `b995c47ff` (`yarn install`,
`node node_modules/electron/install.js`, `yarn compile`), and `playwright-core` installed in
`%TEMP%\pw` (`npm i playwright-core` there; override with `PW_DIR`).

```
node scripts/ui-reference/capture-legacy.mjs                  # launch + capture everything (~5 min)
node scripts/ui-reference/capture-legacy.mjs --no-launch --only-dialogs   # against an already running legacy
powershell -File scripts/ui-reference/stop-legacy.ps1         # graceful close + cleanup (obs64 can take ~25 s)
```

Manual start (to explore other screens):
```
cd ..\legacy-ref
$env:SLOBS_CACHE_DIR="$env:TEMP\legacy-ref-profile"; $env:SLD_TESTS_SKIP_ONBOARDING="true"
node_modules\electron\dist\electron.exe . --skip-update --remote-debugging-port=9222 --disable-features=CalculateNativeWinOcclusion --force-device-scale-factor=1
```
Safety: `SLOBS_CACHE_DIR` moves Electron appData so userData is `<SLOBS_CACHE_DIR>\slobs-client`;
never run legacy without it. Only the fixture's scene collections are copied
(`scripts/fixtures/copy-collections.mjs typical <profile>\slobs-client`).
Onboarding is skipped by `SLD_TESTS_SKIP_ONBOARDING=true` (read by `onboarding-v2.ts`, the flag the
legacy e2e tests use); no code changes.

Gotchas: legacy overrides `window.eval`, so `page.evaluate` fails; `scripts/ui-reference/cdp.mjs` uses raw
`Runtime.evaluate`. Native menus open at the real cursor and need the app in the foreground
(`menu.ps1` moves the cursor, focuses with an ALT tap, composites the popup windows, sends ESC only if
the foreground window belongs to legacy).
