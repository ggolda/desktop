# Framework / state / CSS micro-benchmark

Part of the Streamlabs Desktop rework (docs/rework/chapter2). Goal: measure what a **window** costs
in each UI framework, in the target setup (sandboxed renderer, data from a core process over a
MessagePort), with performance first.

## Layout
- `shared/` — `data.js` (deterministic snapshot + settings schema), `client.js` (`connectCore()`),
  `icons.js` (SVG paths), `styles.js` (Tailwind-style reset + UnoCSS utilities). **Do not modify.**
- `electron/` — benchmark shell: `main.cjs` (window + mock core in a `utilityProcess`), `preload.cjs`,
  `core-mock.cjs` (meters 10/s, stats 1/s, `busy` adds 20 source edits/s). **Do not modify.**
- `src/<fw>/` — one implementation per framework: `editor.html`, `settings.html`, `rename.html` + code.
- `vite.config.<fw>.js` — `export default makeConfig('<fw>', [frameworkPlugin()])` (see `vite.base.js`).
- `bench.mjs` — runner (`node bench.mjs --fw a,b --runs 3`); `shot.mjs` — screenshot
  (`node shot.mjs <fw> <page>` → `results/shots/<fw>-<page>.png`).
- Build: `npx vite build --config vite.config.<fw>.js` → `dist/<fw>/`.

## The spec: `src/vanilla/` is the reference
Every port must render **the same DOM structure with the same class strings** as the plain-DOM
reference (`src/vanilla/editor.js`, `settings.js`, `rename.js`), react to the same messages, and
look identical (compare screenshots with `results/shots/vanilla-*.png`).

Each page entry:
1. `import '../../shared/styles.js'` (CSS), `connectCore` from `../../shared/client.js`,
   `ICONS` from `../../shared/icons.js`.
2. `const core = await connectCore();` → initial state in `core.snapshot`.
3. Mount the app into `#app` with that state; subscribe `core.on('meters' | 'stats' | 'sourceUpdate', …)`.
4. Call `core.painted()` once, **after the initial render has been committed to the DOM**.

### editor
Top bar (title + 3 buttons) · Scenes list (30, click = active, active row gets
`bg-blue-600/30 text-white`) · Preview placeholder · Sources list (60 rows: SVG icon by type, name,
`on/off` visibility button, `locked/free` button; buttons toggle locally) · Mixer (4 rows: name,
`-6.0 dB`, two meter bars whose fill width = `peak * 100%`, Mute/Unmute button) · Footer stats
(`CPU x%`, `FPS x`, `Dropped x`, `hh:mm:ss`).
Messages: `meters` = `[{id, peaks:[l, r]}]` (10/s) → bar widths; `stats` = `{cpu, fps, dropped,
elapsed}` (1/s); `sourceUpdate` = `{id, patch: {name? | visible? | locked?}}` (20/s in `busy`).

### settings
Left nav with 8 categories (click switches, active gets `bg-neutral-800`), form rendered from
`core.snapshot.settings[active].fields` (150 fields in the first category): `label` (column) with
label text, control (`text`/`number` input, `select` with 10 options, `checkbox`, `slider` = range
0–200) and description. Controls are two-way bound to state.

### rename
Card with title "Rename Source", text input bound to state (initial value
`core.snapshot.sources[3].name`), Cancel / Done buttons.

## Fairness rules
- Use the framework **idiomatically and in its fastest recommended style**: keyed lists, fine-grained
  state where the framework offers it, memoization where idiomatic (e.g. `React.memo` rows),
  production build.
- **All updates must flow through the framework's state/reactivity** — no manual DOM writes in
  message handlers (that would just measure the vanilla path again).
- No extra libraries beyond the framework and its official state primitive
  (Svelte runes, Solid signals/stores, Vue `reactive`/`ref`, Preact `@preact/signals`, React hooks).
- Don't modify `shared/`, `electron/`, `vite.base.js`, `uno.config.js`, `bench.mjs`, `package.json`.
