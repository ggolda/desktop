// The source type catalogue of the Add Source dialog (m1-dialogs-design 5.1). Text = legacy
// `sources-data.ts` (i18n keys = the English strings), order = legacy `allowlistedTypes`.
import type {
  SourceCatalogue,
  SourceTypeEntry,
  SourceUnavailableReason,
} from '../../shared/contracts';
import { WINDOWS_SOURCE_TYPES } from '../collections/format';

const image = ['png', 'jpg', 'jpeg', 'gif', 'tga', 'bmp'];
const media = ['mp4', 'ts', 'mov', 'flv', 'mkv', 'avi', 'mp3', 'ogg', 'aac', 'wav', 'gif', 'webm'];
const color = ['Hex', 'RGBA', 'HSV'];

type Meta = Omit<
  SourceTypeEntry,
  'sourceType' | 'propertiesManager' | 'owner' | 'availability' | 'reason' | 'demo' | 'link'
> & {
  demoFile?: string;
  demoVideo?: boolean;
  link?: { url: string; text: string };
  /** Hidden regardless of the backend: the owning feature is absent (SPEC 5). */
  feature?: SourceUnavailableReason;
  /** Hidden on this OS. */
  hiddenOnWindows?: boolean;
};

const entry = (
  id: string,
  m: Omit<Meta, 'id'>,
): Meta & {
  id: string;
} => ({ id, ...m });

