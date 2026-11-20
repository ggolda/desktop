// Parse and serialize collection files. The legacy app writes `JSON.stringify(x, null, 2)` (LF, no
// trailing newline), so serialize(parse(text)) === text as long as key order is kept (C2).
import type { Json, Manifest } from './format';

export class CodecError extends Error {
  readonly code = 'ECODEC';
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Parses and sanity-checks a collection file. Throws CodecError when it cannot be a collection. */
export function parseCollection(text: string): Json {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new CodecError(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new CodecError('collection is not an object');
  }
  const r = root as Json;
  if (r.sources !== undefined && !Array.isArray(r.sources?.items)) {
    throw new CodecError('sources.items is not an array');
  }
  if (r.scenes !== undefined && !Array.isArray(r.scenes?.items)) {
    throw new CodecError('scenes.items is not an array');
  }
  return r;
}

/**
 * Parses the manifest and repairs what the legacy app repairs (state.ts checkAndRecoverManifest):
 * entries without id are dropped, missing `deleted`/`modified` are filled.
 */
export function parseManifest(text: string): Manifest {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new CodecError(`invalid manifest JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const m = obj as Manifest | null;
  if (!m || typeof m !== 'object' || !Array.isArray(m.collections)) {
    throw new CodecError('manifest has no collections array');
  }
  m.collections = m.collections.filter(c => {
    if (!c || typeof c !== 'object' || c.id == null) return false;
    if (c.deleted == null) c.deleted = false;
    if (c.modified == null) c.modified = new Date().toISOString();
    return true;
  });
  if (m.activeId === undefined) m.activeId = null;
  return m;
}
