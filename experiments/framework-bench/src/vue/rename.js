// Vue (virtual DOM) port of the "rename" dialog. See ../vanilla/rename.js for the reference.
import '../../shared/styles.js';
import { createApp } from 'vue';
import { connectCore } from '../../shared/client.js';
import Rename from './Rename.vue';

const core = await connectCore();
createApp(Rename, { initialName: core.snapshot.sources[3].name }).mount('#app');
core.painted();