/** Legacy order. Features that own an entry (replay, streamlabel, ...) are hidden for now. */
const META: Meta[] = [
  entry('image_source', {
    name: 'Image',
    shortDescription: 'Add image to scene',
    description: 'Add images to your scene.',
    supports: image,
    icon: 'icon-image',
    group: 'media',
    demoFile: 'image.png',
  }),
  entry('color_source', {
    name: 'Color Block',
    shortDescription: 'Add color to scene',
    description: 'Add a color to the background of your whole scene or just a part.',
    supports: color,
    icon: 'fas fa-fill',
    group: 'media',
    demoFile: 'color-source.png',
  }),
  entry('browser_source', {
    name: 'Browser Source',
    shortDescription: 'Your web-based content',
    description:
      'Allows you to add web-based content as a source, such as web pages, widgets, and streaming video.',
    supports: ['Websites', 'Third party widgets', 'HTML'],
    icon: 'fas fa-globe',
    group: 'capture',
    demoFile: 'browser-source.png',
  }),
  entry('ffmpeg_source', {
    name: 'Media File',
    shortDescription: 'Videos or sound clips',
    description: 'Add videos or sound clips to your scene.',
    supports: media,
    icon: 'far fa-file-video',
    group: 'media',
    essentialOrder: 3,
    demoFile: 'media.png',
  }),
  entry('slideshow', {
    name: 'Image Slide Show',
    shortDescription: 'Add a slideshow',
    description: 'Add a slideshow of images to your scene.',
    supports: image,
    icon: 'icon-image',
    group: 'media',
    demoFile: 'image-slide-show.png',
  }),
  entry('text_gdiplus', {
    name: 'Text (GDI+)',
    shortDescription: 'Add text to scene',
    description: 'Add text to your scene and adjust its style.',
    supports: [...color, 'System Fonts', 'System Sizes'],
    icon: 'fas fa-font',
    group: 'media',
    demoFile: 'text.png',
  }),
  entry('text_ft2_source', {
    name: 'Text (FreeType 2)',
    description: 'Add text to your scene and adjust its style.',
    supports: [...color, 'System Fonts', 'System Sizes'],
    icon: 'fas fa-font',
    group: 'media',
    demoFile: 'text.png',
    hiddenOnWindows: true,
  }),
  entry('monitor_capture', {
    name: 'Display Capture',
    shortDescription: 'Share monitor',
    description: 'Capture your entire computer monitor.',
    supports: ['Primary monitor', 'Secondary monitor'],
    icon: 'fas fa-desktop',
    group: 'capture',
    demoFile: 'display-capture.png',
  }),
  entry('window_capture', {
    name: 'Window Capture',
    shortDescription: 'Share specific window',
    description: "Capture a specific window that's open on your computer.",
    supports: ['Compatible with most modern browsers and programs'],
    icon: 'icon-editor-9',
    group: 'capture',
    demoFile: 'window-capture.png',
  }),
  entry('game_capture', {
    name: 'Game Capture',
    shortDescription: 'Capture your game',
    description: "Capture a game you're playing on your computer.",
    supports: ['Built in works with most modern computer games'],
    icon: 'fas fa-gamepad',
    group: 'capture',
    essentialOrder: 1,
    demoFile: 'game-capture.png',
  }),
  entry('dshow_input', {
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
    demoFile: 'video-capture.png',
  }),
  entry('wasapi_input_capture', {
    name: 'Audio Input Capture',
    shortDescription: 'Capture microphone',
    description:
      'Any device that attaches to a computer for the purpose of capturing sound, such as music or speech.',
    supports: ['Built in microphones', 'USB microphones', 'Other USB devices'],
    icon: 'icon-mic',
    group: 'av',
    demoFile: 'audio-input.png',
  }),
  entry('wasapi_output_capture', {
    name: 'Audio Output Capture',
    shortDescription: 'Capture desktop audio',
    description:
      'Captures your desktop audio for the purpose of playing sound, such as music or speech.',
    supports: ['Desktop audio'],
    icon: 'icon-audio',
    group: 'av',
    demoFile: 'audio-output.png',
  }),
  entry('decklink-input', {
    name: 'Blackmagic Device',
    description: 'Capture the feed your decklink device is capturing.',
    supports: ['Works with most of the recent Blackmagic cards.'],
    icon: 'fas fa-file',
    group: 'av',
    demoFile: 'sources.png',
  }),
  entry('ndi_source', {
    name: 'NDI source',
    shortDescription: 'Capture NDI output',
    description: 'Allow you to capture NDI output streams.',
    icon: 'fas fa-file',
    group: 'capture',
  }),
  entry('openvr_capture', {
    name: 'OpenVR Capture',
    shortDescription: 'Capture VR games',
    description: 'Directly capture the OpenVR monitoring video buffer of your HMD.',
    supports: ['OpenVR', 'SteamVR'],
    icon: 'fab fa-simplybuilt fa-rotate-180',
    group: 'capture',
    demoFile: 'vr-capture.png',
  }),
  entry('screen_capture', {
    name: 'Screen Capture',
    shortDescription: 'Capture screen',
    description: 'Capture your game, other applications, or your entire monitor',
    supports: ['Most games, apps, displays'],
    icon: 'icon-group',
    group: 'capture',
    demoFile: 'window-capture.png',
  }),
  entry('liv_capture', {
    name: 'LIV Client Capture',
    description:
      'Directly capture the LIV compositor output, reducing load and simplifying setup for Mixed Reality.',
    supports: ['LIV'],
    icon: 'fab fa-simplybuilt fa-rotate-180',
    group: 'capture',
    demoFile: 'vr-capture.png',
  }),
  entry('ovrstream_dc_source', {
    name: 'OvrStream',
    description: '',
    icon: 'fas fa-file',
    group: 'capture',
  }),
  entry('vlc_source', {
    name: 'VLC Source',
    shortDescription: 'Video playlist',
    description: 'Add playlists of videos to your scene.',
    icon: 'fas fa-play',
    group: 'media',
  }),
  entry('soundtrack_source', {
    name: 'Twitch Soundtrack',
    description:
      'Audio source working with the Twitch Soundtrack music application. Add this source to be able to filter out the music from your Twitch VODs.',
    icon: 'fas fa-file',
    group: 'media',
  }),
  entry('wasapi_process_output_capture', {
    name: 'Application Audio',
    shortDescription: 'Beta',
    description: 'Capture the audio coming from a specific application.',
    icon: 'fas fa-user',
    group: 'av',
  }),
  entry('spout_capture', {
    name: 'Spout2 capture',
    shortDescription: 'Vtube support',
    description:
      'Virtual avatar capture source. Enables high resolution, zero-compression and zero-latency video capture from VTube third-party software.',
    supports: ['VSeeFace', 'VTube Studio'],
    icon: 'icon-face-masks-3',
    group: 'capture',
    demoFile: 'source-spout2-thumbnail.gif',
    link: {
      url: 'https://streamlabs.com/content-hub/post/vtuber-support-on-streamlabs-desktop',
      text: 'Learn how to set it up',
    },
  }),
  entry('scene', {
    name: 'Scene',
    shortDescription: 'Existing scene',
    description: 'Allows you to add existing scene as a source',
    icon: 'far fa-object-group',
    group: 'media',
    demoFile: 'scene.png',
  }),
  // Owned by features that do not exist yet (SPEC 5): hidden, a feature registers them later.
  entry('mediasoupconnector', {
    name: 'Collab Cam',
    shortDescription: 'Stream with guests',
    description:
      'Invite guests to join your stream from a web browser or their Streamlabs Desktop. Stream games or IRL broadcasts together, use as additional camera angles and more.',
    icon: 'icon-team-2',
    group: 'av',
    demoFile: 'source-collab-cam.png',
    feature: 'feature',
  }),
  entry('smart_browser_source', {
    name: 'Reactive Source',
    shortDescription: 'Dynamic game animation',
    description:
      "Dynamic real-time animation based on your game events, powered by Streamlabs Vision. Install Reactive Overlays from our Library to see what it's capable of!",
    supports: ['Kills & Eliminations', 'Health changes', 'Victory & Defeat'],
    icon: 'icon-ai',
    group: 'capture',
    demoFile: 'reactive-overlay-webm.webm',
    demoVideo: true,
    feature: 'feature',
  }),
  entry('replay', {
    name: 'Instant Replay',
    shortDescription: 'Display latest replay',
    description: 'Automatically plays your most recently captured replay in your stream.',
    icon: 'icon-replay-buffer',
    group: 'media',
    demoFile: 'media.png',
    feature: 'feature',
  }),
  entry('icon_library', {
    name: 'Custom Icon',
    description: 'Displays an icon from one of many selections',
    icon: 'fas fa-file',
    group: 'media',
    demoFile: 'image.png',
    feature: 'feature',
  }),
  entry('streamlabel', {
    name: 'Stream Label',
    shortDescription: 'Stream stats and events',
    description:
      'Include text into your stream, such as follower count, latest tip, last sub and more.',
    supports: [
      'New Followers',
      'New Subscribers',
      'New Cheers',
      'New Tips',
      'All-Time Top Tipper',
      'Weekly Top Tipper',
      'Monthly Follows',
      'And more',
    ],
    icon: 'fas fa-file',
    group: 'widget',
    demoFile: 'source-stream-labels.png',
    feature: 'login',
  }),
];

