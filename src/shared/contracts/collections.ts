import type { Contract } from './types';

// M1 contract: scene collections (list + switching). The file format itself is internal to core
// (src/core/collections) and byte-compatible with the legacy app. See docs/rework/chapter2/m1-design.md.

export interface CollectionEntry {
  id: string;
  name: string;
  /** ISO string, as in the manifest. */
  modified: string;
  operatingSystem: 'win32' | 'darwin';
  needsRename: boolean;
  /** Present when the collection was synced to the cloud (M5 feature, preserved here). */
  serverId?: number;
}

export type CollectionWarning =
  /** Sources of a type this build does not support; kept in the file, not shown. */
  | { code: 'unavailable-sources'; count: number; types: string[] }
  /** The backend could not create these sources; kept in the file, not shown. */
  | { code: 'sources-failed'; count: number; types: string[] }
  /** Legacy coordinate migration could not complete; this collection is not saved this session. */
  | { code: 'migration-blocked'; reason: string }
  /** The primary file did not load; the `.bak` copy was used. */
  | { code: 'restored-from-backup' }
  /** Neither file loaded; an empty collection was created and the broken files were left alone. */
  | { code: 'load-failed'; collectionId: string };

export interface CollectionsState {
  /**
   * `loading` covers both phases of a load. `ready` = lists are final and OBS objects exist.
   * Slices for scenes/sources/items are already filled while `loading` (document phase).
   */
  status: 'idle' | 'loading' | 'ready' | 'error';
  activeId: string | null;
  /** Manifest order, deleted entries excluded. */
  collections: CollectionEntry[];
  warnings: CollectionWarning[];
}

export interface CollectionsContract extends Contract {
  slices: { collections: CollectionsState };
  commands: {
    collections: {
      /** Saves the current collection, then switches. Rejects with code ELOADING while loading. */
      load(id: string): void;
      create(opts?: { name?: string }): CollectionEntry;
      duplicate(id: string, name?: string): string;
      rename(id: string, name: string): void;
      /** Soft delete (`deleted: true` in the manifest); files stay on disk, as in the legacy app. */
      remove(id: string): void;
      /** Flushes pending changes to disk now. */
      save(): void;
    };
  };
  events: {
    'collection.willSwitch': { fromId: string | null; toId: string };
    'collection.loaded': { id: string };
  };
}
