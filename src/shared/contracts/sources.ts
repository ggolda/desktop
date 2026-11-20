import type { Contract } from './types';

// M1 contract: sources. See docs/rework/chapter2/m1-design.md.
// A source id is the OBS source name (`<type>_<uuid>`, `scene_<uuid>` for scenes). The display name is
// app-level and independent of it.

export type KnownSourceType =
  | 'image_source'
  | 'color_source'
  | 'browser_source'
  | 'slideshow'
  | 'ffmpeg_source'
  | 'text_gdiplus'
  | 'monitor_capture'
  | 'window_capture'
  | 'game_capture'
  | 'dshow_input'
  | 'wasapi_input_capture'
  | 'wasapi_output_capture'
  | 'decklink-input'
  | 'scene'
  | 'ndi_source'
  | 'openvr_capture'
  | 'screen_capture'
  | 'liv_capture'
  | 'ovrstream_dc_source'
  | 'vlc_source'
  | 'soundtrack_source'
  | 'mediasoupconnector'
  | 'smart_browser_source'
  | 'spout_capture'
  | 'wasapi_process_output_capture';

/** Open: types we do not know are preserved in collections and never rejected. */
export type SourceType = KnownSourceType | (string & {});

/** Feature-owned behavior of a source (widgets, streamlabels, platform apps). Preserved verbatim in M1. */
export type PropertiesManagerType =
  | 'default'
  | 'widget'
  | 'streamlabels'
  | 'platformApp'
  | 'replay'
  | 'iconLibrary'
  | 'smartBrowserSource'
  | (string & {});

export interface SourceInfo {
  id: string;
  name: string;
  type: SourceType;
  /** `loading` until the backend created it (collection load), then `ready`. */
  status: 'loading' | 'ready';
  /** Backend flags: has audio / has video. */
  audio: boolean;
  video: boolean;
  /** Unscaled size reported by the backend (0 until known). */
  width: number;
  height: number;
  configurable: boolean;
  /** Global audio channel (Desktop Audio = 1, Mic/Aux = 3, ...), when assigned. */
  channel?: number;
  propertiesManager: PropertiesManagerType;
}

export interface SourcesState {
  /** Inputs and scenes. Sources that are unavailable or failed to create are NOT listed (see design 3.6). */
  sources: Record<string, SourceInfo>;
}

export interface SourceCreateSpec {
  type: SourceType;
  name: string;
  /** Backend settings (a plain JSON dictionary). Defaults are applied per type by core. */
  settings?: Record<string, unknown>;
  /** A new id is generated when omitted. */
  id?: string;
  channel?: number;
  propertiesManager?: PropertiesManagerType;
  propertiesManagerSettings?: Record<string, unknown>;
}

export interface SourceTypeInfo {
  id: SourceType;
  /** Available on this OS and with the installed backend/plugins. */
  available: boolean;
}

export interface SourcesContract extends Contract {
  slices: { sources: SourcesState };
  commands: {
    sources: {
      /** Creates a source that is not in any scene yet. Returns its id. */
      create(spec: SourceCreateSpec): string;
      /** Removes the source and all scene items that use it. */
      remove(id: string): void;
      rename(id: string, name: string): void;
      /** Settings are returned on demand only (they can be large and contain secrets). */
      getSettings(id: string): Record<string, unknown>;
      updateSettings(id: string, patch: Record<string, unknown>): void;
      /** `name`, `name 2`, ... unique among source names. */
      suggestName(base: string): string;
      types(): SourceTypeInfo[];
    };
  };
  events: {
    'source.added': { id: string; type: SourceType };
    'source.removed': { id: string; type: SourceType };
    'source.updated': { id: string };
  };
}
