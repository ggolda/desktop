// Vue Vapor-mode (no virtual DOM) port of the "settings" dialog. See ../vanilla/settings.js for the reference.
import '../../shared/styles.js';
import { createVaporApp, reactive } from 'vue';
import { connectCore } from '../../shared/client.js';
import Settings from './Settings.vue';

const core = await connectCore();
const categories = reactive(core.snapshot.settings);
createVaporApp(Settings, { categories }).mount('#app');
core.painted();
