// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import type { AudioState, ScenesState, SceneNode } from '@/shared/contracts';
import { setCoreClient } from '@/ui/core';
import { createFakeCore, type FakeCore } from '@/ui/dev/fake-core';
import { useObsDisplay } from '@/ui/display/useObsDisplay';
import { registerOccluder, resetOccluders, useOccluder } from '@/ui/overlay/occluders';
import MixerPanel from '@/windows/main/components/MixerPanel.vue';
import ScenesPanel from '@/windows/main/components/ScenesPanel.vue';
import SourcesPanel from '@/windows/main/components/SourcesPanel.vue';
import { FakeIO, installDomStubs, setFocus } from './dom-stubs';

let fake: FakeCore;
let wrapper: VueWrapper | undefined;
let ctxs: ReturnType<typeof installDomStubs>['ctxs'];

const settle = async () => {
  for (let i = 0; i < 4; i++) await flushPromises();
  await nextTick();
};
const calls = (target: string, method: string) =>
  fake.calls.filter(c => c.target === target && c.method === method);

function mountPanel(comp: object) {
  wrapper = mount(comp, { attachTo: document.body, global: { plugins: [createPinia()] } });
  return wrapper;
}

beforeEach(() => {
  ({ ctxs } = installDomStubs());
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

describe('scenes panel', () => {
  it('lists scenes, highlights the active one and switches on click', async () => {
    const w = mountPanel(ScenesPanel);
    await settle();
    const rows = w.findAll('[data-testid="scene-row"]');
    expect(rows).toHaveLength(10);
    expect(rows[0].attributes('aria-current')).toBe('true');
    await rows[3].trigger('click');
    await settle();
    expect(calls('scenes', 'makeActive')[0].args).toEqual([rows[3].attributes('data-row-id')]);
    const after = w.findAll('[data-testid="scene-row"]');
    expect(after[3].attributes('aria-current')).toBe('true');
    expect(after[0].attributes('aria-current')).toBeUndefined();
  });

  it('"+" opens the Name Scene dialog window (core creates the scene when it is done)', async () => {
    const w = mountPanel(ScenesPanel);
    await settle();
    await w.get('[data-testid="scene-add"]').trigger('click');
    await settle();
    expect(calls('dialogs', 'open')).toHaveLength(1);
    expect(calls('dialogs', 'open')[0].args[0]).toEqual({
      kind: 'name-scene',
      params: {},
      title: 'Name Scene',
    });
    // no in-window stand-in: nothing covers the native preview
    expect(w.find('[data-testid="name-dialog"]').exists()).toBe(false);
    const { occluded } = await import('@/ui/overlay/occluders');
    expect(occluded.value).toBe(false);
    expect(calls('scenes', 'create')).toHaveLength(0);
  });

  it('rename and duplicate open the dialog windows; a double click does not rename', async () => {
    const w = mountPanel(ScenesPanel);
    await settle();
    const { useScenesStore } = await import('@/ui/stores/scenes');
    const store = useScenesStore();
    const ids = w.findAll('[data-testid="scene-row"]').map(r => r.attributes('data-row-id')!);
    await w.findAll('[data-testid="scene-row"]')[1].trigger('dblclick');
    expect(calls('dialogs', 'open')).toHaveLength(0);
    store.startRename(ids[1]); // what the native context menu entry does
    store.duplicate(ids[2]);
    await settle();
    expect(calls('dialogs', 'open').map(c => c.args[0])).toEqual([
      { kind: 'name-scene', params: { rename: ids[1] }, title: 'Rename Scene' },
      { kind: 'name-scene', params: { duplicateFrom: ids[2] }, title: 'Name Scene' },
    ]);
    expect(calls('scenes', 'rename')).toHaveLength(0);
  });

  it('removes a scene only after confirmation, and the dialog is an occluder', async () => {
    const w = mountPanel(ScenesPanel);
    await settle();
    const first = w.findAll('[data-testid="scene-row"]')[0].attributes('data-row-id');
    // the context menu path is covered by the store; trigger the same action through the store
    const { useScenesStore } = await import('@/ui/stores/scenes');
    const store = useScenesStore();
    store.askRemove(first!);
    await settle();
    expect(document.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    const { occluded } = await import('@/ui/overlay/occluders');
    expect(occluded.value).toBe(true);
    expect(calls('scenes', 'remove')).toHaveLength(0);
    (document.querySelector('[data-testid="confirm-ok"]') as HTMLElement).click();
    await settle();
    expect(calls('scenes', 'remove')[0].args).toEqual([first]);
    expect(w.findAll('[data-testid="scene-row"]')).toHaveLength(9);
    expect(occluded.value).toBe(false);
  });

  it('reorders by drag and drop with the full new order', async () => {
    const w = mountPanel(ScenesPanel);
    await settle();
    const rows = w.findAll('[data-testid="scene-row"]');
    const ids = rows.map(r => r.attributes('data-row-id')!);
    rows[0].element.dispatchEvent(new Event('dragstart', { bubbles: true }));
    rows[2].element.getBoundingClientRect = () => ({ top: 100, height: 30 }) as DOMRect;
    const over = Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), {
      clientY: 120, // lower half: after
    });
    rows[2].element.dispatchEvent(over);
    rows[2].element.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls('scenes', 'reorder')[0].args[0]).toEqual([
      ids[1],
      ids[2],
      ids[0],
      ...ids.slice(3),
    ]);
    const state = fake.slices.get('scenes') as ScenesState;
    expect(state.scenes.map(s => s.id).slice(0, 3)).toEqual([ids[1], ids[2], ids[0]]);
  });
});

