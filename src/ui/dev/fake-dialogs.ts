import type {
  BoolProperty,
  DialogKind,
  DialogOpenRequest,
  DialogState,
  ExistingSourceOption,
  ListProperty,
  NumberProperty,
  PathProperty,
  Property,
  PropertiesChrome,
  SourceCatalogue,
  SourceTypeEntry,
} from '@/shared/contracts';
import { sourceTypeName } from '@/ui/source-types';

/**
 * Fixtures for the dialog contracts of the fake core (dev page and component tests): a catalogue with
 * the legacy `sources-data.ts` texts, the property sets captured in `docs/rework/ui-reference/dialogs/`
 * and the dialog data builders. Core builds the real ones (src/core/dialogs, sources/catalogue.ts).
 */

export const DIALOG_SIZES: Record<DialogKind, { width: number; height: number }> = {
  'source-showcase': { width: 900, height: 700 },
  'add-source': { width: 600, height: 320 },
  'source-properties': { width: 600, height: 800 },
  'name-scene': { width: 400, height: 250 },
  'rename-source': { width: 400, height: 250 },
  'name-folder': { width: 400, height: 250 },
};

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'tga', 'bmp'];
const MEDIA = ['mp4', 'ts', 'mov', 'flv', 'mkv', 'avi', 'mp3', 'ogg', 'aac', 'wav', 'gif', 'webm'];
const COLOR = ['Hex', 'RGBA', 'HSV'];

type Def = Omit<SourceTypeEntry, 'owner' | 'propertiesManager' | 'availability' | 'sourceType'> & {
  /** Legacy `getAvailableSourcesTypesList` description (naming default). */
  naming: string;
};

