// Small synthetic collections in the exact legacy file shape (no real data, no tokens).
import type { Json } from '@/core/collections/format';

const hk = (items: unknown[] = []): Json => ({ schemaVersion: 2, nodeType: 'HotkeysNode', items });
const binding = { key: 'F1', modifiers: { alt: false, ctrl: true, shift: false, meta: false } };

export const ID = {
  desktop: 'wasapi_output_capture_a820fa65-62fd-4890-9d48-18d13a56cf30',
  mic: 'wasapi_input_capture_798c5b9c-a3ad-445e-90f6-10e7b66432c4',
  image: 'image_source_11111111-1111-4111-8111-111111111111',
  browser: 'browser_source_22222222-2222-4222-8222-222222222222',
  unknown: 'foo_source_33333333-3333-4333-8333-333333333333',
  sceneA: 'scene_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sceneB: 'scene_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  itemImage: 'item-image-0000-4000-8000-000000000001',
  itemBrowser: 'item-browser-0000-4000-8000-000000000002',
  itemScene: 'item-scene-0000-4000-8000-000000000003',
  itemVertical: 'item-vertical-0000-4000-8000-000000000004',
  itemUnknown: 'item-unknown-0000-4000-8000-000000000005',
  folder: 'folder-0000-4000-8000-000000000006',
  transition: 'transition-0000-4000-8000-000000000007',
};

function audioSource(id: string, name: string, type: string, channel: number, extra: Json = {}) {
  return {
    hotkeys: hk([{ actionName: 'TOGGLE_MUTE', bindings: [binding], hotkeyId: 1 }]),
    id,
    name,
    type,
    settings: { device_id: 'default' },
    volume: 1,
    channel,
    muted: false,
    deinterlaceMode: 0,
    deinterlaceFieldOrder: 0,
    filters: { items: [] },
    propertiesManager: 'default',
    propertiesManagerSettings: {},
    forceMono: false,
    syncOffset: { sec: 0, nsec: 0 },
    audioMixers: 1,
    monitoringType: 0,
    mixerHidden: false,
    ...extra,
  };
}

function videoSource(id: string, name: string, type: string, settings: Json, extra: Json = {}) {
  return {
    hotkeys: hk(),
    id,
    name,
    type,
    settings,
    volume: 1,
    muted: false,
    deinterlaceMode: 0,
    deinterlaceFieldOrder: 0,
    filters: { items: [] },
    propertiesManager: 'default',
    propertiesManagerSettings: {},
    ...extra,
  };
}

function item(id: string, sourceId: string, x: number, y: number, extra: Json = {}) {
  return {
    hotkeys: hk(),
    id,
    sourceId,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    visible: true,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    locked: false,
    rotation: 0,
    streamVisible: true,
    recordingVisible: true,
    scaleFilter: 0,
    blendingMode: 0,
    blendingMethod: 0,
    sceneNodeType: 'item',
    display: 'horizontal',
    ...extra,
  };
}

export interface BuildOptions {
  /** Add a source of an unsupported type and an item that uses it. */
  withUnknown?: boolean;
}

/** A v5 collection: two scenes (B nested in A), a folder, a vertical item, unknown keys. */
export function buildV5(opts: BuildOptions = { withUnknown: true }): Json {
  const sources: Json[] = [
    audioSource(ID.desktop, 'Desktop Audio', 'wasapi_output_capture', 1),
    audioSource(ID.mic, 'Mic/Aux', 'wasapi_input_capture', 3),
    videoSource(ID.image, 'Logo', 'image_source', { file: 'C:/logo.png' }),
    audioSource(ID.browser, 'Alerts', 'browser_source', 0, {
      settings: { url: 'https://example.invalid/widget?token=SECRET', width: 800, height: 600 },
      channel: undefined,
      futureSourceKey: { keep: 'me' },
    }),
  ];
  delete (sources[3] as Json).channel;
  if (opts.withUnknown) {
    sources.push(videoSource(ID.unknown, 'Mystery', 'foo_source', { a: 1 }));
  }
  const folder = {
    id: ID.folder,
    name: 'Folder',
    sceneNodeType: 'folder',
    sceneId: ID.sceneA,
    resourceId: `SceneItemFolder${JSON.stringify([ID.sceneA, ID.folder])}`,
    parentId: '',
    childrenIds: [ID.itemBrowser],
    display: 'horizontal',
  };
  // file order is bottom-first; UI order (top-first) is the reverse
  const itemsA: Json[] = [
    item(ID.itemVertical, ID.image, 10, 20, { display: 'vertical' }),
    item(ID.itemBrowser, ID.browser, 100, 50),
    folder,
    item(ID.itemImage, ID.image, 5, 6, { futureItemKey: 1 }),
    item(ID.itemScene, ID.sceneB, 0, 0),
  ];
  if (opts.withUnknown) itemsA.unshift(item(ID.itemUnknown, ID.unknown, 1, 2));
  const scene = (id: string, name: string, active: boolean, items: Json[]) => ({
    hotkeys: hk([{ actionName: 'SWITCH_TO_SCENE', bindings: [binding] }]),
    filters: { schemaVersion: 1, nodeType: 'SceneFiltersNode', items: [] },
    sceneItems: { schemaVersion: 1, nodeType: 'SceneItemsNode', items },
    id,
    name,
    active,
  });
  return {
    schemaVersion: 5,
    nodeType: 'RootNode',
    sources: { schemaVersion: 5, nodeType: 'SourcesNode', items: sources },
    scenes: {
      schemaVersion: 1,
      nodeType: 'ScenesNode',
      items: [
        scene(ID.sceneA, 'Scene A', true, itemsA),
        scene(ID.sceneB, 'Scene B', false, [
          item('item-b-0000-4000-8000-000000000008', ID.image, 1, 1),
        ]),
      ],
    },
    transitions: {
      schemaVersion: 2,
      nodeType: 'TransitionsNode',
      transitions: [
        {
          id: ID.transition,
          name: 'Global Transition',
          type: 'cut_transition',
          duration: 300,
          settings: {},
          propertiesManagerSettings: {},
        },
      ],
      connections: [],
      defaultTransitionId: ID.transition,
    },
    hotkeys: hk([{ actionName: 'TOGGLE_START_STREAMING', bindings: [binding] }]),
    guestCam: {
      schemaVersion: 1,
      nodeType: 'GuestCamNode',
      audioSourceId: ID.mic,
      videoSourceId: '',
    },
    relativeCoordinates: true,
    baseResolution: { baseWidth: 1920, baseHeight: 1080 },
    baseResolutions: {
      horizontal: { baseWidth: 1920, baseHeight: 1080 },
      vertical: { baseWidth: 720, baseHeight: 1280 },
    },
    selectiveRecording: false,
    dualOutputMode: false,
    operatingSystem: 'win32',
    futureRootKey: { nested: [1, 2, 3] },
  };
}