describe('sources panel', () => {
  const nodes = () => {
    const sid = (fake.slices.get('scenes') as ScenesState).activeSceneId!;
    return (fake.slices.get(`sceneItems:${sid}`) as { nodes: SceneNode[] }).nodes;
  };

  it('lists the active scene items with names from the sources slice', async () => {
    const w = mountPanel(SourcesPanel);
    await settle();
    const rows = w.findAll('[data-testid="source-row"]');
    expect(rows).toHaveLength(nodes().length);
    expect(rows[0].text()).toMatch(/\w/);
    expect(rows[0].find('i').exists()).toBe(true); // legacy icon font glyph
  });

  it('toggles visibility and lock through sceneItems.update', async () => {
    const w = mountPanel(SourcesPanel);
    await settle();
    const id = nodes()[0].id;
    await w.findAll('[data-testid="source-visible"]')[0].trigger('click');
    await w.findAll('[data-testid="source-lock"]')[0].trigger('click');
    await settle();
    const [c1, c2] = calls('sceneItems', 'update');
    expect(c1.args.slice(1)).toEqual([[id], { visible: false }]);
    expect(c2.args.slice(1)).toEqual([[id], { locked: true }]);
    expect(w.findAll('[data-testid="source-visible"]')[0].attributes('title')).toBe('Show');
    expect(w.findAll('[data-testid="source-lock"]')[0].attributes('title')).toBe('Unlock');
  });

  it('selects with click, ctrl+click (toggle) and shift+click (range)', async () => {
    const w = mountPanel(SourcesPanel);
    await settle();
    const ids = nodes().map(n => n.id);
    const row = (i: number) => w.findAll('[data-testid="source-row"]')[i];
    await row(1).trigger('click');
    await settle();
    expect(calls('selection', 'set')[0].args).toEqual([[ids[1]]]);
    expect(row(1).attributes('data-selected')).toBeDefined();

    await row(3).trigger('click', { ctrlKey: true });
    await settle();
    expect(calls('selection', 'add')[0].args).toEqual([[ids[3]]]);
    await row(3).trigger('click', { ctrlKey: true });
    await settle();
    expect(calls('selection', 'remove')[0].args).toEqual([[ids[3]]]);

    await row(1).trigger('click');
    await row(4).trigger('click', { shiftKey: true });
    await settle();
    const lastSet = calls('selection', 'set').at(-1)!;
    expect(lastSet.args).toEqual([ids.slice(1, 5)]);
    expect(w.findAll('[data-selected]')).toHaveLength(4);
  });

  it('removes the selection after confirmation', async () => {
    const w = mountPanel(SourcesPanel);
    await settle();
    const ids = nodes().map(n => n.id);
    await w.findAll('[data-testid="source-row"]')[0].trigger('click');
    await settle();
    await w.get('[data-testid="source-remove"]').trigger('click');
    await settle();
    expect(calls('sceneItems', 'remove')).toHaveLength(0);
    (document.querySelector('[data-testid="confirm-ok"]') as HTMLElement).click();
    await settle();
    expect(calls('sceneItems', 'remove')[0].args.slice(1)).toEqual([[ids[0]]]);
    expect(w.findAll('[data-testid="source-row"]')).toHaveLength(ids.length - 1);
  });

  it('reorders by drag and drop (moves the selection when the dragged row is selected)', async () => {
    const w = mountPanel(SourcesPanel);
    await settle();
    const ids = nodes().map(n => n.id);
    const rows = () => w.findAll('[data-testid="source-row"]');
    await rows()[0].trigger('click');
    await rows()[1].trigger('click', { ctrlKey: true });
    await settle();
    rows()[0].element.dispatchEvent(new Event('dragstart', { bubbles: true }));
    rows()[5].element.getBoundingClientRect = () => ({ top: 100, height: 28 }) as DOMRect;
    rows()[5].element.dispatchEvent(
      Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), { clientY: 101 }),
    );
    rows()[5].element.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await settle();
    expect(calls('sceneItems', 'move')[0].args.slice(1)).toEqual([
      [ids[0], ids[1]],
      { type: 'before', id: ids[5] },
    ]);
    expect(
      nodes()
        .map(n => n.id)
        .slice(0, 4),
    ).toEqual([ids[2], ids[3], ids[4], ids[0]]);
  });

  it('greys out unavailable sources with an explanation tooltip', async () => {
    const w = mountPanel(SourcesPanel);
    await settle();
    const sid = (fake.slices.get('scenes') as ScenesState).activeSceneId!;
    const first = nodes()[0];
    // a source that is not in the `sources` slice (missing plugin/device, design 3.6)
    fake.mutate<{ sources: Record<string, unknown> }>('sources', s => {
      delete s.sources[(first as { sourceId: string }).sourceId];
    });
    await settle();
    const row = w.findAll('[data-testid="source-row"]')[0];
    expect(row.attributes('data-available')).toBe('false');
    expect(row.attributes('title')).toMatch(/unavailable/i);
    expect(row.classes()).toContain('opacity-50');
    expect(sid).toBeTruthy();
  });

  it('windows the list above 100 rows', async () => {
    fake.dispose();
    fake = createFakeCore({ autoMeters: false, scenes: 1, sources: 300 });
    // give the first scene 250 items
    const sid = (fake.slices.get('scenes') as ScenesState).activeSceneId!;
    const src = Object.keys((fake.slices.get('sources') as { sources: object }).sources);
    fake.mutate<{ nodes: SceneNode[] }>(`sceneItems:${sid}`, s => {
      s.nodes = Array.from({ length: 250 }, (_, i) => ({
        ...(s.nodes[0] as object),
        id: `it${i}`,
        sourceId: src[i % src.length],
      })) as SceneNode[];
    });
    setCoreClient(fake.connect(reactive));
    const w = mountPanel(SourcesPanel);
    await settle();
    const rendered = w.findAll('[data-testid="source-row"]').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60); // viewport 300 px / 28 px + overscan, not 250
  });
});

