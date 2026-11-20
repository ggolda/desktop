// File format of scene collections: byte-compatible with the legacy app (m1-design 1 and 3).
// Numeric values live here; the domain uses strings (contracts/scenes.ts).
import type { BlendingMethod, BlendingMode, ScaleFilter } from '../../shared/contracts';

/** A parsed JSON node. Unknown keys must survive, so nodes stay loosely typed on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

/** Schema versions the legacy app writes today. */
export const CURRENT = {
  root: 5,
  sources: 5,
  scenes: 1,
  sceneItems: 1,
  sceneFilters: 1,
  transitions: 2,
  hotkeys: 2,
  guestCam: 1,
} as const;

export const SCALE_FILTERS: ScaleFilter[] = [
  'disable',
  'point',
  'bicubic',
  'bilinear',
  'lanczos',
  'area',
];
export const BLENDING_MODES: BlendingMode[] = [
  'normal',
  'additive',
  'subtract',
  'screen',
  'multiply',
  'lighten',
  'darken',
];
export const BLENDING_METHODS: BlendingMethod[] = ['default', 'srgb-off'];
export const MONITORING_TYPES = ['none', 'monitor-only', 'monitor-and-output'] as const;

/** Key order of nodes as the legacy app writes them (nodes/sources.ts, scenes.ts, scene-items.ts). */
export const SOURCE_KEYS = [
  'hotkeys',
  'id',
  'name',
  'type',
  'settings',
  'volume',
  'channel',
  'muted',
  'deinterlaceMode',
  'deinterlaceFieldOrder',
  'filters',
  'propertiesManager',
  'propertiesManagerSettings',
  'forceMono',
  'syncOffset',
  'audioMixers',
  'monitoringType',
  'mixerHidden',
];
export const SCENE_KEYS = ['hotkeys', 'filters', 'sceneItems', 'id', 'name', 'active'];
export const ITEM_KEYS = [
  'hotkeys',
  'id',
  'sourceId',
  'x',
  'y',
  'scaleX',
  'scaleY',
  'visible',
  'crop',
  'locked',
  'rotation',
  'streamVisible',
  'recordingVisible',
  'scaleFilter',
  'blendingMode',
  'blendingMethod',
  'sceneNodeType',
  'display',
];
export const FOLDER_KEYS = [
  'id',
  'name',
  'sceneNodeType',
  'sceneId',
  'resourceId',
  'parentId',
  'childrenIds',
  'display',
];

export const emptyHotkeys = (): Json => ({
  schemaVersion: CURRENT.hotkeys,
  nodeType: 'HotkeysNode',
  items: [],
});

/** Source types valid on Windows (legacy `windowsSources`). Anything else is "unavailable". */
export const WINDOWS_SOURCE_TYPES = [
  'image_source',
  'color_source',
  'browser_source',
  'slideshow',
  'ffmpeg_source',
  'text_gdiplus',
  'monitor_capture',
  'window_capture',
  'game_capture',
  'dshow_input',
  'wasapi_input_capture',
  'wasapi_output_capture',
  'decklink-input',
  'scene',
  'ndi_source',
  'openvr_capture',
  'screen_capture',
  'liv_capture',
  'ovrstream_dc_source',
  'vlc_source',
  'soundtrack_source',
  'mediasoupconnector',
  'wasapi_process_output_capture',
  'spout_capture',
  'smart_browser_source',
];

export const DEFAULT_COLLECTION_NAME = 'Scenes';

export interface ManifestEntry {
  id: string;
  name: string;
  modified: string;
  auto: boolean;
  operatingSystem: 'win32' | 'darwin';
  deleted: boolean;
  needsRename: boolean;
  serverId?: number;
  sceneNodeMaps?: unknown;
  [k: string]: unknown;
}

export interface Manifest {
  activeId: string | null;
  collections: ManifestEntry[];
  [k: string]: unknown;
}

/** Legacy `msToTimeSpec`. */
export function msToTimeSpec(ms: number): { sec: number; nsec: number } {
  const sec = Math.floor(ms / 1000);
  return { sec, nsec: Math.round((ms - sec * 1000) * 1_000_000) };
}

/** Legacy `timeSpecToMs`. */
export function timeSpecToMs(t: { sec: number; nsec: number } | undefined): number {
  if (!t) return 0;
  return Math.round(t.sec * 1000 + t.nsec / 1_000_000);
}

/** Legacy `namingHelpers.suggestName`: `name`, `name (1)`, `name (2)`. */
export function suggestName(name: string, isTaken: (n: string) => boolean): string {
  let n = name;
  while (isTaken(n)) {
    const m = n.match(/^(.*\()([0-9]+)(\))$/);
    n = m ? `${m[1]}${parseInt(m[2], 10) + 1}${m[3]}` : `${n} (1)`;
  }
  return n;
}
