// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, type Component } from 'vue';
import type { DialogOpenRequest, PropertiesState } from '@/shared/contracts';
import { setCoreClient } from '@/ui/core';
import { createFakeCore, type FakeCore } from '@/ui/dev/fake-core';
import { resetOccluders } from '@/ui/overlay/occluders';
import { propertiesTitle } from '@/ui/source-types';
import AddSource from '@/windows/dialog-add-source/App.vue';
import NameScene from '@/windows/dialog-name-scene/App.vue';
import RenameSource from '@/windows/dialog-rename-source/App.vue';
import SourceProperties from '@/windows/dialog-source-properties/App.vue';
import Showcase from '@/windows/dialog-source-showcase/App.vue';
import SourcesPanel from '@/windows/main/components/SourcesPanel.vue';
import { installDomStubs } from './dom-stubs';

let fake: FakeCore;
let wrapper: VueWrapper | undefined;
const closeWindow = vi.fn();

const settle = async () => {
  for (let i = 0; i < 4; i++) await flushPromises();
  await nextTick();
};
const calls = (target: string, method: string) =>
  fake.calls.filter(c => c.target === target && c.method === method);

/** Opens `req` in the fake core and mounts the matching dialog page like the real window would. */
async function mountDialog(App: Component, req: DialogOpenRequest) {
  const ref = fake.openDialog(req);
  history.replaceState(null, '', `/?dialog=${ref.dialogId}`);
  wrapper = mount(App, { attachTo: document.body, global: { plugins: [createPinia()] } });
  await settle();
  return { w: wrapper, id: ref.dialogId };
}

const propsOf = (type: string) => {
  const sourceId = fake.addSource(type, type);
  return {
    sourceId,
    req: { kind: 'source-properties', params: { sourceId }, title: propertiesTitle(type) } as const,
  };
};
/** Types into a field like the user does: an `input` event only (VTU's setValue also fires `change`, i.e. blur). */
const typeInto = async (
  el: { element: Element; trigger: (e: string) => Promise<void> },
  value: string,
) => {
  (el.element as HTMLInputElement).value = value;
  await el.trigger('input');
};
const tid = (id: string) => `[data-testid="${id}"]`;