describe('mixer panel', () => {
  const audio = () => fake.slices.get('audio') as AudioState;
  const frame = (db: number) => fake.buildFrame(() => db);
  const lastCtx = () => ctxs.at(-1)!;

  it('shows rows from the audio slice with db text and toggles mute / fader through commands', async () => {
    const w = mountPanel(MixerPanel);
    await settle();
    const rows = w.findAll('[data-testid="mixer-row"]');
    expect(rows).toHaveLength(4);
    expect(rows[0].get('[data-testid="mixer-name"]').text()).toBe('Desktop Audio');
    const id0 = audio().mixer.ids[0];
    expect(rows[0].get('[data-testid="mixer-db"]').text()).toBe(
      `${audio().sources[id0].db.toFixed(1)} dB`,
    );

    await rows[0].get('[data-testid="mixer-mute"]').trigger('click');
    await settle();
    expect(calls('audio', 'setMuted')[0].args).toEqual([id0, true]);
    expect(w.findAll('[data-testid="mixer-row"]')[0].attributes('data-muted')).toBeDefined();

    const fader = rows[1].get('[data-testid="mixer-fader"]');
    await fader.setValue('0.25');
    await settle();
    const id1 = audio().mixer.ids[1];
    expect(calls('audio', 'setFader').at(-1)!.args).toEqual([id1, { deflection: 0.25 }]);
    expect(audio().sources[id1].deflection).toBe(0.25);
  });

  it('subscribes to meters only while visible and focused, and draws with a 2 px threshold', async () => {
    const w = mountPanel(MixerPanel);
    await settle();
    expect(fake.metersOn()).toBe(true);
    expect(fake.sent.filter(m => m.type === 'meters-on')).toHaveLength(1);

    const painted = () => ctxs.reduce((n, c) => n + c.fillRect.mock.calls.length, 0);
    const before = painted();
    fake.pushMeters(frame(-30));
    await settle();
    const afterFirst = painted();
    expect(afterFirst).toBeGreaterThan(before);
    expect(lastCtx().fillRect).toHaveBeenCalled();

    fake.pushMeters(frame(-30)); // identical: nothing is repainted
    await settle();
    expect(painted()).toBe(afterFirst);
    fake.pushMeters(frame(-10)); // moved by far more than 2 px
    await settle();
    expect(painted()).toBeGreaterThan(afterFirst);

    // blur / minimize: unsubscribed
    setFocus(false);
    await settle();
    expect(fake.metersOn()).toBe(false);
    expect(w.get('[data-testid="mixer"]').attributes('data-meters')).toBe('false');
    setFocus(true);
    await settle();
    expect(fake.metersOn()).toBe(true);

    // panel scrolled out of view / hidden: unsubscribed
    FakeIO.setIntersecting(false);
    await settle();
    expect(fake.metersOn()).toBe(false);
    FakeIO.setIntersecting(true);
    await settle();
    expect(fake.metersOn()).toBe(true);

    w.unmount();
    wrapper = undefined;
    await settle();
    expect(fake.metersOn()).toBe(false);
  });

  it('ignores frames built for another mixer revision', async () => {
    mountPanel(MixerPanel);
    await settle();
    const painted = () => ctxs.reduce((n, c) => n + c.fillRect.mock.calls.length, 0);
    const before = painted();
    const stale = frame(-20);
    stale[1] = audio().mixer.rev + 5;
    fake.pushMeters(stale);
    await settle();
    expect(painted()).toBe(before);
  });
});

