import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCollection, parseManifest, serializeJson } from '@/core/collections/codec';
import { CollectionDocument } from '@/core/collections/document';
import { buildV2, buildV5, manifestOf, toText } from '../fixtures/synthetic';

// Real collections of the developer's machine (git-ignored, they contain tokens). Skipped when absent.
// Nothing here prints file contents or values: a failure names the file by its position only.
const fixturesRoot = path.resolve(__dirname, '../../.bench/fixtures');
function fixtureFiles(): string[] {
  if (!fs.existsSync(fixturesRoot)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(fixturesRoot)) {
    const dir = path.join(fixturesRoot, name, 'slobs-client', 'SceneCollections');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.json(\.bak|\.absolute\.bak)?$/.test(f)) out.push(path.join(dir, f));
    }
  }
  return out;
}
const files = fixtureFiles();

describe('codec identity (C2)', () => {
  it.each([
    ['v5', toText(buildV5())],
    ['v2', toText(buildV2())],
  ])('synthetic %s: parse -> serialize is byte-exact', (_n, text) => {
    expect(serializeJson(parseCollection(text))).toBe(text);
    // the document model does not touch it either
    const doc = CollectionDocument.parse(text);
    expect(doc.isDirty()).toBe(false);
    expect(doc.serialize()).toBe(text);
  });

  it('manifest is byte-exact', () => {
    const text = toText(manifestOf([{ id: 'a' }, { id: 'b' }], 'a'));
    expect(serializeJson(parseManifest(text))).toBe(text);
  });

  it.skipIf(files.length === 0)(`every fixture file (${files.length}) round-trips`, () => {
    const bad: number[] = [];
    files.forEach((file, i) => {
      const text = fs.readFileSync(file, 'utf8');
      const isManifest = path.basename(file) === 'manifest.json';
      const out = isManifest
        ? serializeJson(parseManifest(text))
        : serializeJson(parseCollection(text));
      if (out !== text) bad.push(i);
      if (!isManifest) {
        const doc = CollectionDocument.parse(text);
        if (doc.serialize() !== text) bad.push(1000 + i);
      }
    });
    expect(bad).toEqual([]);
  });
});
