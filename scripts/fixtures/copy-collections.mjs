/* global process, console */
// Copies ONLY the scene collection files of a developer fixture into a throw-away userData directory.
//
//   node scripts/fixtures/copy-collections.mjs <fixture> <destDir>
//
// Fixtures (`.bench/fixtures/<name>/slobs-client/`) are copies of real profiles and contain auth tokens
// (service.json, Local Storage, Network, Preferences, realm files, appState, userId, ...). Therefore:
//   - allowlist, not denylist: only `SceneCollections/manifest.json` and `<id>.json[.bak|.absolute.bak]`;
//   - `destDir` must be inside os.tmpdir() (it is created if missing, files land in `<destDir>/SceneCollections`);
//   - symlinks are refused, nothing is ever read into the output, file contents are never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWED = /^(manifest|[A-Za-z0-9_-]+)\.json(\.bak|\.absolute\.bak)?$/;
const FIXTURE = /^[A-Za-z0-9_-]+$/;

function insideTmp(dir) {
  const tmp = fs.realpathSync(os.tmpdir());
  const target = path.resolve(dir);
  const rel = path.relative(tmp, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Lists the fixture names under `.bench/fixtures`. */
export function listFixtures() {
  const dir = path.join(root, '.bench', 'fixtures');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && FIXTURE.test(e.name))
    .filter(e => fs.existsSync(path.join(dir, e.name, 'slobs-client', 'SceneCollections')))
    .map(e => e.name);
}

/** @returns {{copied: string[], skipped: number}} names of the copied files (never contents) */
export function copyCollections(fixture, destDir) {
  if (!FIXTURE.test(fixture)) throw new Error('bad fixture name');
  if (!insideTmp(destDir)) throw new Error('destDir must be inside the OS temp directory');
  const src = path.join(root, '.bench', 'fixtures', fixture, 'slobs-client', 'SceneCollections');
  if (!fs.existsSync(src)) throw new Error(`fixture has no SceneCollections: ${fixture}`);
  const dest = path.join(path.resolve(destDir), 'SceneCollections');
  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  let skipped = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !ALLOWED.test(entry.name)) {
      skipped++;
      continue;
    }
    fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
    copied.push(entry.name);
  }
  return { copied, skipped };
}

/** A fresh directory under os.tmpdir() to use as userData. */
export function makeTempUserData(prefix = 'slobs-fixture-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [fixture, destDir, ...rest] = process.argv.slice(2);
  if (!fixture || !destDir || rest.length) {
    console.error('usage: node scripts/fixtures/copy-collections.mjs <fixture> <destDir>');
    console.error(
      'only SceneCollections/** is copied; destDir must be inside the OS temp directory',
    );
    process.exit(2);
  }
  try {
    const { copied, skipped } = copyCollections(fixture, destDir);
    console.log(`copied ${copied.length} collection file(s) (${skipped} other entries skipped)`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
