import type { PathFilter } from './properties';
import type { SourceCatalogue, SourceTypeEntry } from './source-types';
import type { Contract } from './types';

// M1 contract: dialog windows (legacy "child window": Add Source, Source Properties, Name Scene, ...).
// See docs/rework/chapter2/m1-dialogs-design.md section 3.
//
// Flow: a window calls `dialogs.open`; core builds the dialog data synchronously, registers the dialog,
// asks main to create/reuse the window (`dialogWindow.open`, contracts/main-rpc.ts) and the dialog page
// subscribes the slice `dialog:<dialogId>` as its first message: the snapshot is the whole initial state.
// The page learns its id from `?dialog=<dialogId>` in its URL.

/** One value per Vite entry `src/windows/dialog-<kind>/`. */
export type DialogKind =
  /** Legacy `SourceShowcase`: the grid of source types, 900x700. */
  | 'source-showcase'
  /** Legacy `AddSource`: name a new source, or pick an existing one, 600x320. */
  | 'add-source'
  /** Legacy `SourceProperties` / `SourcePropertiesDeprecated`, 600x800. */
  | 'source-properties'
  /** Legacy `NameScene` (create, duplicate, rename), 400x250. */
  | 'name-scene'
  /** Legacy `RenameSource`, 400x250. */
  | 'rename-source'
  /** Legacy `NameFolder` (create, rename), 400x250. */
  | 'name-folder';

export interface DialogParamsMap {
  'source-showcase': Record<string, never>;
  'add-source': {
    /** `SourceTypeEntry.id` chosen in the showcase. */
    catalogueId: string;
    /** Scene that receives the source. Default: the active scene. */
    sceneId?: string;
  };
  'source-properties': { sourceId: string };
  'name-scene': {
    /** Scene id to rename. */
    rename?: string;
    /** Scene id whose items are copied into the new scene. */
    duplicateFrom?: string;
  };
  'rename-source': { sourceId: string };
  'name-folder': {
    sceneId: string;
    /** Folder id to rename. */
    renameId?: string;
    /** Items to move into the new folder. */
    nodeIds?: string[];
  };
}

/** Which footer the Source Properties dialog shows (legacy has two implementations, see design 4.7). */
export type PropertiesChrome =
  /** Legacy React variant: horizontal labels, a single "Close" button. */
  | 'close'
  /** Legacy Vue variant: "Cancel" and "Done" buttons (both just close). */
  | 'cancel-done';

export interface ExistingSourceOption {
  id: string;
  name: string;
}

/** Everything the dialog needs to render its first frame (computed by core when it opens the dialog). */
export interface DialogDataMap {
  'source-showcase': { catalogue: SourceCatalogue };
  'add-source': {
    entry: SourceTypeEntry;
    sceneId: string;
    /** `suggestName(entry description)` (design 5.3). */
    suggestedName: string;
    /**
     * Sources of the same type and properties manager that can be added again (legacy `isSameType`,
     * excluding the target scene itself). Empty = go straight to the naming form. Never offered for
     * the `scene` type.
     */
    existing: ExistingSourceOption[];
  };
  'source-properties': {
    sourceId: string;
    sourceName: string;
    /** Display name of the source type (i18n key); the window title is `Settings for <typeName>`. */
    typeName: string;
    chrome: PropertiesChrome;
  };
  'name-scene': {
    mode: 'create' | 'rename' | 'duplicate';
    initialName: string;
  };
  'rename-source': { sourceId: string; initialName: string };
  'name-folder': { mode: 'create' | 'rename'; initialName: string };
}

export type DialogOpenRequest = {
  [K in DialogKind]: {
    kind: K;
    params: DialogParamsMap[K];
    /** Window title, already translated by the caller (it has the i18n). Shown in the title bar. */
    title: string;
  };
}[DialogKind];

export type DialogState = {
  [K in DialogKind]: {
    id: string;
    kind: K;
    title: string;
    params: DialogParamsMap[K];
    data: DialogDataMap[K];
  };
}[DialogKind];

export interface DialogRef {
  dialogId: string;
  /** Electron window id (what `window-port` carries). */
  windowId: number;
}

/** Native file dialog options (the subset the properties form needs). */
export interface PickPathOptions {
  mode: 'open-file' | 'open-files' | 'open-dir' | 'save-file';
  defaultPath?: string;
  filters?: PathFilter[];
}

export interface PickPathResult {
  canceled: boolean;
  paths: string[];
}

/** Submit of the Add Source dialog. Core creates what is needed and moves the dialog on (design 5.4). */
export type AddSourceSubmit =
  { mode: 'new'; name: string } | { mode: 'existing'; sourceId: string };

export interface DialogsContract extends Contract {
  slices: { [k: `dialog:${string}`]: DialogState };
  commands: {
    dialogs: {
      /**
       * Opens a dialog. There is at most one dialog window (legacy has one child window): when one is
       * open it is replaced in place (title, size, content; re-centered only when the kind changes).
       * Callable from any window and from core code.
       */
      open(request: DialogOpenRequest): DialogRef;
      /** Closes the dialog window. Dialogs normally close themselves with `window.reborn.window.close()`. */
      close(dialogId: string): void;
      /**
       * Add Source "Add Source" button. `new`: creates the source and adds it to the scene as the
       * selected item (`sceneItems.addNew`), `existing`: adds an existing source (`sceneItems.add`).
       * Then replaces the dialog with Source Properties when the new source is configurable, or closes
       * it. Rejects with `ENAME` (empty name). When the chosen scene would contain the current scene
       * core shows the legacy native error box itself ("Unable to add a source: the scene you are
       * trying to add already contains your current scene") and resolves without changing anything:
       * the dialog stays open and the UI shows nothing.
       */
      submitAddSource(dialogId: string, submit: AddSourceSubmit): void;
      /** Native open/save dialog parented to the calling dialog window (via main RPC). */
      pickPath(options: PickPathOptions): PickPathResult;
    };
  };
  events: {
    'dialog.opened': { dialogId: string; kind: DialogKind };
    'dialog.closed': { dialogId: string; kind: DialogKind };
  };
}
