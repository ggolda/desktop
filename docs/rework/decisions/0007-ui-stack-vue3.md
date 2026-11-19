# ADR-0007: UI stack = Vue 3 (company stack, aligned with the Highlighter app)

- Status: accepted (owner, 2026-11-18)
- Context: chapter 2 framework micro-benchmark ([../chapter2/framework-bench-results.md](../chapter2/framework-bench-results.md)).
  All candidates were within about 2–7 MB per window of plain DOM, with identical cold open and
  negligible CPU differences. The framework isn't a performance lever, so the choice follows the
  company stack.

## Decision
New UI is **Vue 3** (Composition API, `<script setup>`, TypeScript). Tooling and packages are aligned
with the Streamlabs Highlighter app (`job/highlighter`):

- **Build**: Vite + `@vitejs/plugin-vue`, `vite-tsconfig-paths`, `unplugin-auto-import`
  (vue, vue-router, @vueuse/core, pinia), `unplugin-vue-components`, `vue-tsc`.
- **UI**: `shadcn-vue` (new-york style, neutral, CSS variables) on `reka-ui`; icons `@lucide/vue`;
  toasts `vue-sonner`; `class-variance-authority` + `clsx` + `tailwind-merge`.
- **CSS**: UnoCSS with `preset-wind3`, `unocss-preset-shadcn`, `unocss-preset-animations`, typography,
  `transformer-directives`, and `@unocss/reset`. Brand tokens come from the Highlighter theme.
- **State in a window**: Pinia stores and `@vueuse/core`. Router: `vue-router` (main window only).
- **Lint/format**: ESLint 9 flat config, `eslint-plugin-vue`, Prettier with the tailwind plugin.
  **Tests**: Playwright (Electron).
- **Package manager**: npm.

## Deliberate differences from Highlighter
- **Windows are sandboxed** (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no
  `@electron/remote`). Windows talk to the core process only through the preload bridge and
  MessagePorts. Highlighter's `nodeIntegration: true` model is not adopted: it's a security risk and
  it forces Node into every renderer.
- **Pinia is a window-local view of core state**: stores are fed by slice subscriptions from the core
  process. They are not the source of truth and are not persisted from the renderer (no
  electron-store in windows).
- **Vue Vapor mode** (3.6) may be used per component for hot paths (source list, mixer) once stable.
- **Animations**: `unocss-preset-animations` is only for transient enter/leave transitions. Never use
  `infinite` animations on persistent UI (performance rules in CLAUDE.md).
- **Packaging stays electron-builder plus the existing updaters** (not Forge, Squirrel or
  update-electron-app), as the distribution requirements demand.
