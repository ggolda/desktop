import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import '@/ui/assets/roboto.css';
import '@/ui/assets/icomoon.css';
import '@/ui/assets/fontawesome.css';
import '@/ui/theme.css';
import '@/ui/dialog/dialog.css';
import { createPinia } from 'pinia';
import { createApp, reactive, type App as VueApp, type Component } from 'vue';
import type { DialogKind, DialogOpenRequest } from '@/shared/contracts';
import { setCoreClient } from '@/ui/core';
import { createFakeCore } from '@/ui/dev/fake-core';
import { propertiesTitle } from '@/ui/source-types';

/**
 * Dev-only page: one dialog against the fake core (npx vite --config vite.windows.config.ts, open
 * /dialog-fake/index.html?kind=...). Query:
 *   kind=source-showcase | add-source | source-properties | name-scene | rename-source | name-folder
 *   type=<source type>      add-source / source-properties: the type (default image_source)
 *   existing=1              add-source: a source of that type already exists ("Add Existing Source")
 *   rename=1 | duplicate=1  name-scene variants;  legacy=1  catalogue with Reactive Source
 * Replacing a dialog (Add Source -> Source Properties) re-mounts the matching App, like main would
 * navigate the real window.
 */
const q = new URLSearchParams(location.search);
const kind = (q.get('kind') ?? 'source-showcase') as DialogKind;
const type = q.get('type') ?? 'image_source';

const fake = createFakeCore({
  scenes: 3,
  sources: 0,
  audioSources: 0,
  autoMeters: false,
  legacyCatalogue: q.has('legacy'),
});
setCoreClient(fake.connect(reactive));
Object.assign(window, { fake });

const apps = import.meta.glob('../dialog-*/App.vue', { eager: true }) as Record<
  string,
  { default: Component }
>;
const appFor = (k: DialogKind) => apps[`../dialog-${k}/App.vue`].default;

const NAMES: Record<string, string> = {
  image_source: 'Image',
  color_source: 'Color Block',
  browser_source: 'Browser Source',
  text_gdiplus: 'Text (GDI+)',
  window_capture: 'Window Capture',
  wasapi_input_capture: 'Audio Input Capture',
};

function request(): DialogOpenRequest {
  switch (kind) {
    case 'source-showcase':
      return { kind, params: {}, title: 'Add Source' };
    case 'add-source':
      if (q.has('existing')) fake.addSource(type, NAMES[type] ?? type);
      return { kind, params: { catalogueId: type }, title: 'Add Source' };
    case 'source-properties': {
      const sourceId = fake.addSource(type, NAMES[type] ?? type);
      return { kind, params: { sourceId }, title: propertiesTitle(type) };
    }
    case 'name-scene': {
      const scene = fake.slices.get('scenes') as { scenes: { id: string }[] };
      const id = scene.scenes[0].id;
      if (q.has('rename')) return { kind, params: { rename: id }, title: 'Rename Scene' };
      if (q.has('duplicate')) return { kind, params: { duplicateFrom: id }, title: 'Name Scene' };
      return { kind, params: {}, title: 'Name Scene' };
    }
    case 'rename-source': {
      const sourceId = fake.addSource(type, NAMES[type] ?? type);
      return { kind, params: { sourceId }, title: 'Rename Source' };
    }
    case 'name-folder':
      return { kind, params: { sceneId: 'x' }, title: 'Name Folder' };
  }
}

let mounted: VueApp | undefined;
// the window bridge a real dialog window gets from the preload
window.reborn = {
  connectCore() {},
  window: {
    minimize() {},
    maximize() {},
    close() {
      mounted?.unmount();
      mounted = undefined;
      document.body.dataset.closed = '1';
    },
    isMaximized: () => Promise.resolve(false),
    onMaximizedChange: () => () => {},
  },
  dialog: { ready() {} },
  menu: { popup: () => Promise.resolve(null) },
};
function mount(k: DialogKind, dialogId: string) {
  mounted?.unmount();
  history.replaceState(null, '', `${location.pathname}?${q.toString()}&dialog=${dialogId}`);
  mounted = createApp(appFor(k)).use(createPinia());
  mounted.mount('#app');
}

fake.onDialogEvent(e => {
  if (e.type === 'open') mount(e.state.kind, e.state.id);
  else {
    mounted?.unmount();
    mounted = undefined;
    document.body.dataset.closed = '1';
  }
});
fake.openDialog(request());
