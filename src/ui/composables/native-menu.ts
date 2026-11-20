import type { NativeMenuItem } from '@/shared/preload-api';

/** A menu entry as the UI writes it: `action` runs when the entry is chosen (never sent to main). */
export type MenuEntry =
  | 'separator'
  | {
      label: string;
      /** Display only (right-aligned); the shortcut itself is handled elsewhere. */
      accelerator?: string;
      /** Entries without an action (and no submenu) are shown disabled: not implemented yet. */
      action?: () => void;
      disabled?: boolean;
      submenu?: MenuEntry[];
    };

/** Converts to plain data for main and records the action behind each generated id. */
function convert(
  entries: MenuEntry[],
  prefix: string,
  actions: Map<string, () => void>,
): NativeMenuItem[] {
  return entries.map((e, i): NativeMenuItem => {
    if (e === 'separator') return { type: 'separator' };
    const id = `${prefix}${i}`;
    if (e.submenu) {
      return { label: e.label, submenu: convert(e.submenu, `${id}.`, actions) };
    }
    if (e.action && !e.disabled) actions.set(id, e.action);
    return {
      id,
      label: e.label,
      enabled: !!e.action && !e.disabled,
      ...(e.accelerator ? { accelerator: e.accelerator } : {}),
    };
  });
}

/**
 * Shows a native context menu at the cursor (main process, `window.reborn.menu.popup`), like legacy
 * Electron menus: it is drawn above the native OBS display and matches the system look. Resolves
 * after the chosen action ran. A no-op outside Electron (fake-core dev page, tests).
 */
export async function popupMenu(entries: MenuEntry[]): Promise<void> {
  const bridge = typeof window !== 'undefined' ? window.reborn?.menu : undefined;
  if (!bridge) return;
  const actions = new Map<string, () => void>();
  const items = convert(entries, '', actions);
  const id = await bridge.popup(items);
  if (id) actions.get(id)?.();
}