describe('occluders', () => {
  it('counts open overlays and releases them with the scope', async () => {
    const { occluded } = await import('@/ui/overlay/occluders');
    expect(occluded.value).toBe(false);
    const a = registerOccluder();
    const b = registerOccluder();
    expect(occluded.value).toBe(true);
    a();
    a(); // idempotent
    expect(occluded.value).toBe(true);
    b();
    expect(occluded.value).toBe(false);

    const open = ref(false);
    const C = defineComponent({
      setup() {
        useOccluder(open);
        return () => h('div');
      },
    });
    const w = mount(C);
    open.value = true;
    await nextTick();
    expect(occluded.value).toBe(true);
    w.unmount();
    expect(occluded.value).toBe(false);
  });
});

describe('useObsDisplay', () => {
  function harness() {
    const rect = { x: 5, y: 6, width: 640, height: 360 };
    const Comp = defineComponent({
      setup() {
        const d = useObsDisplay('horizontal', { id: 'main-display' });
        return () => h('div', { ref: d.el, 'data-testid': 'ph' });
      },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ ...rect, top: rect.y, left: rect.x }) as DOMRect,
    );
    return { Comp, rect };
  }

  it('creates the display with the measured view, updates on changes, hides for occluders, destroys on unmount', async () => {
    const { Comp, rect } = harness();
    wrapper = mount(Comp, { attachTo: document.body });
    await settle();
    const create = calls('display', 'create');
    expect(create).toHaveLength(1);
    expect(create[0].args[0]).toBe('main-display');
    expect(create[0].args[1]).toMatchObject({ canvas: 'horizontal', drawUi: true });
    expect(create[0].args[2]).toMatchObject({ rect, visible: true });

    // an open menu/dialog: the native display would draw over it
    const release = registerOccluder();
    await settle();
    expect(calls('display', 'update').at(-1)!.args[1]).toMatchObject({ visible: false });
    release();
    await settle();
    expect(calls('display', 'update').at(-1)!.args[1]).toMatchObject({ visible: true });

    wrapper.unmount();
    wrapper = undefined;
    await settle();
    expect(calls('display', 'destroy')[0].args).toEqual(['main-display']);
  });
});
