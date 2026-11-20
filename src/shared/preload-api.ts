/** One entry of a native context menu (`window.reborn.menu.popup`). Plain data, no callbacks. */
export interface NativeMenuItem {
  /** Returned by `popup` when the entry is chosen. Entries without an id (or with a submenu) cannot be chosen. */
  id?: string;
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  /** Shown right-aligned (Electron accelerator syntax, e.g. `CommandOrControl+C`); never registered. */
  accelerator?: string;
  submenu?: NativeMenuItem[];
}

/** The only surface the preload exposes to windows as `window.reborn`. */
export interface RebornBridge {
  /** Asks the preload to hand the core MessagePort to the page (see CORE_PORT_MESSAGE). */
  connectCore(): void;
  window: {
    minimize(): void;
    maximize(): void;
    close(): void;
    /** Current maximized state of the window. */
    isMaximized(): Promise<boolean>;
    /** Calls `cb` whenever the window is maximized or restored. Returns the unsubscribe function. */
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  };
  dialog: {
    /** Dialog pages only: the first complete render is painted, main may show the (hidden) window. */
    ready(): void;
  };
  menu: {
    /** Shows a native menu at the cursor; resolves with the chosen item id, or null when dismissed. */
    popup(items: NativeMenuItem[]): Promise<string | null>;
  };
}
