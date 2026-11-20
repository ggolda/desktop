import { popupMenu, type MenuEntry } from '@/ui/composables/native-menu';
import { useSourcesStore } from '@/ui/stores/sources';

/**
 * Native context menus of the editor: the source menu (sources list and preview) and the scene menu
 * (right click on an empty preview). Same entries and order as the legacy `util/menus/EditMenu.ts`;
 * entries that are not implemented yet have no action and show disabled.
 */
export function useEditMenu() {
  const store = useSourcesStore();
  const disabled = (labels: string[]): MenuEntry[] => labels.map(label => ({ label }));

  function sourceMenu(ids: string[]): MenuEntry[] {
    const single = ids.length === 1;
    const t = (label: string, action: Parameters<typeof store.transform>[1]): MenuEntry => ({
      label,
      action: () => store.transform(ids, action),
    });
    const allHidden = ids.every(id => !store.itemVisible(id));
    return [
      { label: 'Paste (Reference)', accelerator: 'CommandOrControl+V' },
      { label: 'Paste (Duplicate)' },
      { label: 'Copy', accelerator: 'CommandOrControl+C' },
      { label: 'Select All', accelerator: 'CommandOrControl+A', action: () => store.selectAll() },
      { label: 'Invert Selection', action: () => store.invertSelection() },
      'separator',
      {
        label: 'Transform',
        submenu: [
          { label: 'Edit Transform' },
          t('Reset Transform', { type: 'reset' }),
          'separator',
          t('Stretch to Screen', { type: 'stretch' }),
          t('Fit to Screen', { type: 'fit' }),
          t('Center on Screen', { type: 'center' }),
          { label: 'Center Horizontal' },
          { label: 'Center Vertical' },
          'separator',
          t('Flip Vertical', { type: 'flipY' }),
          t('Flip Horizontal', { type: 'flipX' }),
          'separator',
          t('Rotate 90 Degrees CW', { type: 'rotate', deg: 90 }),
          t('Rotate 90 Degrees CCW', { type: 'rotate', deg: -90 }),
          t('Rotate 180 Degrees', { type: 'rotate', deg: 180 }),
        ],
      },
      {
        label: 'Group',
        submenu: disabled([
          'Group into Folder',
          'Ungroup Folder',
          'Group into Scene',
          'Ungroup Scene',
        ]),
      },
      'separator',
      {
        label: 'Scale Filtering',
        submenu: disabled(['Disable', 'Point', 'Bicubic', 'Bilinear', 'Lanczos', 'Area']),
      },
      {
        label: 'Blending Mode',
        submenu: disabled([
          'Normal',
          'Additive',
          'Substract',
          'Screen',
          'Multiply',
          'Lighten',
          'Darken',
        ]),
      },
      { label: 'Blending Method', submenu: disabled(['Default', 'SRGB Off']) },
      {
        label: allHidden ? 'Show' : 'Hide',
        action: () => store.setVisible(ids, allHidden),
      },
      { label: 'Export Widget' },
      { label: 'Remove', accelerator: 'Delete', action: () => store.askRemove(ids) },
      { label: 'Interact' },
      { label: 'Rename', action: single ? () => store.startRename(ids[0]) : undefined },
      { label: 'Filters', submenu: disabled(['Edit Filters', 'Copy Filters', 'Paste Filters']) },
      { label: 'Properties', action: single ? () => store.openProperties(ids[0]) : undefined },
      'separator',
      {
        label: 'Projector',
        submenu: disabled(['Create Source Projector', 'Create Output Projector']),
      },
      { label: 'Performance Mode' },
      'separator',
      { label: 'Undo', accelerator: 'CommandOrControl+Z' },
      { label: 'Redo', accelerator: 'CommandOrControl+Y' },
    ];
  }

  /** Right click on an empty part of the preview (legacy EditMenu without a source). */
  function sceneMenu(): MenuEntry[] {
    return [
      { label: 'Paste (Reference)', accelerator: 'CommandOrControl+V' },
      { label: 'Paste (Duplicate)' },
      'separator',
      { label: 'Lock Sources', action: () => store.setAllLocked(true) },
      { label: 'Unlock Sources', action: () => store.setAllLocked(false) },
      'separator',
      {
        label: 'Projector',
        submenu: disabled(['Create Source Projector', 'Create Output Projector']),
      },
      { label: 'Performance Mode' },
      'separator',
      { label: 'Undo', accelerator: 'CommandOrControl+Z' },
      { label: 'Redo', accelerator: 'CommandOrControl+Y' },
    ];
  }

  return {
    sourceMenu,
    sceneMenu,
    /** The source menu for the current selection when `rowId` is part of it, else for `rowId` alone. */
    popupSource(rowId: string) {
      const sel = store.selectedIds;
      return popupMenu(sourceMenu(sel.includes(rowId) ? [...sel] : [rowId]));
    },
    popupForIds(ids: string[]) {
      return popupMenu(ids.length ? sourceMenu(ids) : sceneMenu());
    },
  };
}