const def = (d: Def) => d;
const DEFS: Def[] = [
  def({
    id: 'image_source',
    naming: 'Image',
    name: 'Image',
    shortDescription: 'Add image to scene',
    description: 'Add images to your scene.',
    supports: IMAGE,
    icon: 'icon-image',
    group: 'media',
    demo: { file: 'image.png' },
  }),
  def({
    id: 'color_source',
    naming: 'Color Block',
    name: 'Color Block',
    shortDescription: 'Add color to scene',
    description: 'Add a color to the background of your whole scene or just a part.',
    supports: COLOR,
    icon: 'fas fa-fill',
    group: 'media',
    demo: { file: 'color-source.png' },
  }),
  def({
    id: 'browser_source',
    naming: 'Browser Source',
    name: 'Browser Source',
    shortDescription: 'Your web-based content',
    description:
      'Allows you to add web-based content as a source, such as web pages, widgets, and streaming video.',
    supports: ['Websites', 'Third party widgets', 'HTML'],
    icon: 'fas fa-globe',
    group: 'capture',
    demo: { file: 'browser-source.png' },
  }),
  def({
    id: 'ffmpeg_source',
    naming: 'Media File',
    name: 'Media File',
    shortDescription: 'Videos or sound clips',
    description: 'Add videos or sound clips to your scene.',
    supports: MEDIA,
    icon: 'far fa-file-video',
    group: 'media',
    essentialOrder: 3,
    demo: { file: 'media.png' },
  }),
  def({
    id: 'slideshow',
    naming: 'Image Slide Show',
    name: 'Image Slide Show',
    shortDescription: 'Add a slideshow',
    description: 'Add a slideshow of images to your scene.',
    supports: IMAGE,
    icon: 'icon-image',
    group: 'media',
    demo: { file: 'image-slide-show.png' },
  }),
  def({
    id: 'text_gdiplus',
    naming: 'Text (GDI+)',
    name: 'Text (GDI+)',
    shortDescription: 'Add text to scene',
    description: 'Add text to your scene and adjust its style.',
    supports: [...COLOR, 'System Fonts', 'System Sizes'],
    icon: 'fas fa-font',
    group: 'media',
    demo: { file: 'text.png' },
  }),
  def({
    id: 'monitor_capture',
    naming: 'Display Capture',
    name: 'Display Capture',
    shortDescription: 'Share monitor',
    description: 'Capture your entire computer monitor.',
    supports: ['Primary monitor', 'Secondary monitor'],
    icon: 'fas fa-desktop',
    group: 'capture',
    demo: { file: 'display-capture.png' },
  }),
  def({
    id: 'window_capture',
    naming: 'Window Capture',
    name: 'Window Capture',
    shortDescription: 'Share specific window',
    description: "Capture a specific window that's open on your computer.",
    supports: ['Compatible with most modern browsers and programs'],
    icon: 'icon-editor-9',
    group: 'capture',
    demo: { file: 'window-capture.png' },
  }),
  def({
    id: 'game_capture',
    naming: 'Game Capture',
    name: 'Game Capture',
    shortDescription: 'Capture your game',
    description: "Capture a game you're playing on your computer.",
    supports: ['Built in works with most modern computer games'],
    icon: 'fas fa-gamepad',
    group: 'capture',
    essentialOrder: 1,
    demo: { file: 'game-capture.png' },
  }),
  def({
    id: 'dshow_input',
    naming: 'Video Capture Device',
    name: 'Video Capture',
    shortDescription: 'Camera / Capture Card',
    description: 'Display video from webcams, capture cards, and other devices.',
    supports: [
      'Built in webcam',
      'Logitech webcam',
      'Capture cards (Elgato, Avermedia, BlackMagic)',
    ],
    icon: 'icon-webcam',
    group: 'av',
    essentialOrder: 2,
    demo: { file: 'video-capture.png' },
  }),
  def({
    id: 'wasapi_input_capture',
    naming: 'Audio Input Capture',
    name: 'Audio Input Capture',
    shortDescription: 'Capture microphone',
    description:
      'Any device that attaches to a computer for the purpose of capturing sound, such as music or speech.',
    supports: ['Built in microphones', 'USB microphones', 'Other USB devices'],
    icon: 'icon-mic',
    group: 'av',
    demo: { file: 'audio-input.png' },
  }),
  def({
    id: 'wasapi_output_capture',
    naming: 'Audio Output Capture',
    name: 'Audio Output Capture',
    shortDescription: 'Capture desktop audio',
    description:
      'Captures your desktop audio for the purpose of playing sound, such as music or speech.',
    supports: ['Desktop audio'],
    icon: 'icon-audio',
    group: 'av',
    demo: { file: 'audio-output.png' },
  }),
  def({
    id: 'wasapi_process_output_capture',
    naming: 'Application Audio Capture (BETA)',
    name: 'Application Audio',
    shortDescription: 'Beta',
    description: 'Capture the audio coming from a specific application.',
    icon: 'fas fa-user',
    group: 'av',
  }),
  def({
    id: 'openvr_capture',
    naming: 'OpenVR Capture',
    name: 'OpenVR Capture',
    shortDescription: 'Capture VR games',
    description: 'Directly capture the OpenVR monitoring video buffer of your HMD.',
    supports: ['OpenVR', 'SteamVR'],
    icon: 'fab fa-simplybuilt fa-rotate-180',
    group: 'capture',
    demo: { file: 'vr-capture.png' },
  }),
  def({
    id: 'screen_capture',
    naming: 'Screen Capture',
    name: 'Screen Capture',
    shortDescription: 'Capture screen',
    description: 'Capture your game, other applications, or your entire monitor',
    supports: ['Most games, apps, displays'],
    icon: 'icon-group',
    group: 'capture',
    demo: { file: 'window-capture.png' },
  }),
  def({
    id: 'spout_capture',
    naming: 'Spout2 capture',
    name: 'Spout2 capture',
    shortDescription: 'Vtube support',
    description:
      'Virtual avatar capture source. Enables high resolution, zero-compression and zero-latency video capture from VTube third-party software.',
    supports: ['VSeeFace', 'VTube Studio'],
    icon: 'icon-face-masks-3',
    group: 'capture',
    demo: { file: 'source-spout2-thumbnail.gif' },
    link: {
      url: 'https://streamlabs.com/content-hub/post/vtuber-support-on-streamlabs-desktop',
      text: 'Learn how to set it up',
    },
  }),
  def({
    id: 'scene',
    naming: 'Scene',
    name: 'Scene',
    shortDescription: 'Existing scene',
    description: 'Allows you to add existing scene as a source',
    icon: 'far fa-object-group',
    group: 'media',
    demo: { file: 'scene.png' },
  }),
  def({
    id: 'smart_browser_source',
    naming: 'Reactive Source',
    name: 'Reactive Source',
    shortDescription: 'Dynamic game animation',
    description:
      "Dynamic real-time animation based on your game events, powered by Streamlabs Vision. Install Reactive Overlays from our Library to see what it's capable of!",
    supports: ['Kills & Eliminations', 'Health changes', 'Victory & Defeat'],
    icon: 'icon-ai',
    group: 'capture',
    demo: { file: 'reactive-overlay-webm.webm', video: true },
  }),
];

const NAMING = new Map(DEFS.map(d => [d.id, d.naming]));

export interface FakeCatalogueOptions {
  /** Include the entries legacy shows but M1 hides (Reactive Source), for the parity screenshots. */
  legacy?: boolean;
  /** Number of scenes (the `scene` type needs more than one). */
  scenes?: number;
}

