// Dialog window specs (m1-dialogs-design 3.2): entry page and size per kind. Lives in core so sizes
// and new dialogs are hotfixable; main stays generic. Sizes are outer DIP, as legacy.
import type { DialogKind } from '../../shared/contracts';

export interface DialogSpecEntry {
  /** Window page name, `windowUrl(entry)` in main. */
  entry: string;
  width: number;
  height: number;
}

export const DIALOG_SPECS: Record<DialogKind, DialogSpecEntry> = {
  'source-showcase': { entry: 'dialog-source-showcase', width: 900, height: 700 },
  'add-source': { entry: 'dialog-add-source', width: 600, height: 320 },
  'source-properties': { entry: 'dialog-source-properties', width: 600, height: 800 },
  'name-scene': { entry: 'dialog-name-scene', width: 400, height: 250 },
  'rename-source': { entry: 'dialog-rename-source', width: 400, height: 250 },
  'name-folder': { entry: 'dialog-name-folder', width: 400, height: 250 },
};

/** Properties dialogs whose chrome is the single "Close" button (legacy React `SourceProperties`). */
export const CLOSE_CHROME_TYPES = [
  'color_source',
  'browser_source',
  'ffmpeg_source',
  'game_capture',
  'dshow_input',
  'openvr_capture',
];
