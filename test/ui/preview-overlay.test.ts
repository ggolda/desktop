// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import type { DisplayState, SceneItemNode, SelectionState } from '@/shared/contracts';
import { setCoreClient } from '@/ui/core';
import { createFakeCore, type FakeCore } from '@/ui/dev/fake-core';
import { registerOccluder, resetOccluders } from '@/ui/overlay/occluders';
import PreviewArea from '@/windows/main/components/PreviewArea.vue';
import { installDomStubs } from './dom-stubs';

let fake: FakeCore;
let wrapper: VueWrapper | undefined;

const settle = async () => {
  for (let i = 0; i < 4; i++) await flushPromises();
  await nextTick();
};
const calls = (target: string, method: string) =>
  fake.calls.filter(c => c.target === target && c.method === method);

async function mountPreview() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 960,
        height: 540,
        right: 960,
        bottom: 540,
      }) as DOMRect,
  );
  wrapper = mount(PreviewArea, { attachTo: document.body, global: { plugins: [createPinia()] } });
  await settle();
  // the display exists: core would report where the canvas is drawn (960x540 for a 1920x1080 canvas)
  const id = calls('display', 'create')[0].args[0] as string;
  fake.mutate<DisplayState>(`display:${id}`, s => {
    s.outputRegion = { x: 0, y: 0, width: 960, height: 540 };
  });
  await settle();
  return wrapper.get('[data-testid="preview-overlay"]').element;
}

function pointer(el: Element, type: string, x: number, y: number, o: MouseEventInit = {}) {
  el.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...o }),
  );
}

const sceneNodes = () => {
  const sel = fake.slices.get('selection') as SelectionState;
  const items = fake.slices.get(`sceneItems:${sel.sceneId}`) as { nodes: SceneItemNode[] };
  return items.nodes.filter(n => n.kind === 'item');
};

beforeEach(() => {
  installDomStubs();
  resetOccluders();
  fake = createFakeCore({ autoMeters: false });
  setCoreClient(fake.connect(reactive));
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  fake.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('preview overlay', () => {
  it('uses the legacy display padding and draws the editor UI', async () => {
    await mountPreview();
    expect(calls('display', 'create')[0].args[1]).toMatchObject({ paddingSize: 10, drawUi: true });
  });

  it('a click selects the front-most item through core, a click on an empty area clears', async () => {
    const overlay = await mountPreview();
    const top = sceneNodes()[0];
    pointer(overlay, 'pointerdown', 480, 270, { button: 0, buttons: 1 });
    await settle();
    pointer(overlay, 'pointerup', 480, 270, { button: 0 });
    await settle();
    expect(calls('selection', 'set').at(-1)!.args[0]).toEqual([top.id]);
    // far outside every item: clears the selection
    pointer(overlay, 'pointerdown', -400, -400, { button: 0, buttons: 1 });
    await settle();
    pointer(overlay, 'pointerup', -400, -400, { button: 0 });
    await settle();
    expect(calls('selection', 'clear')).toHaveLength(1);
  });

  it('dragging sends transforms and the final position, then the pointer is released', async () => {
    const overlay = await mountPreview();
    const top = sceneNodes()[0];
    pointer(overlay, 'pointerdown', 480, 270, { button: 0, buttons: 1 });
    await settle();
    pointer(overlay, 'pointermove', 500, 280, { button: 0, buttons: 1 });
    await settle();
    pointer(overlay, 'pointerup', 520, 290, { button: 0 });
    await settle();
    const t = calls('sceneItems', 'transform');
    expect(t.length).toBeGreaterThan(0);
    const last = t.at(-1)!.args[1] as {
      id: string;
      transform: { position: { x: number; y: number } };
    }[];
    // 40 css px right and 20 down = 80 / 40 canvas px (snapping may pull it to an edge but never by more than 20)
    expect(last[0].id).toBe(top.id);
    expect(Math.abs(last[0].transform.position.x - 80)).toBeLessThanOrEqual(20);
    expect(calls('selection', 'set').at(-1)!.args[0]).toEqual([top.id]);
  });

  it('right click opens the native menu path (the scene menu on nothing)', async () => {
    const popup = vi.fn().mockResolvedValue(null);
    (window as unknown as { reborn: unknown }).reborn = { menu: { popup } };
    const overlay = await mountPreview();
    pointer(overlay, 'pointerdown', -400, -400, { button: 2, buttons: 2 });
    await settle();
    pointer(overlay, 'pointerup', -400, -400, { button: 2 });
    await settle();
    expect(popup).toHaveBeenCalledTimes(1);
    const labels = (popup.mock.calls[0][0] as { label?: string }[]).map(i => i.label);
    expect(labels).toContain('Lock Sources');
    delete (window as unknown as { reborn?: unknown }).reborn;
  });

  describe('keyboard', () => {
    async function withSelection() {
      await mountPreview();
      const top = sceneNodes()[0];
      fake.mutate<SelectionState>('selection', s => {
        s.ids = [top.id];
        s.lastId = top.id;
      });
      await settle();
      return top;
    }
    const key = (k: string, o: KeyboardEventInit = {}) =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }),
      );

    it('arrows nudge the selection by 1 canvas px in one atomic command; modified arrows do nothing (legacy)', async () => {
      const top = await withSelection();
      key('ArrowRight');
      await settle();
      expect(calls('sceneItems', 'translate').at(-1)!.args).toEqual([
        expect.any(String),
        [top.id],
        { x: 1, y: 0 },
      ]);
      const n = calls('sceneItems', 'translate').length;
      key('ArrowUp', { shiftKey: true });
      await settle();
      expect(calls('sceneItems', 'translate')).toHaveLength(n);
    });

    it('does not nudge while any selected item is locked, an overlay is open or without a selection', async () => {
      const top = await withSelection();
      fake.mutate<{ nodes: SceneItemNode[] }>(
        `sceneItems:${(fake.slices.get('selection') as SelectionState).sceneId}`,
        s => {
          const n = s.nodes.find(x => x.id === top.id);
          if (n) n.locked = true;
        },
      );
      await settle();
      key('ArrowLeft');
      await settle();
      expect(calls('sceneItems', 'translate')).toHaveLength(0);
      fake.mutate<{ nodes: SceneItemNode[] }>(
        `sceneItems:${(fake.slices.get('selection') as SelectionState).sceneId}`,
        s => {
          const n = s.nodes.find(x => x.id === top.id);
          if (n) n.locked = false;
        },
      );
      await settle();
      const release = registerOccluder();
      key('ArrowLeft');
      await settle();
      expect(calls('sceneItems', 'translate')).toHaveLength(0);
      release();
    });

    it('Delete asks to remove the selection', async () => {
      await withSelection();
      key('Delete');
      await settle();
      const { useSourcesStore } = await import('@/ui/stores/sources');
      expect(useSourcesStore().pendingRemove).toHaveLength(1);
    });
  });
});
