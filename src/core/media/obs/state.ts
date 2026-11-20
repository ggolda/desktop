// Native objects live here as Map<id, native>; ids are the only handles outside this folder.
import type { BackendEvents, ItemRef } from '../backend';
import type {
  Osn,
  OsnFader,
  OsnInput,
  OsnScene,
  OsnSceneItem,
  OsnTransition,
  OsnVideo,
  OsnVolmeter,
} from './types';

export interface SceneState {
  scene: OsnScene;
  items: Map<ItemRef, OsnSceneItem>;
  /** Item refs top-first, tracked locally so reordering never needs a read-back. */
  order: ItemRef[];
  selected: Set<ItemRef>;
}

export interface ObsState {
  osn: Osn;
  inputs: Map<string, OsnInput>;
  scenes: Map<string, SceneState>;
  transitions: Map<string, OsnTransition>;
  faders: Map<string, OsnFader>;
  volmeters: Map<string, OsnVolmeter>;
  video: { horizontal: OsnVideo | null };
  program: { sceneId: string | null };
  emit<K extends keyof BackendEvents>(e: K, p: BackendEvents[K]): void;
}

export function missing(kind: string, id: string | number): Error {
  return Object.assign(new Error(`backend: unknown ${kind} ${id}`), { code: 'ENOENT' });
}
