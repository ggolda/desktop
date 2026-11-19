// Vue (virtual DOM) port of the "editor" window. See ../vanilla/editor.js for the reference.
import '../../shared/styles.js';
import { createApp, reactive } from 'vue';
import { connectCore } from '../../shared/client.js';
import Editor from './Editor.vue';

const core = await connectCore();
const snap = core.snapshot;
for (const m of snap.mixer) m.peaks = [0, 0];
const state = reactive(snap);

const sourceById = new Map(state.sources.map(s => [s.id, s]));
const mixerById = new Map(state.mixer.map(m => [m.id, m]));

createApp(Editor, { state }).mount('#app');

core.on('meters', list => {
  for (const { id, peaks } of list) mixerById.get(id).peaks = peaks;
});
core.on('stats', s => (state.stats = s));
core.on('sourceUpdate', ({ id, patch }) => Object.assign(sourceById.get(id), patch));
core.painted();