/** An old (schema 2) collection: no display/streamVisible keys, reordered keys, no coordinates flag. */
export function buildV2(): Json {
  return {
    schemaVersion: 2,
    nodeType: 'RootNode',
    sources: {
      schemaVersion: 3,
      nodeType: 'SourcesNode',
      items: [
        {
          id: ID.desktop,
          name: 'Desktop Audio',
          type: 'wasapi_output_capture',
          settings: {},
          volume: 1,
          channel: 1,
          hotkeys: hk(),
          muted: true,
          filters: { items: [] },
          propertiesManager: 'default',
          propertiesManagerSettings: {},
          forceMono: false,
          syncOffset: { sec: 0, nsec: 0 },
          audioMixers: 255,
          monitoringType: 0,
          mixerHidden: false,
        },
        {
          id: ID.image,
          name: 'Logo',
          type: 'image_source',
          settings: { file: 'C:/logo.png' },
          volume: 1,
          hotkeys: hk(),
          muted: false,
          filters: { items: [] },
          propertiesManager: 'default',
          propertiesManagerSettings: {},
        },
      ],
    },
    scenes: {
      schemaVersion: 1,
      nodeType: 'ScenesNode',
      items: [
        {
          id: ID.sceneA,
          name: 'Scene',
          sceneItems: {
            schemaVersion: 1,
            nodeType: 'SceneItemsNode',
            items: [
              {
                id: ID.itemImage,
                sourceId: ID.image,
                x: 12,
                y: 34,
                scaleX: 0.5,
                scaleY: 0.5,
                visible: true,
                crop: { top: 0, bottom: 0, left: 0, right: 0 },
                locked: false,
                hotkeys: hk(),
                rotation: 0,
              },
            ],
          },
          hotkeys: hk(),
          filters: { schemaVersion: 1, nodeType: 'SceneFiltersNode', items: [] },
          active: true,
        },
      ],
    },
    transitions: {
      schemaVersion: 2,
      nodeType: 'TransitionsNode',
      transitions: [
        {
          id: ID.transition,
          name: 'Global Transition',
          type: 'cut_transition',
          duration: 300,
          settings: {},
          propertiesManagerSettings: {},
        },
      ],
      connections: [],
      defaultTransitionId: ID.transition,
    },
    hotkeys: hk(),
  };
}

export const toText = (j: Json) => JSON.stringify(j, null, 2);

export function manifestOf(
  entries: { id: string; name?: string; modified?: string }[],
  activeId: string,
) {
  return {
    activeId,
    collections: entries.map(e => ({
      id: e.id,
      name: e.name ?? 'Scenes',
      modified: e.modified ?? '2026-01-01T00:00:00.000Z',
      auto: false,
      operatingSystem: 'win32',
      deleted: false,
      needsRename: false,
    })),
  };
}

/** Paths whose values differ between two JSON values (never the values themselves). */
export function diffPaths(a: unknown, b: unknown, base = '$', out: string[] = []): string[] {
  if (a === b) return out;
  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push(base);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a) || !(k in b)) out.push(`${base}.${k}`);
    else diffPaths(a[k], b[k], `${base}.${k}`, out);
  }
  return out;
}
