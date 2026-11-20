import type { AppContract } from './app';
import type { AudioContract } from './audio';
import type { CollectionsContract } from './collections';
import type { DialogsContract } from './dialogs';
import type { DisplayContract } from './display';
import type { EditorContract } from './editor';
import type { PropertiesContract } from './properties';
import type { ScenesContract } from './scenes';
import type { SourceTypesContract } from './source-types';
import type { SourcesContract } from './sources';
import type { Contract } from './types';

/**
 * The whole core surface as seen by windows and by the core runtime: one `Contract` made of the
 * per-domain contracts. `createRuntime<CoreContract>()` and `createClient<CoreContract>()` use it.
 */
export interface CoreContract extends Contract {
  slices: AppContract['slices'] &
    CollectionsContract['slices'] &
    ScenesContract['slices'] &
    SourcesContract['slices'] &
    AudioContract['slices'] &
    DisplayContract['slices'] &
    EditorContract['slices'] &
    DialogsContract['slices'] &
    PropertiesContract['slices'] &
    SourceTypesContract['slices'];
  commands: AppContract['commands'] &
    CollectionsContract['commands'] &
    ScenesContract['commands'] &
    SourcesContract['commands'] &
    AudioContract['commands'] &
    DisplayContract['commands'] &
    EditorContract['commands'] &
    DialogsContract['commands'] &
    PropertiesContract['commands'] &
    SourceTypesContract['commands'];
  events: AppContract['events'] &
    CollectionsContract['events'] &
    ScenesContract['events'] &
    SourcesContract['events'] &
    AudioContract['events'] &
    DisplayContract['events'] &
    EditorContract['events'] &
    DialogsContract['events'] &
    PropertiesContract['events'] &
    SourceTypesContract['events'];
}

export type { AppContract, AppItem, AppState, CoreStats } from './app';
export type * from './audio';
export type * from './collections';
export type * from './dialogs';
export type * from './display';
export type * from './editor';
export type * from './main-rpc';
export type * from './properties';
export type * from './scenes';
export type * from './source-types';
export type * from './sources';
export type * from './types';
