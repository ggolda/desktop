// Vue Vapor-mode (no virtual DOM) port of the "rename" dialog. See ../vanilla/rename.js for the reference.
import '../../shared/styles.js';
import { createVaporApp } from 'vue';
import { connectCore } from '../../shared/client.js';
import Rename from './Rename.vue';

const core = await connectCore();
createVaporApp(Rename, { initialName: core.snapshot.sources[3].name }).mount('#app');
core.painted();
