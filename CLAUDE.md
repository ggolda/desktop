# CLAUDE.md

This is **Streamlabs Desktop "reborn"**: a clean rewrite of the Electron + OBS streaming app on the
`reborn` branch. **Read `docs/rework/README.md` first.** The specification is
`docs/rework/chapter2/SPEC.md`, and decisions are in `docs/rework/decisions/`. The old app lives in
`legacy/`. It is reference only and not built; its guide is `legacy/CLAUDE.md`.

## Performance rules: top priority
This app runs next to games and an encoder. Rationale and measurements are in
`docs/rework/performance-guidelines.md`.
- No continuous animation on persistent UI (`infinite` animations, looping spinners, pulses). If one
  is essential, drive it from JS at ≤ 10 updates/s and stop it when hidden or unfocused.
- No permanent `requestAnimationFrame` loops, and no polling of observable state. Use events,
  observers and subscriptions.
- Live data only at visible rates (meters ≤ 15 Hz, stats 1 Hz), and only while visible.
- Nothing hidden "for speed": no warm hidden windows or pages. Create on demand, destroy after.
- Measure before and after (`scripts/bench/`, `docs/rework/benchmarking.md`).

## Hard requirements (SPEC §1, ADR-0008)
- The auto-updater, distribution, install layout, exe name and userData (`%APPDATA%/slobs-client`)
  stay as today. Hotfix bundles (`updater/bundle-updater.ts`, existing manifest format) must keep
  working.
- Don't modify the OBS backend (obs64 and obs-studio-node binaries or their installation). Only our
  calls into it may change.
- **No new native modules.** Only the existing prebuilt ones (installed by
  `scripts/install-native-deps.js`). Electron 45.x.
- 100 % compatibility: External API, Platform Apps API, user data, `slobs://` links.
- **Dev runs never use the real profile.** Unpackaged builds use `slobs-client-reborn-dev`
  (override with `SLOBS_USERDATA_DIR`). Never write to `%APPDATA%\slobs-client` from dev or tests.

## UI/UX parity with legacy (SPEC R10, §6.1): hard requirement
Every screen must look and behave like the legacy app: same layout, icons (legacy `icomoon` icon
font + Font Awesome, **not** lucide), Roboto, colors, spacing, sizes and interactions. Rebuild it
with Vue 3 + UnoCSS + shadcn-vue, restyling the components to the legacy look. Start each screen
from legacy reference screenshots (`docs/rework/ui-reference/`) and the legacy component and LESS
sources (`legacy/app/components-react/`, `legacy/app/styles/`). Pixel perfection is not required;
looking like a different app is a bug.

## Automation safety
Never send real OS mouse or keyboard input (SendKeys, `mouse_event`, `keybd_event`, moving the real
cursor) when driving the app; the owner uses the machine meanwhile. Drive windows through
CDP/Playwright or app-level hooks only, and capture with PrintWindow, which needs no focus.

## Commands (npm, never yarn)
| Task | Command |
| --- | --- |
| Dev (Vite HMR for windows, watch main/preload/core, run Electron) | `npm run dev` |
| Production build | `npm run build` |
| Run last build | `npm start` |
| Typecheck (fast self-verify) | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit tests | `npm test` |
| Smoke (launches the app, checks core, OBS and window; quits) | `npm run smoke` |

`npm install` re-extracts placeholder native tarballs; `postinstall` restores the real binaries. If
you ever use `--ignore-scripts`, run `node scripts/postinstall.js` afterwards.

## Architecture in one screen (SPEC §2–§5)
- `src/main/`: the thin Electron main process. It lives in app.asar and is **not hotfixable**, so
  keep it minimal. It handles lifecycle, the updaters, windows, protocols, the MessagePort broker
  and Electron-only APIs for core.
- `src/core/`: the core `utilityProcess` (Node, no DOM). It holds all domain logic and state, the
  obs-studio-node client (only in `src/core/media/obs/`) and the External API.
- `src/preload/`: one sandboxed preload. It exposes only `connectCore()` and window controls.
- `src/windows/<name>/`: per-window Vite entries (Vue 3). Windows are sandboxed; no Node, no
  `@electron/remote`.
- `src/ui/`: shared Vue components (shadcn-vue in `src/ui/components/ui/`), theme, core client and
  composables.
- `src/shared/`: contracts (types) and utilities usable everywhere (no Node, no DOM).
- `src/features/<name>/`: optional features. `service.ts` runs in core (lazy), `ui/` holds Vue
  (lazy), and `api.ts` is the public surface. Features are wired in **only** via
  `src/features/registry.ts`.

Import boundaries are enforced by ESLint:
- core never imports windows, ui, `.vue` files or features (except the registry);
- windows and ui never import core or main;
- features import only core's public API, shared, ui and other features' `api.ts`.

**State:** core is the source of truth. Windows subscribe to slices (snapshot plus patches) and
call commands. Pinia stores in windows wrap `useSlice()` plus local UI state, and never persist
anything themselves.

## Code style
TypeScript and Vue 3 `<script setup>`, formatted by Prettier (single quotes, width 100). UnoCSS
(Tailwind wind3 preset) with shadcn-vue. Match the surrounding code, and keep the theme in CSS
variables (`src/ui/theme.css`, values from the legacy night theme).

## Working method
Coding is done by Sonnet subagents with narrow briefs. The main session writes the briefs and
verifies the result (typecheck, lint, tests, smoke, review) before accepting it.