/** Entries that are not a backend input type: the backend type they create, and their manager. */
const CREATES: Record<string, { sourceType: string; propertiesManager: string }> = {
  smart_browser_source: {
    sourceType: 'smart_browser_source',
    propertiesManager: 'smartBrowserSource',
  },
  replay: { sourceType: 'ffmpeg_source', propertiesManager: 'replay' },
  icon_library: { sourceType: 'image_source', propertiesManager: 'iconLibrary' },
  streamlabel: { sourceType: 'text_gdiplus', propertiesManager: 'streamlabels' },
};

/** Legacy `getAvailableSourcesTypesList` descriptions: the base of the suggested source name. */
export const NEW_SOURCE_NAME: Record<string, string> = {
  image_source: 'Image',
  color_source: 'Color Block',
  browser_source: 'Browser Source',
  ffmpeg_source: 'Media File',
  slideshow: 'Image Slide Show',
  text_gdiplus: 'Text (GDI+)',
  text_ft2_source: 'Text (FreeType 2)',
  monitor_capture: 'Display Capture',
  window_capture: 'Window Capture',
  game_capture: 'Game Capture',
  dshow_input: 'Video Capture Device',
  wasapi_input_capture: 'Audio Input Capture',
  wasapi_output_capture: 'Audio Output Capture',
  'decklink-input': 'Blackmagic Device',
  ndi_source: 'NDI Source',
  openvr_capture: 'OpenVR Capture',
  screen_capture: 'Screen Capture',
  liv_capture: 'LIV Client Capture',
  ovrstream_dc_source: 'OvrStream',
  vlc_source: 'VLC Source',
  soundtrack_source: 'Soundtrack source',
  mediasoupconnector: 'Collab Cam',
  wasapi_process_output_capture: 'Application Audio Capture (BETA)',
  spout_capture: 'Spout2 capture',
  scene: 'Scene',
  smart_browser_source: 'Reactive Source',
  replay: 'Instant Replay',
  icon_library: 'Custom Icon',
  streamlabel: 'Stream Label',
};

export interface CatalogueInput {
  /** `backend.sources.types()`. */
  backendTypes: string[];
  sceneCount: number;
}

export function buildCatalogue(input: CatalogueInput): SourceCatalogue {
  const have = new Set(input.backendTypes);
  const entries: SourceTypeEntry[] = META.map(m => {
    const { demoFile, demoVideo, feature, hiddenOnWindows, ...rest } = m;
    const creates = CREATES[m.id];
    const sourceType = creates?.sourceType ?? m.id;
    const e: SourceTypeEntry = {
      ...rest,
      sourceType,
      propertiesManager: creates?.propertiesManager ?? 'default',
      owner: feature ? `feature:${m.id}` : 'core',
      availability: 'available',
    };
    if (m.link) e.link = m.link;
    if (demoFile) e.demo = demoVideo ? { file: demoFile, video: true } : { file: demoFile };
    const hide = (reason: SourceUnavailableReason) => {
      e.availability = 'hidden';
      e.reason = reason;
    };
    if (feature) hide(feature);
    else if (hiddenOnWindows || !WINDOWS_SOURCE_TYPES.includes(m.id)) hide('backend');
    else if (m.id === 'scene') {
      if (input.sceneCount <= 1) hide('scenes');
    } else if (!have.has(sourceType)) hide('backend');
    return e;
  });
  return { entries, initial: 'ffmpeg_source', widgets: { available: false, reason: 'login' } };
}

/** Display name (i18n key) of a source type, for "Settings for <type>"; falls back to the type id. */
export function typeDisplayName(sourceType: string, manager = 'default'): string {
  for (const m of META) {
    const c = CREATES[m.id];
    if ((c?.sourceType ?? m.id) === sourceType && (c?.propertiesManager ?? 'default') === manager) {
      return m.name;
    }
  }
  return sourceType;
}