export function buildCatalogue(o: FakeCatalogueOptions = {}): SourceCatalogue {
  const entries: SourceTypeEntry[] = DEFS.map(d => {
    const entry: Partial<Def> = { ...d };
    delete entry.naming; // naming default only, not part of the entry
    return {
      ...(entry as Omit<Def, 'naming'>),
      sourceType: d.id as SourceTypeEntry['sourceType'],
      propertiesManager: 'default',
      owner: 'core',
      availability: 'available' as const,
    };
  });
  for (const e of entries) {
    if (e.id === 'smart_browser_source' && !o.legacy) e.availability = 'hidden';
    if (e.id === 'scene' && (o.scenes ?? 2) <= 1) {
      e.availability = 'hidden';
      e.reason = 'scenes';
    }
  }
  return {
    entries,
    initial: 'ffmpeg_source',
    widgets: { available: false, reason: 'login' },
  };
}

/** `suggestName`: `name`, `name (1)`, `name (2)`... unique among the given names. */
export function suggestName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let i = 1; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
}

/** Legacy: these types with the default manager use the React `SourceProperties` ("Close" footer). */
const REACT_PROPERTIES = new Set([
  'color_source',
  'browser_source',
  'ffmpeg_source',
  'game_capture',
  'dshow_input',
  'openvr_capture',
]);
export const chromeFor = (type: string): PropertiesChrome =>
  REACT_PROPERTIES.has(type) ? 'close' : 'cancel-done';

export interface FakeWorld {
  catalogue: SourceCatalogue;
  sources: { id: string; name: string; type: string; channel?: number }[];
  sceneNames: string[];
  activeSceneId: string;
}

/** What `dialogs.open` returns as the first state of the page (core: `DialogState.data`). */
export function buildDialogState(id: string, req: DialogOpenRequest, w: FakeWorld): DialogState {
  const base = { id, title: req.title };
  const names = [...w.sources.map(s => s.name), ...w.sceneNames];
  switch (req.kind) {
    case 'source-showcase':
      return { ...base, kind: req.kind, params: req.params, data: { catalogue: w.catalogue } };
    case 'add-source': {
      const entry = w.catalogue.entries.find(e => e.id === req.params.catalogueId);
      if (!entry) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const sceneId = req.params.sceneId ?? w.activeSceneId;
      const existing: ExistingSourceOption[] =
        entry.sourceType === 'scene'
          ? []
          : w.sources
              .filter(s => s.type === entry.sourceType && s.id !== sceneId && !s.channel)
              .map(s => ({ id: s.id, name: s.name }));
      return {
        ...base,
        kind: req.kind,
        params: req.params,
        data: {
          entry,
          sceneId,
          suggestedName: suggestName(NAMING.get(entry.id) ?? entry.name, names),
          existing,
        },
      };
    }
    case 'source-properties': {
      const src = w.sources.find(s => s.id === req.params.sourceId);
      if (!src) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return {
        ...base,
        kind: req.kind,
        params: req.params,
        data: {
          sourceId: src.id,
          sourceName: src.name,
          typeName: sourceTypeName(src.type),
          chrome: chromeFor(src.type),
        },
      };
    }
    case 'name-scene': {
      const p = req.params;
      const scene = (id: string) => w.sources.find(s => s.id === id)?.name ?? '';
      const mode = p.rename ? 'rename' : p.duplicateFrom ? 'duplicate' : 'create';
      const initialName = p.rename
        ? scene(p.rename)
        : p.duplicateFrom
          ? suggestName(scene(p.duplicateFrom), names)
          : suggestName('New Scene', names);
      return { ...base, kind: req.kind, params: p, data: { mode, initialName } };
    }
    case 'rename-source': {
      const src = w.sources.find(s => s.id === req.params.sourceId);
      if (!src) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return {
        ...base,
        kind: req.kind,
        params: req.params,
        data: { sourceId: src.id, initialName: src.name },
      };
    }
    case 'name-folder':
      return {
        ...base,
        kind: req.kind,
        params: req.params,
        data: { mode: req.params.renameId ? 'rename' : 'create', initialName: 'New Folder' },
      };
  }
}

// ---- property sets (captured in docs/rework/ui-reference/dialogs/)

const common = (name: string, description: string) => ({
  name,
  description,
  enabled: true,
  visible: true,
});
const bool = (name: string, description: string, value: boolean): BoolProperty => ({
  ...common(name, description),
  kind: 'bool',
  value,
});
const num = (
  name: string,
  description: string,
  value: number,
  min: number,
  max: number,
  kind: 'int' | 'slider' = 'int',
): NumberProperty => ({
  ...common(name, description),
  kind,
  value,
  min,
  max,
  step: 1,
  numberType: 'int',
});
const list = (
  name: string,
  description: string,
  value: string | number,
  items: [string, string | number][],
  format: 'int' | 'string' = 'string',
): ListProperty => ({
  ...common(name, description),
  kind: 'list',
  value,
  format,
  items: items.map(([n, v]) => ({ name: n, value: v })),
});
const path = (name: string, description: string, value: string): PathProperty => ({
  ...common(name, description),
  kind: 'path-file',
  value,
  filters: [{ name: 'All Files', extensions: ['*'] }],
  defaultPath: '',
});

