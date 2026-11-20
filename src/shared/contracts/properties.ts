import type { Contract } from './types';

// M1 contract: source properties (OBS property sets) for the Source Properties dialog.
// See docs/rework/chapter2/m1-dialogs-design.md section 4.
//
// A property set is the backend's view of a source's configurable fields (`source.properties` in
// obs-studio-node). It is read from the backend, never stored by core, and delivered to the dialog as
// the slice `properties:<dialogId>` (snapshot on subscribe, then patches). Values travel in the shapes
// below, which are plain JSON; native objects never cross.

/**
 * Property kinds. They cover every `EPropertyType` of obs-studio-node (Boolean, Int, Float, Text, Path,
 * List, Color, Button, Font, EditableList, FrameRate, Group, ColorAlpha, Capture) and the sub types of
 * Text (default/password/multiline/info), Path (file/save/directory) and Int/Float (scroller/slider).
 * Legacy renders only the first group of kinds; `unsupported` is what it shows for the rest (nothing).
 */
export type PropertyKind =
  | 'bool'
  | 'int'
  | 'float'
  | 'slider'
  | 'text'
  | 'password'
  | 'multiline'
  | 'info'
  | 'path-file'
  | 'path-save'
  | 'path-dir'
  | 'list'
  | 'color'
  | 'font'
  | 'editable-list'
  | 'button'
  | 'unsupported';

export interface PropertyBase {
  kind: PropertyKind;
  /** Setting key in the backend settings object. */
  name: string;
  /** Label, an English libobs string: the UI passes it through `$translateIfExist`. */
  description: string;
  /** Tooltip text when the backend provides one. */
  longDescription?: string;
  /** False = rendered disabled. */
  enabled: boolean;
  /** False = not rendered (the backend toggles it from `modified` callbacks). */
  visible: boolean;
}

export interface BoolProperty extends PropertyBase {
  kind: 'bool';
  value: boolean;
}

export interface NumberProperty extends PropertyBase {
  kind: 'int' | 'float' | 'slider';
  value: number;
  min: number;
  max: number;
  step: number;
  /** Underlying backend type for `slider` (a slider can be int or float). */
  numberType?: 'int' | 'float';
}

export interface TextProperty extends PropertyBase {
  kind: 'text' | 'password' | 'multiline';
  value: string;
}

/** Read-only message (`OBS_TEXT_INFO`): `description` is the text, `severity` picks the frame. */
export interface InfoProperty extends PropertyBase {
  kind: 'info';
  value: string;
  severity: 'normal' | 'warning' | 'error';
}

/** File filter in the shape the native dialogs use (parsed from the libobs `Name (*.ext *.ext);;...`). */
export interface PathFilter {
  name: string;
  extensions: string[];
}

export interface PathProperty extends PropertyBase {
  kind: 'path-file' | 'path-save' | 'path-dir';
  value: string;
  filters: PathFilter[];
  defaultPath: string;
}

export interface ListItem {
  /** Label (an English libobs string, passed through `$translateIfExistWithCheck`). */
  name: string;
  value: string | number;
}

export interface ListProperty extends PropertyBase {
  kind: 'list';
  value: string | number;
  /** Item value type; the UI must send values back in this type. */
  format: 'int' | 'float' | 'string';
  items: ListItem[];
}

/** `OBS_PROPERTY_COLOR` / `COLOR_ALPHA`: the backend integer 0xAABBGGRR (legacy `Utils.rgbaToInt`). */
export interface ColorProperty extends PropertyBase {
  kind: 'color';
  value: number;
  /** True for `COLOR_ALPHA`. Legacy edits alpha for both. */
  alpha: boolean;
}

/** OBS font object. `path` is the app-level `custom_font` setting (Google fonts), not part of `font`. */
export interface FontValue {
  face?: string;
  style?: string;
  size?: number;
  /** Bit flags: 1 bold, 2 italic, 4 underline, 8 strikeout. */
  flags?: number;
  path?: string;
}

export interface FontProperty extends PropertyBase {
  kind: 'font';
  value: FontValue;
}

export interface EditableListProperty extends PropertyBase {
  kind: 'editable-list';
  value: string[];
  /** `strings` = free text items, `files` = files, `files-and-urls`. */
  listType: 'strings' | 'files' | 'files-and-urls';
  filters: PathFilter[];
  defaultPath: string;
}

/** A button has no value. Pressing it is the `properties.press` command. */
export interface ButtonProperty extends PropertyBase {
  kind: 'button';
}

/** Kinds the UI cannot edit yet (frame rate, group, capture): kept so indexes and order stay stable. */
export interface UnsupportedProperty extends PropertyBase {
  kind: 'unsupported';
  /** Backend property type number, for diagnostics. */
  backendType: number;
}

export type Property =
  | BoolProperty
  | NumberProperty
  | TextProperty
  | InfoProperty
  | PathProperty
  | ListProperty
  | ColorProperty
  | FontProperty
  | EditableListProperty
  | ButtonProperty
  | UnsupportedProperty;

export type PropertyValue = Exclude<Property, ButtonProperty | UnsupportedProperty>['value'];

/**
 * Slice `properties:<dialogId>`. `items` keeps backend order (after the properties manager's
 * deny list and display order, see design 4.4). After every change core re-reads the whole set from the
 * backend (that is how `modified` callbacks reach the UI) and patches only fields that differ:
 * `['s', ['items', i, 'value'], v]`, `visible`, `enabled`, `items`. Order and membership change
 * only through a full `items` replace.
 */
export interface PropertiesState {
  sourceId: string;
  /** Bumped on every re-read, even when nothing differs (lets the UI drop a pending optimistic value). */
  rev: number;
  items: Property[];
}

/** One edited value. `font.path` is split into the `custom_font` setting by core. */
export interface PropertyChange {
  name: string;
  value: PropertyValue;
}

/** One installed system font face (from the native `font-manager`, read lazily by core). */
export interface FontFace {
  family: string;
  style: string;
  /** OBS font flags for this face (legacy `getFlagsFromFont`): 1 bold, 2 italic. */
  flags: number;
  weight: number;
  italic: boolean;
}

export interface PropertiesContract extends Contract {
  slices: { [k: `properties:${string}`]: PropertiesState };
  commands: {
    properties: {
      /**
       * Applies edits to a source (live: this is what the user sees in the preview), then re-reads the
       * set. Core also validates `list` values against the new items and falls back to the first item,
       * like legacy `setPropertiesFormData`. Consecutive edits of one source combine into one undo
       * step (legacy `EditSourcePropertiesCommand`). Rejects with `ENOENT` for an unknown source.
       */
      set(sourceId: string, changes: PropertyChange[]): void;
      /** Presses a `button` property (e.g. `refreshnocache`), then re-reads the set. */
      press(sourceId: string, name: string): void;
      /** Re-reads the set (after the UI regained focus, or a device list changed). */
      refresh(sourceId: string): void;
      /**
       * Installed system fonts for the `font` input (all faces, sorted by family then weight). Loads the
       * native `font-manager` on the first call, only when a font property is shown.
       */
      fonts(): FontFace[];
    };
  };
  events: Record<never, never>;
}