beforeEach(() => {
  installDomStubs();
  resetOccluders();
  fake = createFakeCore({ scenes: 3, sources: 0, audioSources: 0, autoMeters: false });
  setCoreClient(fake.connect(reactive));
  window.reborn = {
    connectCore() {},
    window: {
      minimize() {},
      maximize() {},
      close: closeWindow,
      isMaximized: () => Promise.resolve(false),
      onMaximizedChange: () => () => {},
    },
    menu: { popup: () => Promise.resolve(null) },
  };
});
afterEach(() => {
  vi.useRealTimers();
  wrapper?.unmount();
  wrapper = undefined;
  fake.dispose();
  closeWindow.mockClear();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Add Source showcase', () => {
  const open = () =>
    mountDialog(Showcase, { kind: 'source-showcase', params: {}, title: 'Add Source' });

  it('shows the legacy sections, repeats the essentials and selects Media File first', async () => {
    const { w } = await open();
    const sections = w.findAll('[data-testid^="section-"]').map(s => s.attributes('data-testid'));
    expect(sections).toEqual([
      'section-essentialSources',
      'section-captureSources',
      'section-avSources',
      'section-mediaSources',
    ]);
    const ess = w.findAll(`${tid('section-essentialSources')} [data-testid="source-tile"]`);
    expect(ess.map(t => t.attributes('data-id'))).toEqual([
      'game_capture',
      'dshow_input',
      'ffmpeg_source',
    ]);
    // Game Capture is also in its own group
    expect(w.findAll(`${tid('section-captureSources')} [data-id="game_capture"]`)).toHaveLength(1);
    expect(w.get('[data-active]').attributes('data-id')).toBe('ffmpeg_source');
    expect(w.get(tid('side-panel')).text()).toContain('Add videos or sound clips to your scene.');
    expect(
      w
        .get(tid('side-panel'))
        .findAll('li')
        .map(l => l.text()),
    ).toContain('mp4');
    // Reactive Source is hidden in M1, the scene type is offered (3 scenes)
    expect(w.find('[data-id="smart_browser_source"]').exists()).toBe(false);
    expect(w.find('[data-id="scene"]').exists()).toBe(true);
  });

  it('inspects on click, filters by search and shows the logged-out Widgets placeholder', async () => {
    const { w } = await open();
    await w.get('[data-id="window_capture"]').trigger('click');
    expect(w.get(tid('side-panel')).text()).toContain('Window Capture');
    await w.get(tid('search')).setValue('mic');
    const ids = w.findAll(tid('source-tile')).map(t => t.attributes('data-id'));
    expect(ids).toEqual(['wasapi_input_capture']);
    await w.get(tid('search')).setValue('');
    await w.get(tid('tab-general')).trigger('click');
    expect(w.find(tid('section-essentialSources')).exists()).toBe(false);
    await w.get(tid('tab-widgets')).trigger('click');
    expect(w.find(tid('widgets-empty')).text()).toContain('You must be logged in to use Widgets');
    expect(w.text()).not.toContain('Click here to log in'); // no login button until a user feature exists
  });

  it('Add Source button and double click replace the dialog by the Add Source step', async () => {
    const { w } = await open();
    await w.get('[data-id="image_source"]').trigger('click');
    await w.get(tid('showcase-add')).trigger('click');
    await settle();
    expect(calls('dialogs', 'open').at(-1)!.args[0]).toEqual({
      kind: 'add-source',
      params: { catalogueId: 'image_source' },
      title: 'Add Source',
    });
  });

  it('double click on a tile continues with that tile; Close closes the window', async () => {
    const { w } = await open();
    await w.get('[data-id="browser_source"]').trigger('dblclick');
    await settle();
    expect(calls('dialogs', 'open').at(-1)!.args[0]).toMatchObject({
      params: { catalogueId: 'browser_source' },
    });
    // the fake replaced the dialog: remount is the real window's job, only check Close here
    await w.get(tid('showcase-close')).trigger('click');
    expect(closeWindow).toHaveBeenCalled();
  });
});

describe('Add Source step', () => {
  const req = (id: string): DialogOpenRequest => ({
    kind: 'add-source',
    params: { catalogueId: id },
    title: 'Add Source',
  });

  it('names a new source with the suggested name and submits it with Enter', async () => {
    const { w, id } = await mountDialog(AddSource, req('image_source'));
    expect(w.find(tid('existing-list')).exists()).toBe(false);
    expect(w.text()).toContain('Add New Source');
    const input = w.get<HTMLInputElement>(tid('name-input'));
    expect(input.element.value).toBe('Image');
    await input.setValue('My image');
    await w.get('form').trigger('submit');
    await settle();
    expect(calls('dialogs', 'submitAddSource')[0].args).toEqual([
      id,
      { mode: 'new', name: 'My image' },
    ]);
  });

  it('an empty name is not accepted and shows the required message', async () => {
    const { w } = await mountDialog(AddSource, req('image_source'));
    await w.get(tid('name-input')).setValue('   ');
    await w.get(tid('add-submit')).trigger('click');
    await settle();
    expect(w.get(tid('add-error')).text()).toContain('required');
    expect(calls('dialogs', 'submitAddSource')).toHaveLength(0);
  });

  it('offers existing sources of the type with a switch to a new one', async () => {
    fake.addSource('image_source', 'Image');
    fake.addSource('image_source', 'Banner');
    const { w, id } = await mountDialog(AddSource, req('image_source'));
    expect(w.text()).toContain('Add Existing Source');
    const names = w.findAll('[role="option"]').map(o => o.text());
    expect(names).toEqual(['Image', 'Banner']);
    expect(w.find(tid('source-preview')).exists()).toBe(true); // 200x200 preview display
    await w.findAll('[role="option"]')[1].trigger('click');
    await w.get(tid('add-submit')).trigger('click');
    await settle();
    const [, submit] = calls('dialogs', 'submitAddSource')[0].args as [
      string,
      { mode: string; sourceId: string },
    ];
    expect(submit.mode).toBe('existing');
    expect(submit.sourceId).toBe(w.findAll('[role="option"]')[1].attributes('data-id'));
    // "Add a new source instead" switches to the naming form, suggestion is unique ("Image (1)")
    wrapper!.unmount();
    const again = await mountDialog(AddSource, req('image_source'));
    await again.w.get('[data-testid="new-instead"] button').trigger('click');
    expect(again.w.get<HTMLInputElement>(tid('name-input')).element.value).toBe('Image (1)');
    expect(id).not.toBe(again.id);
  });

  it('the preview display of the existing source is bound to that source', async () => {
    const logo = fake.addSource('image_source', 'Logo');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: 200,
          height: 200,
          right: 200,
          bottom: 200,
        }) as DOMRect,
    );
    await mountDialog(AddSource, req('image_source'));
    const create = calls('display', 'create')[0];
    expect(create.args[1]).toMatchObject({ sourceId: logo });
  });

  it('Cancel closes the window without creating anything', async () => {
    const { w } = await mountDialog(AddSource, req('color_source'));
    await w.get(tid('add-cancel')).trigger('click');
    expect(closeWindow).toHaveBeenCalled();
    expect(calls('dialogs', 'submitAddSource')).toHaveLength(0);
  });
});

