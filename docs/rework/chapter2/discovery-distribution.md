# Discovery: distribution & update constraints (chapter 2)

*Source: read-only code analysis 2026-11-18 (main.js, updater/, electron-builder/, package.json, CI files)
plus the public updater repo `streamlabs/a-files-updater`. [F] = seen in code, [X] = external updater
repo, [H] = historical release scripts (deleted 2019), [I] = inference.*

## Windows app update (the path every existing user takes)
1. `main.js` `app.on('ready')` → if production and no `--skip-update`: `updater/bootstrap.ts` **before**
   `startApp()` [F]. Channel = first prerelease tag of the app version (`latest`/`preview`/`beta`) →
   `GET https://slobs-cdn.streamlabs.com/{channel}.json` (`version`, `fallbackVersion`, `seed`,
   `rollout`, `restricted`). No downgrades ("rollbacks are not supported"). Rollout bucket from
   `userData/updateId`. [F]
2. Downloads `latest-updater.exe` (or `preview-updater.exe`) from the CDN — **not part of this repo,
   fetched fresh every update** — and runs it with `--base-url --version --exec --app-dir -p <pid>…`,
   then exits. [F]
3. The updater (C++) fetches `{version}.sha256` (one `sha256 path` line per file of the install dir),
   hashes local files, and downloads **only changed files** as `{version}/{path}.gz`; stages, backs up,
   swaps, relaunches `--exec`. Deletes files not in the manifest only in default Program Files paths. [X]
4. **Unit of update = the `win-unpacked` tree, file by file.** `app.asar` (~197 MB in the PoC build:
   main.js, html, bundles, pure-JS node_modules) is one file → any JS change re-downloads it (already
   true today). Electron binaries, OBS and unpacked native modules are skipped when unchanged. [X/I]

## macOS
electron-updater 4.6.5, generic provider `slobs-cdn.streamlabs.com`, channel `desktop-[arm64-]{channel}`;
whole `.app` swap; every binary signed + notarized (afterPack/afterSign). [F/I]

## Bundle updater (`updater/bundle-updater.ts`) — JS hotfixes between releases
- Hard-coded names `renderer.js`, `vendors~renderer.js` [F]; CDN folder **per exact version**
  `{version}[-mac]/bundles/manifest.json`; cache `%APPDATA%/slobs-client/bundles/<version>/` (wiped on
  version change); md5 `checksums` keyed by hashed file name; all-or-nothing; local → cache → download.
- Forced local: `--local-bundles`, `NODE_ENV !== 'production'`, or `<install>/force-local-bundles`.
- Served via `slbundle://` (`registerFileProtocol`, non-privileged); unknown names → not found.
- `getBundleNames` sync IPC for Sentry name normalization; `startupError` IPC wipes the cache (self-heal).
- **Full app update needed for:** main.js, `updater/build/*`, all `.html`, `bundles/guest-api.js`,
  `bundles/updater.js`, `bundles/media|fonts`, native modules, any **new bundle name**, protocol changes.

## Release pipeline
In repo: `compile:production`, `package*` (electron-builder; `files` is an explicit allow-list —
anything new outside `bundles/` must be added), CI only runs tests/bundle-size. **Release upload,
CDN manifests, Sentry upload live outside the repo** (private tooling) — must be coordinated. [F/H]

## Constraints for Vite / multiple bundles [I, derived]
1. New manifest format is fine **if the new bundle updater ships in the same app update** (CDN folders
   are per version). Content-hashed names + checksums for every file in a set, set-level atomicity.
2. Current CSP allows only `slbundle:` scripts + two inline hashes → ESM output needs a **privileged
   scheme** (`registerSchemesAsPrivileged`, `protocol.handle`) and an updated CSP; chunks/CSS must be
   served by the protocol handler.
3. Keep `bundles/updater.js`, `bundles/guest-api.js` paths (or update their loaders), keep assets
   resolvable, keep a startup self-heal path ("bad bundle → clear cache → fall back to local") for
   whatever process hosts services.
4. Sentry release id + new file names must be agreed with release tooling.
5. **The experimental worker-only bundle (chapter 1) breaks CDN hotfixes** (unhashed `worker.js`, not in
   the updater's list → UI windows would get hotfixed bundles while the worker stays old). Fine without
   hotfixes; must be fixed by the generalized updater before relying on hotfixes.

## What an existing user's update can carry [I]
Old version controls only "whether to update" and the updater exe; everything inside the install dir
is replaced per file. So a **completely new architecture reaches existing users through a normal app
update** if: same install layout & exe name (`Streamlabs OBS.exe`, `resources/app.asar`, Program Files
path, appId, NSIS entries), same release tooling output, a compatible `updater/bootstrap` contract in
the new version (so it can update itself later), same `userData` (`%APPDATA%/slobs-client`) with
**forward-only migrations**, mac signing/notarization. New pages, bundles, processes, native modules
(signed, listed in `files`) are all deliverable.

**Risks:** hidden release tooling (compile command, Sentry, CDN hotfix upload), no rollback (fix forward
only), shared updater exe behaviour, partial-hotfix version skew, startup self-heal for the new core host.