const SETS: Record<string, () => Property[]> = {
  image_source: () => [
    path('file', 'Image File', ''),
    bool('unload', 'Unload image when not showing', false),
    bool('linear_alpha', 'Apply alpha in linear space', false),
  ],
  color_source: () => [
    {
      ...common('color', 'Color'),
      kind: 'color',
      value: 0xffffffff,
      alpha: false,
    },
    num('width', 'Width', 400, 0, 4096),
    num('height', 'Height', 400, 0, 4096),
  ],
  browser_source: () => [
    bool('is_local_file', 'Local file', false),
    { ...path('local_file', 'Local file', ''), visible: false },
    { ...common('url', 'URL'), kind: 'text', value: 'https://streamlabs.com/browser-source' },
    num('width', 'Width', 800, 1, 4096),
    num('height', 'Height', 600, 1, 4096),
    bool('reroute_audio', 'Control audio via Streamlabs Desktop', false),
    bool('fps_custom', 'Use custom frame rate', false),
    { ...num('fps', 'FPS', 30, 1, 60), visible: false },
    {
      ...common('css', 'Custom CSS'),
      kind: 'multiline',
      value: 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }',
    },
    bool('shutdown', 'Shutdown source when not visible', true),
    bool('restart_when_active', 'Refresh browser when scene becomes active', false),
    { ...common('refreshnocache', 'Refresh cache of current page'), kind: 'button' },
  ],
  window_capture: () => [
    list('window', 'Window', '', []),
    list(
      'method',
      'Capture Method',
      0,
      [
        ['Automatic', 0],
        ['BitBlt (Windows 7 and up)', 1],
        ['Windows 10 (1903 and up)', 2],
      ],
      'int',
    ),
    list(
      'priority',
      'Window Match Priority',
      2,
      [
        ['Match title, otherwise find window of same type', 2],
        ['Match title', 0],
        ['Match executable', 1],
      ],
      'int',
    ),
    bool('audio', 'Capture Audio (BETA)', false),
    bool('cursor', 'Capture Cursor', true),
    bool('compatibility', 'Multi-adapter Compatibility', false),
  ],
  text_gdiplus: () => [
    {
      ...common('font', 'Font'),
      kind: 'font',
      value: { face: 'Arial', style: 'Regular', size: 256, flags: 0 },
    },
    bool('read_from_file', 'Read from file', false),
    { ...path('file', 'Text File (UTF-8 or UTF-16)', ''), visible: false },
    { ...common('text', 'Text'), kind: 'multiline', value: '' },
    bool('antialiasing', 'Enable Antialiasing', true),
    list(
      'transform',
      'Text Transform',
      0,
      [
        ['None', 0],
        ['Uppercase', 1],
        ['Lowercase', 2],
      ],
      'int',
    ),
    bool('vertical', 'Vertical', false),
    { ...common('color', 'Color'), kind: 'color', value: 0x00ffffff, alpha: true },
    num('opacity', 'Opacity', 100, 0, 100, 'slider'),
    bool('gradient', 'Gradient', false),
  ],
  wasapi_input_capture: () => [
    list('device_id', 'Device', 'default', [['Default', 'default']]),
    bool('use_device_timestamps', 'Use Device Timestamps', false),
  ],
  slideshow: () => [
    {
      ...common('files', 'Image Files'),
      kind: 'editable-list',
      value: [],
      listType: 'files',
      filters: [{ name: 'Image Files', extensions: ['png', 'jpg'] }],
      defaultPath: '',
    },
    num('slide_time', 'Slide Time', 8000, 50, 3600000),
  ],
};
SETS.wasapi_output_capture = SETS.wasapi_input_capture;

/** A representative property set for a source type (empty for types without a fixture). */
export const propertySetFor = (type: string): Property[] => (SETS[type] ?? (() => []))();

/**
 * Stand-in for the libobs `modified` callbacks: toggles `visible` of dependent rows like the real
 * sources do (browser local file / custom fps, text from file).
 */
export function applyModified(type: string, items: Property[]) {
  const get = (n: string) => items.find(i => i.name === n);
  const val = (n: string) => (get(n) as { value?: unknown } | undefined)?.value;
  const show = (n: string, v: boolean) => {
    const p = get(n);
    if (p) p.visible = v;
  };
  if (type === 'browser_source') {
    show('local_file', !!val('is_local_file'));
    show('url', !val('is_local_file'));
    show('fps', !!val('fps_custom'));
  }
  if (type === 'text_gdiplus') {
    show('file', !!val('read_from_file'));
    show('text', !val('read_from_file'));
  }
}
