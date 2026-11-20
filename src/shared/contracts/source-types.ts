import type { PropertiesManagerType, SourceType } from './sources';
import type { Contract } from './types';

// M1 contract: the catalogue of source types shown by the Add Source dialog (legacy
// `SourceDisplayData` + `getAvailableSourcesTypesList` + the showcase). Core builds it; the dialog renders it.
// See docs/rework/chapter2/m1-dialogs-design.md section 5.
//
// All human text is a legacy i18n key (the English string): the UI passes it through `$t`.

/** Section of the "Media Categories" tab (legacy `group`). `widget` and `app` live in their own tabs. */
export type SourceGroup = 'capture' | 'av' | 'media' | 'widget' | 'app';

/**
 * - `available`: shown and addable.
 * - `disabled`: shown greyed with `reason` (the type exists but cannot be used now).
 * - `hidden`: not shown at all (wrong OS, backend does not provide the type, owner feature absent).
 */
export type SourceAvailability = 'available' | 'disabled' | 'hidden';

export type SourceUnavailableReason =
  /** The backend does not provide this input type (plugin missing, other OS). */
  | 'backend'
  /** Owned by a feature that is not enabled/installed yet (SPEC 5). */
  | 'feature'
  /** Needs a logged-in user (widgets, stream label). */
  | 'login'
  /** The `scene` type needs more than one scene. */
  | 'scenes';

export interface SourceTypeEntry {
  /**
   * Unique catalogue id. Plain sources: the backend type (`image_source`). Feature entries:
   * `replay`, `streamlabel`, `icon_library`, `widget:<WidgetType>`, `app:<appId>:<appSourceId>`.
   */
  id: string;
  /** Backend input type created for this entry (`browser_source` for widgets and apps). */
  sourceType: SourceType;
  /** `default` for plain sources. Non-default values are created by the owning feature. */
  propertiesManager: PropertiesManagerType;
  /** `core`, or `feature:<id>` when a feature registers the entry through its `api.ts`. */
  owner: string;
  /** Display name (i18n key). */
  name: string;
  /** One line under the name in a tile (i18n key). */
  shortDescription?: string;
  /** Description in the side panel (i18n key). */
  description: string;
  /** Bullet list under "Supports:" (i18n keys, or literals like file extensions). */
  supports?: string[];
  /** Legacy icon classes (icomoon `icon-*` or Font Awesome `fas fa-*`), rendered as `<i class>`. */
  icon: string;
  group: SourceGroup;
  /** Widget sub group (`essential`, `interactive`, `goals`, `flair`) inside the Widgets tab. */
  widgetGroup?: string;
  /** Position in the "Essentials" section of the All Sources tab; absent = not essential. */
  essentialOrder?: number;
  /** Side panel preview: `media/source-demos/<night|day>/<file>`; `video` for webm. */
  demo?: { file: string; video?: boolean };
  link?: { url: string; text: string };
  /** Small badge on the tile (legacy `badge`). */
  badge?: string;
  availability: SourceAvailability;
  reason?: SourceUnavailableReason;
}

export interface SourceCatalogue {
  /** In display order inside each section (legacy `allowlistedTypes` order, essentials first). */
  entries: SourceTypeEntry[];
  /** Entry selected when the dialog opens (legacy: `ffmpeg_source` logged out, `AlertBox` logged in). */
  initial: string;
  /** The Widgets tab placeholder: shown when widgets are not available. */
  widgets: { available: boolean; reason?: SourceUnavailableReason };
}

export interface SourceTypesContract extends Contract {
  slices: Record<never, never>;
  commands: {
    sourceTypes: {
      /**
       * The catalogue as it is right now. The Add Source dialog normally gets it in its dialog data
       * (design 3.4) and does not call this.
       */
      catalogue(): SourceCatalogue;
    };
  };
  events: Record<never, never>;
}