describe('Name / Rename dialogs', () => {
  it('Name Scene creates the scene and makes it active; Close does nothing', async () => {
    const { w } = await mountDialog(NameScene, {
      kind: 'name-scene',
      params: {},
      title: 'Name Scene',
    });
    expect(w.get(tid('dialog-title')).text()).toBe('Name Scene');
    const input = w.get<HTMLInputElement>(tid('name-input'));
    expect(input.element.value).toBe('New Scene');
    await input.setValue('Intro');
    await w.get(tid('name-ok')).trigger('click');
    await settle();
    expect(calls('scenes', 'create')[0].args).toEqual(['Intro', { makeActive: true }]);
    expect(closeWindow).toHaveBeenCalled();
  });

  it('Rename Scene is prefilled and renames; an empty name is rejected', async () => {
    const scene = (fake.slices.get('scenes') as { scenes: { id: string; name: string }[] })
      .scenes[0];
    const { w } = await mountDialog(NameScene, {
      kind: 'name-scene',
      params: { rename: scene.id },
      title: 'Rename Scene',
    });
    const input = w.get<HTMLInputElement>(tid('name-input'));
    expect(input.element.value).toBe(scene.name);
    await input.setValue('');
    await w.get(tid('name-ok')).trigger('click');
    await settle();
    expect(w.find(tid('name-error')).exists()).toBe(true);
    expect(calls('scenes', 'rename')).toHaveLength(0);
    expect(closeWindow).not.toHaveBeenCalled();
    await input.setValue('Outro');
    await w.get('form').trigger('submit');
    await settle();
    expect(calls('scenes', 'rename')[0].args).toEqual([scene.id, 'Outro']);
  });

  it('Rename Source renames through sources.rename and Close just closes', async () => {
    const sourceId = fake.addSource('image_source', 'Logo');
    const { w } = await mountDialog(RenameSource, {
      kind: 'rename-source',
      params: { sourceId },
      title: 'Rename Source',
    });
    await w.get(tid('name-input')).setValue('Logo 2');
    await w.get(tid('name-ok')).trigger('click');
    await settle();
    expect(calls('sources', 'rename')[0].args).toEqual([sourceId, 'Logo 2']);
    closeWindow.mockClear();
    await w.get(tid('name-cancel')).trigger('click');
    expect(closeWindow).toHaveBeenCalledOnce();
  });
});

