// Vue (virtual DOM) port of the "settings" dialog. See ../vanilla/settings.js for the reference.
import '../../shared/styles.js';
import { createApp, reactive } from 'vue';
import { connectCore } from '../../shared/client.js';
import Settings from './Settings.vue';

const core = await connectCore();
const categories = reactive(core.snapshot.settings);
createApp(Settings, { categories }).mount('#app');
core.painted();
