// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeMenuItem } from '@/shared/preload-api';
import { popupMenu } from '@/ui/composables/native-menu';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('popupMenu', () => {
  it('sends plain data, disables entries without an action and runs the chosen action', async () => {
    const run = vi.fn();
    const other = vi.fn();
    let sent: NativeMenuItem[] = [];
    vi.stubGlobal('reborn', {
      menu: {
        popup: (items: NativeMenuItem[]) => {
          sent = items;
          return Promise.resolve('2.0');
        },
      },
    });
    window.reborn = (globalThis as unknown as { reborn: Window['reborn'] }).reborn;
    await popupMenu([
      { label: 'Copy', accelerator: 'CommandOrControl+C' },
      { label: 'Other', action: other },
      { label: 'Transform', submenu: [{ label: 'Reset', action: run }] },
    ]);
    expect(sent[0]).toMatchObject({ id: '0', enabled: false, accelerator: 'CommandOrControl+C' });
    expect(sent[1]).toMatchObject({ id: '1', enabled: true });
    expect(sent[2].submenu?.[0]).toMatchObject({ id: '2.0', label: 'Reset', enabled: true });
    expect(JSON.stringify(sent)).not.toContain('function');
    expect(run).toHaveBeenCalledOnce(); // popup resolved with the submenu entry id
    expect(other).not.toHaveBeenCalled();
  });

  it('does nothing outside Electron', async () => {
    window.reborn = undefined as never;
    await expect(popupMenu([{ label: 'x' }])).resolves.toBeUndefined();
  });
});