describe('Source Properties', () => {
  const rows = (w: VueWrapper) => w.findAll(tid('prop-row'));

  it('uses the Vue footer (Cancel + Done) and the vertical layout for an image source', async () => {
    const { req } = propsOf('image_source');
    const { w } = await mountDialog(SourceProperties, req);
    expect(w.get(tid('dialog-title')).text()).toBe('Settings for Image');
    expect(w.find(tid('props-close')).exists()).toBe(false);
    expect(w.get(tid('property-form')).attributes('data-layout')).toBe('vertical');
    expect(w.find(tid('source-preview')).exists()).toBe(true);
    // path + two checkboxes
    expect(w.find(tid('path-browse')).exists()).toBe(true);
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('uses the single Close footer and horizontal layout for the React variants', async () => {
    const { req } = propsOf('color_source');
    const { w } = await mountDialog(SourceProperties, req);
    expect(w.get(tid('property-form')).attributes('data-layout')).toBe('horizontal');
    expect(w.find(tid('props-cancel')).exists()).toBe(false);
    expect(w.find(tid('props-done')).exists()).toBe(false);
    await w.get(tid('props-close')).trigger('click');
    expect(closeWindow).toHaveBeenCalledOnce();
    expect(calls('properties', 'set')).toHaveLength(0); // closing never reverts or re-applies
  });

  it('Cancel and Done both only close (edits are live, no revert)', async () => {
    const { req } = propsOf('wasapi_input_capture');
    const { w } = await mountDialog(SourceProperties, req);
    await w.get(tid('props-cancel')).trigger('click');
    await w.get(tid('props-done')).trigger('click');
    expect(closeWindow).toHaveBeenCalledTimes(2);
    expect(calls('properties', 'set')).toHaveLength(0);
  });

  it('the footer title comes from the type name, not from the opened title', async () => {
    const { sourceId } = propsOf('window_capture');
    const { w } = await mountDialog(SourceProperties, {
      kind: 'source-properties',
      params: { sourceId },
      title: 'whatever English',
    });
    expect(w.get(tid('dialog-title')).text()).toBe('Settings for Window Capture');
  });

  it('renders every property kind with its control; invisible and unsupported rows are not shown', async () => {
    const { sourceId, req } = propsOf('text_gdiplus');
    const { w, id } = await mountDialog(SourceProperties, req);
    // push a set that covers all kinds into the slice (what core would send)
    const all: PropertiesState['items'] = [
      { kind: 'bool', name: 'b', description: 'Flag', enabled: true, visible: true, value: true },
      {
        kind: 'int',
        name: 'i',
        description: 'Int',
        enabled: true,
        visible: true,
        value: 5,
        min: 0,
        max: 10,
        step: 1,
      },
      {
        kind: 'float',
        name: 'f',
        description: 'Float',
        enabled: true,
        visible: true,
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.1,
      },
      {
        kind: 'slider',
        name: 's',
        description: 'Slide',
        enabled: true,
        visible: true,
        value: 7,
        min: 0,
        max: 100,
        step: 1,
      },
      { kind: 'text', name: 't', description: 'Text1', enabled: true, visible: true, value: 'abc' },
      {
        kind: 'password',
        name: 'pw',
        description: 'Pass',
        enabled: true,
        visible: true,
        value: 'x',
      },
      {
        kind: 'multiline',
        name: 'm',
        description: 'Multi',
        enabled: true,
        visible: true,
        value: 'l1\nl2',
      },
      {
        kind: 'info',
        name: 'inf',
        description: 'See https://streamlabs.com',
        enabled: true,
        visible: true,
        value: '',
        severity: 'warning',
      },
      {
        kind: 'path-file',
        name: 'pf',
        description: 'File',
        enabled: true,
        visible: true,
        value: 'C:\\a.png',
        filters: [],
        defaultPath: '',
      },
      {
        kind: 'path-save',
        name: 'ps',
        description: 'Save',
        enabled: true,
        visible: true,
        value: '',
        filters: [],
        defaultPath: '',
      },
      {
        kind: 'path-dir',
        name: 'pd',
        description: 'Dir',
        enabled: true,
        visible: true,
        value: '',
        filters: [],
        defaultPath: '',
      },
      {
        kind: 'list',
        name: 'l',
        description: 'List',
        enabled: true,
        visible: true,
        value: 2,
        format: 'int',
        items: [
          { name: 'A', value: 1 },
          { name: 'B', value: 2 },
        ],
      },
      {
        kind: 'color',
        name: 'c',
        description: 'Color',
        enabled: true,
        visible: true,
        value: 0xff0000ff >>> 0,
        alpha: false,
      },
      {
        kind: 'font',
        name: 'fo',
        description: 'Font',
        enabled: true,
        visible: true,
        value: { face: 'Arial', style: 'Regular', size: 32, flags: 0 },
      },
      {
        kind: 'editable-list',
        name: 'el',
        description: 'Files',
        enabled: true,
        visible: true,
        value: ['C:\\x\\one.png'],
        listType: 'files',
        filters: [],
        defaultPath: '',
      },
      { kind: 'button', name: 'btn', description: 'Press me', enabled: true, visible: true },
      {
        kind: 'unsupported',
        name: 'un',
        description: 'Nope',
        enabled: true,
        visible: true,
        backendType: 12,
      },
      {
        kind: 'bool',
        name: 'hidden',
        description: 'Hidden',
        enabled: true,
        visible: false,
        value: false,
      },
      {
        kind: 'bool',
        name: 'off',
        description: 'Disabled',
        enabled: false,
        visible: true,
        value: false,
      },
    ];
    fake.mutate<PropertiesState>(`properties:${id}`, s => {
      s.items = all;
      s.rev++;
    });
    await settle();
    expect(w.get(tid('prop-b')).element).toMatchObject({ checked: true });
    expect(w.get<HTMLInputElement>(tid('prop-i')).element.value).toBe('5');
    expect(w.get<HTMLInputElement>(tid('prop-f')).element.value).toBe('0.5');
    expect(w.get<HTMLInputElement>('input[type="range"]').element.value).toBe('7');
    expect(w.get<HTMLInputElement>(tid('prop-s-box')).element.value).toBe('7');
    expect(w.get<HTMLInputElement>(tid('prop-t')).element.type).toBe('text');
    expect(w.get<HTMLInputElement>(tid('prop-pw')).element.type).toBe('password');
    expect(w.get<HTMLTextAreaElement>(tid('prop-m')).element.value).toBe('l1\nl2');
    expect(w.get(tid('prop-inf')).attributes('data-severity')).toBe('warning');
    expect(w.get(tid('prop-inf')).find('a').attributes('href')).toBe('https://streamlabs.com');
    expect(w.findAll(tid('path-browse'))).toHaveLength(3);
    expect(w.get<HTMLSelectElement>('select[data-testid="prop-l"]').element.selectedIndex).toBe(1);
    expect(w.get<HTMLInputElement>(tid('color-hex')).element.value).toBe('#ff0000ff');
    expect(w.find(tid('font-family')).exists()).toBe(true);
    expect(w.find(tid('font-style')).exists()).toBe(true);
    expect(w.findAll(tid('list-item'))).toHaveLength(1);
    expect(w.find(tid('list-add-files')).exists()).toBe(true);
    expect(w.get(tid('prop-btn')).text()).toBe('Press me');
    expect(w.find(tid('prop-un')).exists()).toBe(false);
    expect(w.find(tid('prop-hidden')).exists()).toBe(false);
    expect(w.get(tid('prop-off')).attributes('disabled')).toBeDefined();
    expect(rows(w).length).toBeGreaterThan(15);
    expect(sourceId).toBeTruthy();
  });

  it('a checkbox sends one change immediately and the modified callback shows hidden rows', async () => {
    const { sourceId, req } = propsOf('browser_source');
    const { w } = await mountDialog(SourceProperties, req);
    expect(w.find(tid('prop-url')).exists()).toBe(true);
    expect(w.find(tid('prop-local_file')).exists()).toBe(false);
    await w.get(tid('prop-is_local_file')).setValue(true);
    await settle();
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'is_local_file', value: true }],
    ]);
    // core re-read the set: the local file row appears, the URL row goes away
    expect(w.find(tid('prop-local_file')).exists()).toBe(true);
    expect(w.find(tid('prop-url')).exists()).toBe(false);
  });

  it('debounces the browser url (1000 ms), keeps the typed value and sends one change', async () => {
    const { sourceId, req } = propsOf('browser_source');
    const { w } = await mountDialog(SourceProperties, req);
    vi.useFakeTimers();
    const url = w.get<HTMLInputElement>(tid('prop-url'));
    await typeInto(url, 'https://a');
    await typeInto(url, 'https://ab');
    await typeInto(url, 'https://abc');
    await vi.advanceTimersByTimeAsync(999);
    expect(calls('properties', 'set')).toHaveLength(0);
    expect(url.element.value).toBe('https://abc'); // optimistic value
    await vi.advanceTimersByTimeAsync(2);
    expect(calls('properties', 'set')).toHaveLength(1);
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'url', value: 'https://abc' }],
    ]);
    vi.useRealTimers();
    await settle();
    expect(w.get<HTMLInputElement>(tid('prop-url')).element.value).toBe('https://abc');
  });

  it('Close flushes an edit that still waits for its debounce', async () => {
    const { sourceId, req } = propsOf('browser_source');
    const { w } = await mountDialog(SourceProperties, req);
    vi.useFakeTimers();
    await typeInto(w.get(tid('prop-url')), 'https://later');
    expect(calls('properties', 'set')).toHaveLength(0);
    await w.get(tid('props-close')).trigger('click');
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'url', value: 'https://later' }],
    ]);
    expect(closeWindow).toHaveBeenCalled();
  });

  it('numbers outside min/max are not sent, valid ones are (debounced)', async () => {
    const { sourceId, req } = propsOf('browser_source');
    const { w } = await mountDialog(SourceProperties, req);
    vi.useFakeTimers();
    const width = w.get<HTMLInputElement>(tid('prop-width'));
    await typeInto(width, '99999');
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls('properties', 'set')).toHaveLength(0);
    expect(width.element.value).toBe('99999'); // shown, not sent
    await typeInto(width, '1280');
    await vi.advanceTimersByTimeAsync(301);
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'width', value: 1280 }],
    ]);
  });

  it('list values are sent in the item type (int), slider debounces 100 ms in the Vue form', async () => {
    const { sourceId, req } = propsOf('window_capture');
    const { w } = await mountDialog(SourceProperties, req);
    const sel = w.get<HTMLSelectElement>('select[data-testid="prop-priority"]');
    sel.element.selectedIndex = 1;
    await sel.trigger('change');
    await settle();
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'priority', value: 0 }],
    ]);
  });

  it('text slider: 100 ms debounce in the Vue form and the box edits the same value', async () => {
    const { sourceId, req } = propsOf('text_gdiplus');
    const { w } = await mountDialog(SourceProperties, req);
    vi.useFakeTimers();
    const range = w.get<HTMLInputElement>('input[type="range"][data-testid="prop-opacity"]');
    await typeInto(range, '40');
    await vi.advanceTimersByTimeAsync(99);
    expect(calls('properties', 'set')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'opacity', value: 40 }],
    ]);
  });

  it('color: hex field edits send the 0xAABBGGRR int (debounced 500 ms), alpha kept', async () => {
    const { sourceId, req } = propsOf('color_source');
    const { w } = await mountDialog(SourceProperties, req);
    expect(w.get<HTMLInputElement>(tid('color-hex')).element.value).toBe('#ffffffff');
    vi.useFakeTimers();
    await typeInto(w.get(tid('color-hex')), '#ff0000');
    await vi.advanceTimersByTimeAsync(499);
    expect(calls('properties', 'set')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    // red, full alpha: 0xFF0000FF as AABBGGRR = r + a<<24
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'color', value: 0xff0000ff }],
    ]);
  });

  it('path Browse uses dialogs.pickPath and sends the chosen path', async () => {
    const { sourceId, req } = propsOf('image_source');
    const { w } = await mountDialog(SourceProperties, req);
    fake.pickResult = { canceled: false, paths: ['C:\\pics\\a.png'] };
    await w.get(tid('path-browse')).trigger('click');
    await settle();
    expect(calls('dialogs', 'pickPath')[0].args[0]).toMatchObject({ mode: 'open-file' });
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'file', value: 'C:\\pics\\a.png' }],
    ]);
    // cancel changes nothing
    fake.pickResult = { canceled: true, paths: [] };
    await w.get(tid('path-browse')).trigger('click');
    await settle();
    expect(calls('properties', 'set')).toHaveLength(1);
  });

  it('a button press sends properties.press', async () => {
    const { sourceId, req } = propsOf('browser_source');
    const { w } = await mountDialog(SourceProperties, req);
    await w.get(tid('prop-refreshnocache')).trigger('click');
    await settle();
    expect(calls('properties', 'press')[0].args).toEqual([sourceId, 'refreshnocache']);
  });

  it('editable list: remove and add send the whole array', async () => {
    const { sourceId, req } = propsOf('slideshow');
    const { w, id } = await mountDialog(SourceProperties, req);
    fake.mutate<PropertiesState>(`properties:${id}`, s => {
      const p = s.items.find(i => i.name === 'files');
      if (p?.kind === 'editable-list') p.value = ['C:\\a.png', 'C:\\b.png'];
    });
    await settle();
    expect(w.findAll(tid('list-item'))).toHaveLength(2);
    await w.findAll(tid('list-remove'))[0].trigger('click');
    await settle();
    expect(calls('properties', 'set')[0].args).toEqual([
      sourceId,
      [{ name: 'files', value: ['C:\\b.png'] }],
    ]);
    fake.pickResult = { canceled: false, paths: ['C:\\c.png'] };
    await w.get(tid('list-add-files')).trigger('click');
    await settle();
    expect(calls('properties', 'set')[1].args[1]).toEqual([
      { name: 'files', value: ['C:\\b.png', 'C:\\c.png'] },
    ]);
  });

  it('the preview display is created for the source and destroyed with the dialog', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: 600,
          height: 200,
          right: 600,
          bottom: 200,
        }) as DOMRect,
    );
    const { sourceId, req } = propsOf('image_source');
    await mountDialog(SourceProperties, req);
    expect(calls('display', 'create')[0].args[1]).toMatchObject({ sourceId });
    wrapper!.unmount();
    wrapper = undefined;
    await settle();
    expect(calls('display', 'destroy')).toHaveLength(1);
  });
});

describe('main window opens the dialogs', () => {
  it('"+" opens the Add Source showcase, double click and the gear open Source Properties, rename opens the rename window', async () => {
    fake.dispose();
    fake = createFakeCore({ scenes: 3, sources: 5, audioSources: 0, autoMeters: false });
    setCoreClient(fake.connect(reactive));
    const w = mount(SourcesPanel, {
      attachTo: document.body,
      global: { plugins: [createPinia()] },
    });
    wrapper = w as unknown as VueWrapper;
    await settle();
    await w.get(tid('source-add')).trigger('click');
    expect(calls('dialogs', 'open')[0].args[0]).toEqual({
      kind: 'source-showcase',
      params: {},
      title: 'Add Source',
    });
    const row = w.findAll(tid('source-row'))[0];
    await row.trigger('dblclick');
    const opened = calls('dialogs', 'open')[1].args[0] as DialogOpenRequest;
    expect(opened.kind).toBe('source-properties');
    expect(opened.title).toMatch(/^Settings for /);
    await row.get(tid('source-properties')).trigger('click');
    expect(calls('dialogs', 'open')).toHaveLength(3);
    const { useSourcesStore } = await import('@/ui/stores/sources');
    useSourcesStore().startRename(row.attributes('data-row-id')!);
    await settle();
    expect((calls('dialogs', 'open')[3].args[0] as DialogOpenRequest).kind).toBe('rename-source');
  });
});
